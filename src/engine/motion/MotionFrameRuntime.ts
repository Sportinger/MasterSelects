import type { Layer } from '../../types';
import type { MotionExpressionBinding } from '../../types/motionDesign';
import { useMediaStore } from '../../stores/mediaStore';
import {
  bindMotionFrameStateConsumer,
  createMotionFrameState,
  MOTION_FRAME_STATE_LIMITS,
  type MotionFrameConsumerInput,
  type MotionFrameExpressionValue,
  type MotionFrameMediaEntry,
  type MotionFrameModifierState,
  type MotionFrameReplicatorState,
  type MotionFrameState,
  type MotionFrameStateConsumer,
} from '../../services/motionDesign/contracts/evaluatedMotionFrame';
import {
  resolveMotionExpressionValue,
} from '../../services/motionDesign/expressions/evaluator';
import { compileMotionExpression } from '../../services/motionDesign/expressions/validator';
import { evaluateMotionMediaFrame } from '../../services/motionDesign/media/evaluationPlanner';
import {
  MOTION_MEDIA_REQUEST_VERSION,
  type MotionMediaFitMode,
} from '../../services/motionDesign/media/contracts';
import {
  createAvailableMotionMediaBinding,
  createMotionMediaSourceReference,
} from '../../services/motionDesign/media/sourceReferencePlanner';
import type {
  MotionLimitDescriptor,
  MotionStableDiagnostic,
} from '../../services/motionDesign/contracts/envelopes';
import { normalizeMotionReplicatorBundle } from '../../services/motionDesign/contracts/replicatorTimelineAdapter';
import {
  MotionModifierContractError,
  type MotionModifierDiagnostic,
} from '../../services/motionDesign/modifiers/contracts';
import type { ReplicatorDiagnostic } from '../../services/motionDesign/replicator/contracts';
import {
  createMotionModifierPlanCacheKey,
  planMotionModifiers,
} from '../../services/motionDesign/modifiers/referencePlanner';
import { evaluateMotionReplicatorReference } from '../../services/motionDesign/replicator/referenceEvaluator';
import {
  getMotionRenderSize,
  getMotionReplicatorSourceGeometry,
  getMotionShapeRenderBounds,
  MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
  type MotionRenderSize,
} from './MotionTypes';
import { planReplicatorSourceTexture } from './replicator/resourcePlanning';

export interface MotionFrameRuntimeRequest {
  consumer: MotionFrameStateConsumer;
  compositionId: string;
  timelineTimeSeconds: number;
  layers: readonly Layer[];
  deviceMaxInstances?: number;
  renderTargetMaxInstances?: number;
  deviceMaxTextureDimension2D?: number;
  renderTargetMaxTexturePixels?: number;
  /** Only filtered target views may reuse a full-composition superset state. */
  allowSupersetReuse?: boolean;
}

export type MotionFrameRuntimeAdmission =
  | {
      ok: true;
      consumerInput: MotionFrameConsumerInput;
      layerEntryIds: WeakMap<Layer, string>;
      failures: readonly [];
    }
  | {
      ok: false;
      consumerInput: null;
      failures: readonly { code: string; message: string }[];
    };

interface PreparedReplicator {
  layer: Layer;
  layerId: string;
  contract: MotionFrameReplicatorState['contract'];
  modifierStack: MotionFrameModifierState['contract'] | undefined;
  sourceBounds: MotionFrameReplicatorState['sourceBounds'];
  expressionBindings: readonly MotionExpressionBinding[];
  contentIdentity: string;
}

interface PreparedFrameLayer {
  layerId: string;
  contentIdentity: string;
}

interface MotionFrameCacheEntry {
  baseIdentity: string;
  state: MotionFrameState;
  layerContentById: ReadonlyMap<string, string>;
  weight: number;
}

const MOTION_FRAME_RUNTIME_CACHE_LIMIT = 4;
const MOTION_FRAME_RUNTIME_CACHE_INSTANCE_BUDGET = 200_000;
const MOTION_FRAME_DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;
const MOTION_FRAME_DEFAULT_MAX_TEXTURE_PIXELS = 64 * 1024 * 1024;
const motionFrameRuntimeCache = new Map<string, MotionFrameCacheEntry>();
const motionModifierPlanCache = new Map<string, Extract<MotionFrameModifierState['plan'], { ok: true }>>();
const motionExpressionProgramCache = new Map<string, ReturnType<typeof compileMotionExpression>>();
const admittedMotionFrameRuntimeAdmissions = new WeakSet<object>();

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function normalizeRuntimeLimit(value: number | undefined, label: string): number {
  if (value === undefined) return MOTION_REPLICATOR_SHADER_MAX_INSTANCES;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return Math.min(value, MOTION_REPLICATOR_SHADER_MAX_INSTANCES);
}

function normalizeResourceLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function toFrameDiagnostic(
  layerId: string,
  diagnostic: ReplicatorDiagnostic,
): MotionStableDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    source: 'replicator',
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    entityId: layerId,
  };
}


function toModifierFrameDiagnostic(
  layerId: string,
  diagnostic: MotionModifierDiagnostic,
): MotionStableDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    source: 'modifier',
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    entityId: layerId,
  };
}

function toExpressionFrameDiagnostic(
  layerId: string,
  binding: MotionExpressionBinding,
  message: string,
): MotionStableDiagnostic {
  return {
    code: 'MOTION_EXPRESSION_EVALUATION_FAILED',
    severity: 'error',
    source: 'expression',
    message: `Expression ${binding.id} at ${binding.path}: ${message}`,
    path: binding.path,
    entityId: layerId,
  };
}

function stableExpressionBindings(
  value: MotionExpressionBinding[] | undefined,
): readonly MotionExpressionBinding[] {
  if (!Array.isArray(value)) return [];
  const byPath = new Map<string, MotionExpressionBinding>();
  for (const binding of value) {
    if (!binding || typeof binding !== 'object' || typeof binding.path !== 'string') continue;
    byPath.set(binding.path, binding);
  }
  return [...byPath.values()].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
}

function expressionBindingRevision(bindings: readonly MotionExpressionBinding[]): string {
  return `layer:${stableHash(JSON.stringify(bindings.map((binding) => [
    binding.id,
    binding.path,
    binding.source,
    binding.fallback,
    binding.enabled,
  ])))}`;
}

function compileCachedMotionExpression(source: string): ReturnType<typeof compileMotionExpression> {
  const cached = motionExpressionProgramCache.get(source);
  if (cached) return cached;
  const compiled = compileMotionExpression(source);
  motionExpressionProgramCache.set(source, compiled);
  return compiled;
}

function evaluateExpressionBindings(
  layerId: string,
  bindings: readonly MotionExpressionBinding[],
  contractRevision: string,
  clipLocalTimeSeconds: number,
  effectiveCount: number,
): { values: MotionFrameExpressionValue[]; diagnostics: MotionStableDiagnostic[] } {
  const values: MotionFrameExpressionValue[] = [];
  const diagnostics: MotionStableDiagnostic[] = [];
  if (effectiveCount < 1) return { values, diagnostics };
  for (const binding of bindings) {
    if (!binding.enabled) continue;
    const fallback = Number.isFinite(binding.fallback) ? binding.fallback : 0;
    const compiled = typeof binding.source === 'string'
      ? compileCachedMotionExpression(binding.source)
      : null;
    let reportedFailure = false;
    const reportFailure = (message: string) => {
      if (reportedFailure) return;
      reportedFailure = true;
      diagnostics.push(toExpressionFrameDiagnostic(layerId, binding, message));
    };
    if (!compiled?.ok) {
      const failure = compiled?.failures[0];
      reportFailure(failure
        ? `${failure.message} (position ${failure.position})`
        : 'Expression source must be a string.');
    }
    for (let instanceIndex = 0; instanceIndex < effectiveCount; instanceIndex += 1) {
      const resolved = compiled?.ok
        ? resolveMotionExpressionValue({
            program: compiled.value,
            context: { time: clipLocalTimeSeconds, index: instanceIndex, count: effectiveCount },
            baseValue: fallback,
          })
        : null;
      if (!resolved?.ok) {
        const failure = resolved?.failures[0];
        reportFailure(failure
          ? `${failure.message} (position ${failure.position})`
          : 'Expression could not be evaluated.');
      }
      values.push({
        entityId: layerId,
        propertyPath: binding.path,
        contractRevision,
        clipLocalTimeSeconds,
        instanceIndex,
        effectiveCount,
        resolved: resolved?.ok
          ? resolved.value
          : { value: fallback, source: 'expression', precedence: 'expression-over-keyframe' },
      });
    }
  }
  return { values, diagnostics };
}

function buildFalloffShapeReferences(
  layers: readonly { layer: Layer }[],
) {
  return layers.flatMap(({ layer }) => {
    const motion = layer.source?.type === 'motion' ? layer.source.motion : undefined;
    if (motion?.kind !== 'shape') return [];
    const primitive = motion.shape?.primitive;
    if (primitive !== 'ellipse' && primitive !== 'rectangle') return [];
    const shapeBounds = getMotionShapeRenderBounds(motion);
    return [{
      shapeClipId: layer.sourceClipId ?? layer.id,
      revision: motion.replicator?.revision ?? 0,
      kind: primitive,
      center: { x: layer.position.x, y: layer.position.y },
      size: {
        x: shapeBounds.width * Math.abs(layer.scale.x),
        y: shapeBounds.height * Math.abs(layer.scale.y),
      },
    }];
  });
}

function collectVisibleLayers(
  rootLayers: readonly Layer[],
): { ok: true; layers: Array<{ layer: Layer; entryId: string }>; layerEntryIds: WeakMap<Layer, string> }
  | { ok: false; message: string } {
  const layers: Array<{ layer: Layer; entryId: string }> = [];
  const occurrenceByLayerId = new Map<string, number>();
  const usedEntryIds = new Set<string>();
  const layerEntryIds = new WeakMap<Layer, string>();
  const activeArrays = new Set<readonly Layer[]>();
  const visit = (entries: readonly Layer[], depth: number): string | null => {
    if (depth > 16) {
      return 'Motion frame layer nesting exceeds the runtime depth limit';
    }
    if (activeArrays.has(entries)) {
      return 'Motion frame layer tree contains a cycle';
    }
    activeArrays.add(entries);
    for (let index = 0; index < entries.length; index += 1) {
      const layer = entries[index];
      if (!layer || layer.visible === false || layer.opacity === 0 || !layer.source) continue;
      const occurrence = occurrenceByLayerId.get(layer.id) ?? 0;
      occurrenceByLayerId.set(layer.id, occurrence + 1);
      let entryId = occurrence === 0 ? layer.id : `${layer.id}#${occurrence + 1}`;
      while (usedEntryIds.has(entryId)) entryId += '#';
      usedEntryIds.add(entryId);
      layerEntryIds.set(layer, entryId);
      layers.push({ layer, entryId });
      const nested = layer.source.nestedComposition?.layers;
      if (nested) {
        const failure = visit(nested, depth + 1);
        if (failure) {
          activeArrays.delete(entries);
          return failure;
        }
      }
    }
    activeArrays.delete(entries);
    return null;
  };
  const failure = visit(rootLayers, 0);
  if (failure) return { ok: false, message: failure };
  return { ok: true, layers, layerEntryIds };
}

export function hasMotionFrameLayers(rootLayers: readonly Layer[]): boolean {
  const collected = collectVisibleLayers(rootLayers);
  if (!collected.ok) return true;
  return collected.layers.some(({ layer }) => layer.source?.type === 'motion');
}

function findReusableFrameState(
  baseIdentity: string,
  prepared: readonly PreparedFrameLayer[],
  allowSupersetReuse: boolean,
): MotionFrameState | null {
  for (const entry of [...motionFrameRuntimeCache.values()].reverse()) {
    if (entry.baseIdentity !== baseIdentity) continue;
    if (!allowSupersetReuse && entry.layerContentById.size !== prepared.length) continue;
    const matches = prepared.every((candidate) => (
      entry.layerContentById.get(candidate.layerId) === candidate.contentIdentity
    ));
    if (matches) return entry.state;
  }
  return null;
}

function storeFrameState(
  cacheIdentity: string,
  baseIdentity: string,
  prepared: readonly PreparedFrameLayer[],
  state: MotionFrameState,
): void {
  const layerContentById = new Map(
    prepared.map((entry) => [entry.layerId, entry.contentIdentity] as const),
  );
  for (const [key, cached] of motionFrameRuntimeCache) {
    if (cached.baseIdentity !== baseIdentity) continue;
    const cachedIsSubset = [...cached.layerContentById].every(
      ([layerId, identity]) => layerContentById.get(layerId) === identity,
    );
    if (cachedIsSubset) motionFrameRuntimeCache.delete(key);
  }
  const weight = Math.max(1, state.replicators.reduce(
    (total, entry) => total + entry.evaluation.effectiveCount,
    0,
  ));
  motionFrameRuntimeCache.set(cacheIdentity, { baseIdentity, state, layerContentById, weight });
  const totalWeight = () => [...motionFrameRuntimeCache.values()].reduce(
    (total, entry) => total + entry.weight,
    0,
  );
  while (
    motionFrameRuntimeCache.size > MOTION_FRAME_RUNTIME_CACHE_LIMIT
    || totalWeight() > MOTION_FRAME_RUNTIME_CACHE_INSTANCE_BUDGET
  ) {
    const oldestKey = motionFrameRuntimeCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    motionFrameRuntimeCache.delete(oldestKey);
  }
}

export function clearMotionFrameRuntimeCache(): void {
  motionFrameRuntimeCache.clear();
  motionModifierPlanCache.clear();
  motionExpressionProgramCache.clear();
}

export function getMotionDeviceMaxInstances(device: GPUDevice): number {
  const maxBufferSize = Number(device.limits?.maxBufferSize);
  if (!Number.isFinite(maxBufferSize) || maxBufferSize < 48) {
    return MOTION_REPLICATOR_SHADER_MAX_INSTANCES;
  }
  return Math.max(1, Math.min(
    Math.floor(maxBufferSize / 48),
    MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
  ));
}

export function getMotionDeviceTextureLimits(device: GPUDevice): {
  deviceMaxTextureDimension2D: number;
  renderTargetMaxTexturePixels: number;
} {
  const reportedDimension = Number(device.limits?.maxTextureDimension2D);
  const deviceMaxTextureDimension2D = Number.isSafeInteger(reportedDimension) && reportedDimension > 0
    ? reportedDimension
    : MOTION_FRAME_DEFAULT_MAX_TEXTURE_DIMENSION_2D;
  return {
    deviceMaxTextureDimension2D,
    renderTargetMaxTexturePixels: Math.min(
      deviceMaxTextureDimension2D * deviceMaxTextureDimension2D,
      MOTION_FRAME_DEFAULT_MAX_TEXTURE_PIXELS,
    ),
  };
}

export function describeMotionFrameRuntimeFailure(
  admission: MotionFrameRuntimeAdmission,
): string | null {
  if (admission.ok) return null;
  return admission.failures
    .map((failure) => `${failure.code}: ${failure.message}`)
    .join('; ');
}

export function createMotionFrameRuntimeAdmission(
  request: MotionFrameRuntimeRequest,
): MotionFrameRuntimeAdmission {
  let deviceMaxInstances: number;
  let renderTargetMaxInstances: number;
  let deviceMaxTextureDimension2D: number;
  let renderTargetMaxTexturePixels: number;
  try {
    deviceMaxInstances = normalizeRuntimeLimit(request.deviceMaxInstances, 'deviceMaxInstances');
    renderTargetMaxInstances = normalizeRuntimeLimit(
      request.renderTargetMaxInstances,
      'renderTargetMaxInstances',
    );
    deviceMaxTextureDimension2D = normalizeResourceLimit(
      request.deviceMaxTextureDimension2D,
      MOTION_FRAME_DEFAULT_MAX_TEXTURE_DIMENSION_2D,
      'deviceMaxTextureDimension2D',
    );
    renderTargetMaxTexturePixels = normalizeResourceLimit(
      request.renderTargetMaxTexturePixels,
      Math.min(
        deviceMaxTextureDimension2D * deviceMaxTextureDimension2D,
        MOTION_FRAME_DEFAULT_MAX_TEXTURE_PIXELS,
      ),
      'renderTargetMaxTexturePixels',
    );
  } catch (error) {
    return {
      ok: false,
      consumerInput: null,
      failures: [{
        code: 'MOTION_FRAME_RUNTIME_INVALID_LIMIT',
        message: error instanceof Error ? error.message : 'Invalid Motion runtime limit',
      }],
    };
  }
  const runtimeLimits = { deviceMaxInstances, renderTargetMaxInstances };
  const textureLimits = { deviceMaxTextureDimension2D, renderTargetMaxTexturePixels };
  const collected = collectVisibleLayers(request.layers);
  if (!collected.ok) {
    return {
      ok: false,
      consumerInput: null,
      failures: [{ code: 'MOTION_FRAME_RUNTIME_INVALID', message: collected.message }],
    };
  }
  const frameLayers: PreparedFrameLayer[] = collected.layers.map(({ layer, entryId }) => ({
    layerId: entryId,
    contentIdentity: JSON.stringify({
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      effects: layer.effects,
      colorCorrection: layer.colorCorrection,
      position: layer.position,
      scale: layer.scale,
      rotation: layer.rotation,
      is3D: layer.is3D,
      wireframe: layer.wireframe,
      maskFeather: layer.maskFeather,
      maskFeatherQuality: layer.maskFeatherQuality,
      maskInvert: layer.maskInvert,
      maskClipId: layer.maskClipId,
      masks: layer.masks,
      sourceRect: layer.sourceRect,
      transitionRender: layer.transitionRender,
      source: layer.source
        ? {
            type: layer.source.type,
            mediaTime: layer.source.mediaTime,
            targetMediaTime: layer.source.targetMediaTime,
            previewPath: layer.source.previewPath,
            proxyFrameIndex: layer.source.proxyFrameIndex,
            mediaFileId: layer.source.mediaFileId,
            intrinsicWidth: layer.source.intrinsicWidth,
            intrinsicHeight: layer.source.intrinsicHeight,
            color: layer.source.color,
            modelUrl: layer.source.modelUrl,
            modelFileName: layer.source.modelFileName,
            modelSequence: layer.source.modelSequence,
            modelPrimitiveIndex: layer.source.modelPrimitiveIndex,
            modelMaterialSettings: layer.source.modelMaterialSettings,
            gaussianSplatSequence: layer.source.gaussianSplatSequence,
            gaussianAvatarUrl: layer.source.gaussianAvatarUrl,
            gaussianBlendshapes: layer.source.gaussianBlendshapes,
            gaussianSplatUrl: layer.source.gaussianSplatUrl,
            gaussianSplatFileName: layer.source.gaussianSplatFileName,
            gaussianSplatFileHash: layer.source.gaussianSplatFileHash,
            gaussianSplatRuntimeKey: layer.source.gaussianSplatRuntimeKey,
            gaussianSplatSettings: layer.source.gaussianSplatSettings,
            threeDEffectorsEnabled: layer.source.threeDEffectorsEnabled,
            meshType: layer.source.meshType,
            cameraSettings: layer.source.cameraSettings,
            lightSettings: layer.source.lightSettings,
            textProperties: layer.source.textProperties,
            text3DProperties: layer.source.text3DProperties,
            runtimeSourceId: layer.source.runtimeSourceId,
            runtimeSessionKey: layer.source.runtimeSessionKey,
            forceRuntimeFramePreview: layer.source.forceRuntimeFramePreview,
            videoRotation: layer.source.videoRotation,
            file: layer.source.file
              ? {
                  name: layer.source.file.name,
                  size: layer.source.file.size,
                  type: layer.source.file.type,
                  lastModified: layer.source.file.lastModified,
                }
              : undefined,
            motion: layer.source.type === 'motion' ? layer.source.motion : undefined,
          }
        : null,
      nestedComposition: layer.source?.nestedComposition
        ? {
            compositionId: layer.source.nestedComposition.compositionId,
            currentTime: layer.source.nestedComposition.currentTime,
          }
        : undefined,
    }),
  }));
  frameLayers.sort((left, right) => (
    left.layerId < right.layerId ? -1 : left.layerId > right.layerId ? 1 : 0
  ));
  const prepared: PreparedReplicator[] = [];
  for (const { layer, entryId } of collected.layers) {
    const motion = layer.source?.type === 'motion' ? layer.source.motion : undefined;
    if (motion?.kind !== 'shape' || !motion.replicator) continue;
    try {
      const bundle = normalizeMotionReplicatorBundle(
        motion.replicator,
        motion.modifierStack,
      );
      const contract = bundle.replicator;
      const { sourceBounds } = getMotionReplicatorSourceGeometry(motion);
      const expressionBindings = stableExpressionBindings(motion.expressions?.bindings);
      prepared.push({
        layer,
        layerId: entryId,
        contract,
        modifierStack: bundle.modifierStack,
        sourceBounds,
        expressionBindings,
        contentIdentity: JSON.stringify({
          contract,
          modifierStack: bundle.modifierStack,
          expressionBindings,
          sourceBounds,
        }),
      });
    } catch (error) {
      return {
        ok: false,
        consumerInput: null,
        failures: [{
          code: error instanceof MotionModifierContractError
            ? error.code
            : 'MOTION_REPLICATOR_INVALID_CONTRACT',
          message: error instanceof Error ? error.message : 'Unknown Replicator frame admission failure',
        }],
      };
    }
  }
  prepared.sort((left, right) => (
    left.layerId < right.layerId ? -1 : left.layerId > right.layerId ? 1 : 0
  ));
  const baseIdentity = JSON.stringify({
    compositionId: request.compositionId,
    timelineTimeSeconds: request.timelineTimeSeconds,
    runtimeLimits,
    textureLimits,
  });
  const cachedState = findReusableFrameState(
    baseIdentity,
    frameLayers,
    request.allowSupersetReuse === true,
  );
  if (cachedState) {
    const admission: MotionFrameRuntimeAdmission = {
      ok: true,
      consumerInput: bindMotionFrameStateConsumer(cachedState, request.consumer),
      layerEntryIds: collected.layerEntryIds,
      failures: [],
    };
    admittedMotionFrameRuntimeAdmissions.add(admission);
    return admission;
  }

  const hasFalloff = prepared.some((entry) => entry.modifierStack?.falloff !== undefined);
  // Falloff references are composition-local. Nested compositions are admitted independently.
  const shapeReferences = hasFalloff
    ? buildFalloffShapeReferences(collected.layers.filter(({ layer }) => request.layers.includes(layer)))
    : [];

  const replicators: MotionFrameReplicatorState[] = [];
  const modifiers: MotionFrameModifierState[] = [];
  const expressions: MotionFrameExpressionValue[] = [];
  const expressionBindingRevisions = new Map<string, string>();
  const limits: MotionLimitDescriptor[] = [];
  const diagnostics: MotionStableDiagnostic[] = [];

  const requestedFrameInstances = prepared.reduce((total, entry) => {
    if (!entry.contract.enabled) return total;
    const requested = entry.contract.layout.mode === 'grid'
      ? entry.contract.layout.count.columns * entry.contract.layout.count.rows
      : entry.contract.layout.count;
    return total + Math.min(
      requested,
      entry.contract.userLimit ?? MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
      deviceMaxInstances,
      renderTargetMaxInstances,
    );
  }, 0);
  if (requestedFrameInstances > MOTION_FRAME_STATE_LIMITS.maxTotalReplicatorInstances) {
    return {
      ok: false,
      consumerInput: null,
      failures: [{
        code: 'MOTION_FRAME_RUNTIME_FRAME_BUDGET_EXCEEDED',
        message: `Motion frame requests ${requestedFrameInstances} Replicator instances; maximum is ${MOTION_FRAME_STATE_LIMITS.maxTotalReplicatorInstances}`,
      }],
    };
  }

  for (const entry of prepared) {
    const evaluation = evaluateMotionReplicatorReference(
      entry.contract,
      runtimeLimits,
      entry.sourceBounds,
    );
    if (!evaluation.ok) {
      return {
        ok: false,
        consumerInput: null,
        failures: evaluation.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      };
    }
    replicators.push({
      layerId: entry.layerId,
      contract: entry.contract,
      runtimeLimits,
      sourceBounds: entry.sourceBounds,
      evaluation,
    });
    diagnostics.push(...evaluation.diagnostics.map(
      (diagnostic) => toFrameDiagnostic(entry.layerId, diagnostic),
    ));
    let clipLocalTimeSeconds = request.timelineTimeSeconds;
    if (entry.modifierStack) {
      clipLocalTimeSeconds = Math.round(
        request.timelineTimeSeconds * entry.modifierStack.ticksPerSecond,
      ) / entry.modifierStack.ticksPerSecond;
      const context = {
        requestedCount: evaluation.requestedCount,
        effectiveCount: evaluation.effectiveCount,
        clipLocalTimeSeconds,
        instances: evaluation.instances.map((instance) => ({
          index: instance.index,
          layoutTransform: instance.layoutTransform,
          offsetTransform: instance.offsetTransform,
        })),
        shapeReferences,
      };
      let cacheKey: string | null = null;
      try {
        cacheKey = createMotionModifierPlanCacheKey(entry.modifierStack, context);
      } catch {
        // The planner below owns frozen modifier diagnostics for invalid input.
      }
      const plan = cacheKey === null
        ? planMotionModifiers(entry.modifierStack, context)
        : motionModifierPlanCache.get(cacheKey)
          ?? planMotionModifiers(entry.modifierStack, context);
      if (!plan.ok) {
        const modifierDiagnostics = plan.diagnostics.map((diagnostic) => toModifierFrameDiagnostic(
          entry.layerId,
          diagnostic,
        ));
        diagnostics.push(...modifierDiagnostics);
        return {
          ok: false,
          consumerInput: null,
          failures: modifierDiagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            message: diagnostic.message,
          })),
        };
      }
      if (cacheKey !== null) motionModifierPlanCache.set(cacheKey, plan);
      modifiers.push({
        layerId: entry.layerId,
        contract: entry.modifierStack,
        context,
        plan,
      });
    }
    if (entry.expressionBindings.length > 0) {
      const revision = expressionBindingRevision(entry.expressionBindings);
      expressionBindingRevisions.set(entry.layerId, revision);
      const evaluatedExpressions = evaluateExpressionBindings(
        entry.layerId,
        entry.expressionBindings,
        revision,
        clipLocalTimeSeconds,
        evaluation.effectiveCount,
      );
      expressions.push(...evaluatedExpressions.values);
      diagnostics.push(...evaluatedExpressions.diagnostics);
    }
    if (evaluation.enabled) {
      const hardLimit = Math.min(
        entry.contract.userLimit ?? MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
        deviceMaxInstances,
        renderTargetMaxInstances,
      );
      limits.push({
        id: `replicator.instances:${entry.layerId}`,
        unit: 'count',
        requested: evaluation.requestedCount,
        effective: evaluation.effectiveCount,
        hardLimit,
        binding: evaluation.effectiveCount < evaluation.requestedCount,
      });
    }
  }

  const replicatorsByLayerId = new Map(replicators.map((entry) => [entry.layerId, entry] as const));
  const modifiersByLayerId = new Map(modifiers.map((entry) => [entry.layerId, entry] as const));
  const expressionsByLayerId = new Map<string, MotionFrameExpressionValue[]>();
  for (const expression of expressions) {
    const layerExpressions = expressionsByLayerId.get(expression.entityId) ?? [];
    layerExpressions.push(expression);
    expressionsByLayerId.set(expression.entityId, layerExpressions);
  }
  for (const { layer, entryId } of collected.layers) {
    const motion = layer.source?.type === 'motion' ? layer.source.motion : undefined;
    if (motion?.kind !== 'shape') continue;
    const size = getMotionRenderSize(
      motion,
      replicatorsByLayerId.get(entryId),
      modifiersByLayerId.get(entryId),
      expressionsByLayerId.get(entryId),
    );
    try {
      const texturePlan = planReplicatorSourceTexture({
        sourceWidth: size.width,
        sourceHeight: size.height,
        strokePadding: 0,
        maxTextureDimension2D: deviceMaxTextureDimension2D,
        maxTexturePixels: renderTargetMaxTexturePixels,
      });
      if (!texturePlan.ok) {
        return {
          ok: false,
          consumerInput: null,
          failures: texturePlan.diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            message: diagnostic.message,
          })),
        };
      }
    } catch (error) {
      return {
        ok: false,
        consumerInput: null,
        failures: [{
          code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
          message: error instanceof Error ? error.message : 'Invalid Motion texture resource request',
        }],
      };
    }
  }

  const mediaEntries: MotionFrameMediaEntry[] = [];
  for (const { layer, entryId } of collected.layers) {
    const motion = layer.source?.type === 'motion' ? layer.source.motion : undefined;
    try {
      // The frame-state contract requires replicated media to cover every
      // effective stable index exactly once, and a DISABLED replicator
      // evaluates to effectiveCount 0 — the contract then forbids media
      // entries for that layer entirely. Frame media entries exist for
      // replicated decode/pool planning; the engine renders plain (non- or
      // disabled-replicator) texture fills directly from the motion
      // definition, so skipping them here loses nothing visually.
      const replicatorEntry = replicators.find((entry) => entry.layerId === entryId);
      const effectiveCount = replicatorEntry === undefined
        ? 1
        : replicatorEntry.evaluation.enabled
          ? replicatorEntry.evaluation.effectiveCount
          : 0;
      if (effectiveCount > 0) {
        mediaEntries.push(...buildTextureFillMediaEntries(
          entryId,
          request.timelineTimeSeconds,
          motion,
          effectiveCount,
        ));
      }
    } catch (error) {
      diagnostics.push(toMediaFrameDiagnostic(
        entryId,
        error instanceof Error ? error.message : 'Invalid texture-fill media reference',
      ));
    }
  }

  const identity = JSON.stringify({
    compositionId: request.compositionId,
    timelineTimeSeconds: request.timelineTimeSeconds,
    replicators: replicators.map((entry) => [entry.layerId, entry.evaluation.cacheKey]),
    modifiers: modifiers.map((entry) => [entry.layerId, entry.plan.cacheKey]),
    expressions: expressions.map((entry) => [
      entry.entityId,
      entry.propertyPath,
      entry.contractRevision,
      entry.instanceIndex,
      entry.resolved.value,
    ]),
    media: mediaEntries.map((entry) => [entry.layerId, entry.evaluation.reuseKey]),
    falloffReferences: shapeReferences.map((reference) => [
      reference.shapeClipId,
      reference.revision,
    ]),
    frameContentIdentity: frameLayers.map((entry) => [entry.layerId, entry.contentIdentity]),
    diagnostics: diagnostics.map((entry) => [entry.entityId, entry.code]),
  });
  const evaluationRevision = `motion-evaluation:${stableHash(identity)}`;
  const stateResult = createMotionFrameState({
    frameId: `${request.compositionId}:motion-frame:${stableHash(identity)}`,
    compositionId: request.compositionId,
    timelineTimeSeconds: request.timelineTimeSeconds,
    evaluationRevision,
    capabilities: [{
      id: 'replicator.device-max-instances',
      supported: true,
      source: 'device',
      numericLimit: deviceMaxInstances,
    }, {
      id: 'replicator.render-target-max-instances',
      supported: true,
      source: 'render-target',
      numericLimit: renderTargetMaxInstances,
    }, {
      id: 'replicator.device-max-texture-dimension-2d',
      supported: true,
      source: 'device',
      numericLimit: deviceMaxTextureDimension2D,
    }, {
      id: 'replicator.render-target-max-texture-pixels',
      supported: true,
      source: 'render-target',
      numericLimit: renderTargetMaxTexturePixels,
    }],
    limits,
    entityRevisions: [
      ...replicators.map((entry) => ({
        kind: 'replicator' as const,
        entityId: entry.layerId,
        revision: `replicator:${entry.contract.revision}`,
      })),
      ...modifiers.map((entry) => ({
        kind: 'modifier-stack' as const,
        entityId: entry.layerId,
        revision: `modifier:${entry.contract.revision}`,
      })),
      ...[...expressionBindingRevisions].flatMap(([entityId, revision]) => ([{
        kind: 'expression-binding' as const,
        entityId,
        revision: `expression-binding:${revision.slice('layer:'.length)}`,
      }, {
        // The frozen expression frame contract binds each evaluated series to
        // a layer revision, while this companion entry makes binding edits an
        // explicit frame-cache dependency.
        kind: 'layer' as const,
        entityId,
        revision,
      }])),
      // Media entries fan out per effective instance, but the binding
      // revision is a per-LAYER fact — emit exactly one entity revision per
      // layer or the contract rejects the duplicate stable ids.
      ...[...new Map(mediaEntries.map((entry) => [entry.layerId, entry] as const)).values()]
        .map((entry) => ({
          kind: 'media-binding' as const,
          entityId: entry.layerId,
          revision: `media:${entry.evaluation.bindingRevision ?? 'missing'}`,
        })),
    ],
    replicators,
    modifiers,
    structure: null,
    adjustment: null,
    mediaEntries,
    expressions,
    diagnostics,
  });
  if (!stateResult.ok) {
    return {
      ok: false,
      consumerInput: null,
      failures: stateResult.failures,
    };
  }
  const cacheIdentity = JSON.stringify({
    baseIdentity,
    prepared: frameLayers.map((entry) => [entry.layerId, entry.contentIdentity]),
  });
  storeFrameState(cacheIdentity, baseIdentity, frameLayers, stateResult.state);
  const admission: MotionFrameRuntimeAdmission = {
    ok: true,
    consumerInput: bindMotionFrameStateConsumer(stateResult.state, request.consumer),
    layerEntryIds: collected.layerEntryIds,
    failures: [],
  };
  admittedMotionFrameRuntimeAdmissions.add(admission);
  return admission;
}

export function rebindMotionFrameRuntimeAdmission(
  admission: MotionFrameRuntimeAdmission | undefined,
  consumer: MotionFrameStateConsumer,
): MotionFrameRuntimeAdmission | undefined {
  if (admission === undefined || !admission.ok) return admission;
  if (!admittedMotionFrameRuntimeAdmissions.has(admission)) return undefined;
  if (admission.consumerInput.consumer === consumer) return admission;
  const rebound: MotionFrameRuntimeAdmission = {
    ok: true,
    consumerInput: bindMotionFrameStateConsumer(admission.consumerInput.frameState, consumer),
    layerEntryIds: admission.layerEntryIds,
    failures: [],
  };
  admittedMotionFrameRuntimeAdmissions.add(rebound);
  return rebound;
}

export function resolveMotionFrameReplicator(
  layer: Layer,
  admission: MotionFrameRuntimeAdmission | undefined,
): MotionFrameReplicatorState | null | undefined {
  if (layer.source?.type !== 'motion' || !layer.source.motion?.replicator) return undefined;
  if (admission === undefined) return undefined;
  if (!admission.ok) return null;
  if (!admittedMotionFrameRuntimeAdmissions.has(admission)) return null;
  const entryId = resolveMotionFrameLayerEntryId(layer, admission);
  if (!entryId) return null;
  return admission.consumerInput.frameState.replicators.find(
    (entry) => entry.layerId === entryId,
  ) ?? null;
}

function toMediaFrameDiagnostic(layerId: string, message: string): MotionStableDiagnostic {
  return {
    code: 'MOTION_MEDIA_INVALID_REFERENCE',
    severity: 'error',
    source: 'media',
    message,
    entityId: layerId,
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonZeroOr(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved === 0 ? fallback : resolved;
}

function textureFillFitMode(
  fit: 'contain' | 'cover' | 'fill' | 'stretch' | 'tile',
): MotionMediaFitMode {
  return fit === 'contain' ? 'fit' : fit === 'cover' ? 'fill' : fit;
}

function buildTextureFillMediaEntries(
  layerId: string,
  timelineTimeSeconds: number,
  motion: NonNullable<Layer['source']>['motion'],
  effectiveCount: number,
): MotionFrameMediaEntry[] {
  if (!motion || motion.kind !== 'shape') return [];
  // MD5-B1 binds one texture slot, so frame evaluation follows its first-fill selection.
  const appearance = motion.appearance?.items.find((item) => item.kind === 'texture-fill');
  if (!appearance?.mediaFileId) return [];
  const bounds = getMotionShapeRenderBounds(motion);
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === appearance.mediaFileId);
  const isVideo = mediaFile?.type === 'video';
  const durationSeconds = isVideo ? mediaFile.duration : undefined;
  const source = isVideo
    ? createMotionMediaSourceReference('video', appearance.mediaFileId, durationSeconds ?? Number.NaN)
    : createMotionMediaSourceReference('image', appearance.mediaFileId, null);
  // The frozen timing contract requires its requested value to lie within the
  // source window. Non-finite authored values use the schema's zero-time
  // fallback; finite out-of-range values are clamped to that source window.
  const freezeTimeSeconds = isVideo
    ? Math.min(durationSeconds ?? 0, Math.max(0, finiteOr(appearance.time, 0)))
    : 0;
  const entries: MotionFrameMediaEntry[] = [];
  for (let instanceIndex = 0; instanceIndex < effectiveCount; instanceIndex += 1) {
    const request = {
      contractVersion: MOTION_MEDIA_REQUEST_VERSION,
      binding: createAvailableMotionMediaBinding(source, appearance.mediaFileId),
      clipLocalTimeSeconds: timelineTimeSeconds,
      instanceIndex,
      timing: {
        mode: 'freeze' as const,
        sourceInSeconds: 0,
        sourceOutSeconds: isVideo ? durationSeconds ?? 0 : 0,
        freezeTimeSeconds,
        playbackRate: 1,
        perInstanceOffsetSeconds: 0,
      },
      // Images retain B2's byte-identical 1 Hz zero-time tuple. Video frozen
      // frames use microsecond quantization so an authored still time such as
      // 2.5 resolves to the same frozen time in the reuse key.
      quantization: {
        ticksPerSecond: isVideo ? 1_000_000 : 1,
        rounding: 'nearest-half-up' as const,
      },
      renderParameters: {
        targetWidth: Math.min(16_384, Math.max(1, Math.round(bounds.width))),
        targetHeight: Math.min(16_384, Math.max(1, Math.round(bounds.height))),
        pixelRatio: 1,
        fitMode: textureFillFitMode(appearance.fit),
        positionX: finiteOr(appearance.transform.position.x, 0),
        positionY: finiteOr(appearance.transform.position.y, 0),
        scaleX: nonZeroOr(appearance.transform.scale.x, 1),
        scaleY: nonZeroOr(appearance.transform.scale.y, 1),
        rotationDegrees: finiteOr(appearance.transform.rotation, 0),
        tileRepeatX: 1,
        tileRepeatY: 1,
        tileOffsetX: 0,
        tileOffsetY: 0,
        sampling: 'linear' as const,
      },
    };
    entries.push({ layerId, request, evaluation: evaluateMotionMediaFrame(request) });
  }
  return entries;
}

/**
 * Worker frame-stack transport reconstructs Layers from serializable payloads,
 * so object identity is not preserved across its admission/render boundary.
 * A unique stable layer id is the corresponding transport-safe lookup key;
 * duplicated/nested occurrence ids deliberately remain identity-only.
 */
function resolveMotionFrameLayerEntryId(
  layer: Layer,
  admission: Extract<MotionFrameRuntimeAdmission, { ok: true }>,
): string | null {
  const identityEntryId = admission.layerEntryIds.get(layer);
  if (identityEntryId) return identityEntryId;
  const matchingEntries = admission.consumerInput.frameState.replicators.filter(
    (entry) => entry.layerId === layer.id,
  );
  return matchingEntries.length === 1 ? matchingEntries[0].layerId : null;
}

export function resolveMotionFrameModifier(
  layer: Layer,
  admission: MotionFrameRuntimeAdmission | undefined,
): MotionFrameModifierState | null | undefined {
  if (layer.source?.type !== 'motion' || !layer.source.motion?.modifierStack) return undefined;
  if (admission === undefined) return undefined;
  if (!admission.ok) return null;
  if (!admittedMotionFrameRuntimeAdmissions.has(admission)) return null;
  const entryId = resolveMotionFrameLayerEntryId(layer, admission);
  if (!entryId) return null;
  return admission.consumerInput.frameState.modifiers.find(
    (entry) => entry.layerId === entryId,
  ) ?? null;
}

export function resolveMotionFrameExpressions(
  layer: Layer,
  admission: MotionFrameRuntimeAdmission | undefined,
): readonly MotionFrameExpressionValue[] | null | undefined {
  if (layer.source?.type !== 'motion' || !layer.source.motion?.expressions?.bindings.length) {
    return undefined;
  }
  if (admission === undefined) return undefined;
  if (!admission.ok || !admittedMotionFrameRuntimeAdmissions.has(admission)) return null;
  const entryId = resolveMotionFrameLayerEntryId(layer, admission);
  if (!entryId) return null;
  return admission.consumerInput.frameState.expressions.filter(
    (entry) => entry.entityId === entryId,
  );
}

export function getMotionRenderSizeForAdmission(
  layer: Layer,
  admission: MotionFrameRuntimeAdmission,
): MotionRenderSize {
  const motion = layer.source?.type === 'motion' ? layer.source.motion : undefined;
  return getMotionRenderSize(
    motion,
    resolveMotionFrameReplicator(layer, admission),
    resolveMotionFrameModifier(layer, admission),
    resolveMotionFrameExpressions(layer, admission),
  );
}
