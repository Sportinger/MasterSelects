import type {
  EvaluatedReplicatorTransform,
  ReplicatorBounds,
  ReplicatorEvaluation,
} from '../../../services/motionDesign/replicator/contracts';
import type { MotionModifierTargetPath } from '../../../services/motionDesign/modifiers/contracts';
import type { MotionFrameExpressionValue } from '../../../services/motionDesign/contracts/evaluatedMotionFrame';
import type {
  MotionModifierPlan,
  MotionModifierPlannedInstance,
} from '../../../services/motionDesign/modifiers/referencePlanner';
import { composeReplicatorTransforms } from '../../../services/motionDesign/replicator/referenceEvaluator';
import {
  MOTION_REPLICATOR_INSTANCE_DATA_LAYOUT,
  MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
  type ReplicatorRenderPacket,
  type ReplicatorRuntimeDiagnostic,
  type ReplicatorViewport,
} from './runtimeContracts';
import { validateReplicatorViewport } from './resourcePlanning';

export interface ReplicatorRendererAdapterOptions {
  viewport?: ReplicatorViewport;
  strokePadding?: number;
  /** An explicit draw-stage cap. Any prefix truncation is observable. */
  maxDrawInstances?: number;
  modifierPlan?: MotionModifierPlan;
  /** Cache key of the exact Replicator evaluation used to produce modifierPlan. */
  modifierPlanReplicatorCacheKey?: string;
  /** Evaluated expression values for the exact Replicator frame evaluation. */
  expressionValues?: readonly MotionFrameExpressionValue[];
  expressionValuesReplicatorCacheKey?: string;
}

interface TransformAndBounds {
  transform: EvaluatedReplicatorTransform;
  bounds: ReplicatorBounds;
}

type ExpressionValuesByInstance = ReadonlyMap<number, ReadonlyMap<MotionModifierTargetPath, number>>;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function emptyStats() {
  return {
    requestedInstances: 0,
    effectiveInstances: 0,
    submittedInstances: 0,
    visibleInstances: 0,
    culledInstances: 0,
    truncatedInstances: 0,
    encodedFloats: 0,
    encodedBytes: 0,
  };
}

function fail(message: string): ReplicatorRenderPacket {
  return {
    ok: false,
    cacheIdentity: null,
    revision: null,
    instanceDataLayout: MOTION_REPLICATOR_INSTANCE_DATA_LAYOUT,
    instanceData: new Float32Array(0),
    stableIndices: new Uint32Array(0),
    contentBounds: null,
    diagnostics: [{
      code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT',
      severity: 'error',
      message,
    }],
    stats: emptyStats(),
  };
}

function requireFiniteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
  return Object.is(value, -0) ? 0 : value;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function transformedBounds(
  sourceBounds: ReplicatorBounds,
  transform: EvaluatedReplicatorTransform,
): ReplicatorBounds {
  const radians = transform.rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sourceX = [sourceBounds.minX, sourceBounds.maxX, sourceBounds.maxX, sourceBounds.minX];
  const sourceY = [sourceBounds.minY, sourceBounds.minY, sourceBounds.maxY, sourceBounds.maxY];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let corner = 0; corner < 4; corner += 1) {
    const scaledX = sourceX[corner] * transform.scale.x;
    const scaledY = sourceY[corner] * transform.scale.y;
    const x = scaledX * cos - scaledY * sin + transform.position.x;
    const y = scaledX * sin + scaledY * cos + transform.position.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('instance transform produced non-finite bounds');
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function isVisible(
  bounds: ReplicatorBounds,
  viewport: ReplicatorViewport | undefined,
  padding: number,
): boolean {
  if (!viewport) return true;
  return bounds.maxX + padding >= viewport.minX
    && bounds.minX - padding <= viewport.maxX
    && bounds.maxY + padding >= viewport.minY
    && bounds.minY - padding <= viewport.maxY;
}

function unionBounds(
  current: ReplicatorBounds | null,
  next: ReplicatorBounds,
  padding: number,
): ReplicatorBounds {
  const padded = {
    minX: next.minX - padding,
    minY: next.minY - padding,
    maxX: next.maxX + padding,
    maxY: next.maxY + padding,
  };
  if (
    !Number.isFinite(padded.minX)
    || !Number.isFinite(padded.minY)
    || !Number.isFinite(padded.maxX)
    || !Number.isFinite(padded.maxY)
  ) {
    throw new RangeError('stroke padding produced non-finite content bounds');
  }
  if (!current) return padded;
  return {
    minX: Math.min(current.minX, padded.minX),
    minY: Math.min(current.minY, padded.minY),
    maxX: Math.max(current.maxX, padded.maxX),
    maxY: Math.max(current.maxY, padded.maxY),
  };
}

function resolveModifierPlan(
  evaluation: Extract<ReplicatorEvaluation, { ok: true }>,
  plan: MotionModifierPlan | undefined,
  originatingReplicatorCacheKey: string | undefined,
): string | null {
  if (!plan) {
    if (originatingReplicatorCacheKey !== undefined) {
      throw new RangeError('modifier plan Replicator provenance requires a modifier plan');
    }
    return null;
  }
  if (!plan.ok) throw new RangeError('modifier plan failed and cannot be rendered');
  if (originatingReplicatorCacheKey !== evaluation.cacheKey) {
    throw new RangeError('modifier plan Replicator provenance does not match current evaluation');
  }
  if (
    plan.requestedCount !== evaluation.requestedCount
    || plan.effectiveCount !== evaluation.effectiveCount
    || plan.instances.length !== evaluation.instances.length
  ) {
    throw new RangeError('modifier plan counts do not match Replicator evaluation');
  }
  for (let index = 0; index < plan.instances.length; index += 1) {
    const planned = plan.instances[index];
    const evaluated = evaluation.instances[index];
    if (planned.index !== evaluated.index) {
      throw new RangeError('modifier plan stable indices do not match Replicator evaluation');
    }
    validateModifierInstanceBinding(planned, evaluated);
  }
  return plan.cacheKey;
}

function resolveExpressionValues(
  evaluation: Extract<ReplicatorEvaluation, { ok: true }>,
  values: readonly MotionFrameExpressionValue[] | undefined,
  originatingReplicatorCacheKey: string | undefined,
): { cacheKey: string | null; byInstance: ExpressionValuesByInstance } {
  if (!values || values.length === 0) {
    if (originatingReplicatorCacheKey !== undefined) {
      throw new RangeError('expression values Replicator provenance requires expression values');
    }
    return { cacheKey: null, byInstance: new Map() };
  }
  if (originatingReplicatorCacheKey !== evaluation.cacheKey) {
    throw new RangeError('expression values Replicator provenance does not match current evaluation');
  }
  const byInstance = new Map<number, Map<MotionModifierTargetPath, number>>();
  for (const entry of values) {
    if (
      entry.effectiveCount !== evaluation.effectiveCount
      || entry.instanceIndex < 0
      || entry.instanceIndex >= evaluation.effectiveCount
      || !MODIFIER_TARGET_PATHS.includes(entry.propertyPath as MotionModifierTargetPath)
      || !Number.isFinite(entry.resolved.value)
    ) {
      throw new RangeError('expression values do not match Replicator evaluation');
    }
    const paths = byInstance.get(entry.instanceIndex) ?? new Map<MotionModifierTargetPath, number>();
    const path = entry.propertyPath as MotionModifierTargetPath;
    if (paths.has(path)) throw new RangeError('expression values contain a duplicate instance path');
    paths.set(path, entry.resolved.value);
    byInstance.set(entry.instanceIndex, paths);
  }
  return {
    cacheKey: `expressions:${stableHash(JSON.stringify(values.map((entry) => [
      entry.propertyPath,
      entry.contractRevision,
      entry.instanceIndex,
      entry.resolved.value,
    ])))}`,
    byInstance,
  };
}

function equalTransform(
  left: EvaluatedReplicatorTransform,
  right: EvaluatedReplicatorTransform,
): boolean {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && left.rotationDegrees === right.rotationDegrees
    && left.scale.x === right.scale.x
    && left.scale.y === right.scale.y
    && left.opacity === right.opacity;
}

function getTransformPathValue(
  transform: EvaluatedReplicatorTransform,
  path: MotionModifierTargetPath,
): number {
  if (path === 'replicator.offset.position.x') return transform.position.x;
  if (path === 'replicator.offset.position.y') return transform.position.y;
  if (path === 'replicator.offset.rotation') return transform.rotationDegrees;
  if (path === 'replicator.offset.scale.x') return transform.scale.x;
  if (path === 'replicator.offset.scale.y') return transform.scale.y;
  if (path === 'replicator.offset.opacity') return transform.opacity;
  throw new RangeError('modifier plan contains an unsupported target path');
}

function applyExpressionValues(
  offsetTransform: EvaluatedReplicatorTransform,
  values: ReadonlyMap<MotionModifierTargetPath, number>,
): EvaluatedReplicatorTransform {
  return {
    position: {
      x: values.get('replicator.offset.position.x') ?? offsetTransform.position.x,
      y: values.get('replicator.offset.position.y') ?? offsetTransform.position.y,
    },
    rotationDegrees: values.get('replicator.offset.rotation') ?? offsetTransform.rotationDegrees,
    scale: {
      x: values.get('replicator.offset.scale.x') ?? offsetTransform.scale.x,
      y: values.get('replicator.offset.scale.y') ?? offsetTransform.scale.y,
    },
    opacity: values.get('replicator.offset.opacity') ?? offsetTransform.opacity,
  };
}

function validateModifierPathBinding(
  planned: MotionModifierPlannedInstance,
  evaluatedTransform: EvaluatedReplicatorTransform,
  path: MotionModifierTargetPath,
): void {
  let applicationCount = 0;
  let previousAfter = 0;
  for (let index = 0; index < planned.applications.length; index += 1) {
    const application = planned.applications[index];
    if (application.targetPath !== path) continue;
    if (applicationCount === 0) {
      if (application.valueBefore !== getTransformPathValue(evaluatedTransform, path)) {
        throw new RangeError('modifier plan original offset input does not match current evaluation');
      }
    } else if (application.valueBefore !== previousAfter) {
      throw new RangeError('modifier plan application chain is not contiguous');
    }
    previousAfter = application.valueAfter;
    applicationCount += 1;
  }
  const finalValue = getTransformPathValue(planned.offsetTransform, path);
  if (applicationCount === 0) {
    if (finalValue !== getTransformPathValue(evaluatedTransform, path)) {
      throw new RangeError('modifier plan untouched offset input does not match current evaluation');
    }
  } else if (finalValue !== previousAfter) {
    throw new RangeError('modifier plan final offset does not match its application chain');
  }
}

const MODIFIER_TARGET_PATHS: readonly MotionModifierTargetPath[] = [
  'replicator.offset.position.x',
  'replicator.offset.position.y',
  'replicator.offset.rotation',
  'replicator.offset.scale.x',
  'replicator.offset.scale.y',
  'replicator.offset.opacity',
];

function validateModifierInstanceBinding(
  planned: MotionModifierPlannedInstance,
  evaluated: Extract<ReplicatorEvaluation, { ok: true }>['instances'][number],
): void {
  if (planned.normalizedIndex !== evaluated.normalizedIndex) {
    throw new RangeError('modifier plan normalized index does not match current evaluation');
  }
  if (!equalTransform(planned.layoutTransform, evaluated.layoutTransform)) {
    throw new RangeError('modifier plan layout input does not match current evaluation');
  }
  for (let index = 0; index < MODIFIER_TARGET_PATHS.length; index += 1) {
    validateModifierPathBinding(planned, evaluated.offsetTransform, MODIFIER_TARGET_PATHS[index]);
  }
  for (let index = 0; index < planned.values.length; index += 1) {
    const value = planned.values[index];
    if (value.value !== getTransformPathValue(planned.offsetTransform, value.path)) {
      throw new RangeError('modifier plan value table does not match its final offset');
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (planned.values[previous].path === value.path) {
        throw new RangeError('modifier plan value table contains a duplicate target path');
      }
    }
  }
  const recomposed = composeReplicatorTransforms(
    planned.layoutTransform,
    planned.offsetTransform,
  );
  if (!equalTransform(recomposed, planned.transform)) {
    throw new RangeError('modifier plan final transform is inconsistent with its inputs');
  }
}

function writeInstance(
  output: Float32Array,
  outputIndex: number,
  normalizedIndex: number,
  value: TransformAndBounds,
): void {
  const offset = outputIndex * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE;
  const radians = value.transform.rotationDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  output[offset] = cos * value.transform.scale.x;
  output[offset + 1] = -sin * value.transform.scale.y;
  output[offset + 2] = sin * value.transform.scale.x;
  output[offset + 3] = cos * value.transform.scale.y;
  output[offset + 4] = value.transform.position.x;
  output[offset + 5] = value.transform.position.y;
  output[offset + 6] = value.transform.opacity;
  output[offset + 7] = normalizedIndex;
  output[offset + 8] = value.bounds.minX;
  output[offset + 9] = value.bounds.minY;
  output[offset + 10] = value.bounds.maxX;
  output[offset + 11] = value.bounds.maxY;
  for (let field = 0; field < MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE; field += 1) {
    if (Object.is(output[offset + field], -0)) output[offset + field] = 0;
    if (!Number.isFinite(output[offset + field])) {
      throw new RangeError('instance data contains a non-finite field');
    }
  }
}

/**
 * Converts the admitted CPU oracle result into one dense shader-facing packet.
 * No per-instance clip, persistence, decoder, or React records are created.
 */
export function createReplicatorRenderPacket(
  evaluation: ReplicatorEvaluation,
  options: ReplicatorRendererAdapterOptions = {},
): ReplicatorRenderPacket {
  try {
    if (!evaluation.ok) return fail('Replicator evaluation failed and cannot be rendered');
    if (evaluation.instances.length !== evaluation.effectiveCount) {
      return fail('Replicator instance count does not match effectiveCount');
    }
    const modifierCacheKey = resolveModifierPlan(
      evaluation,
      options.modifierPlan,
      options.modifierPlanReplicatorCacheKey,
    );
    const modifierInstances = options.modifierPlan?.ok ? options.modifierPlan.instances : null;
    const expressionValues = resolveExpressionValues(
      evaluation,
      options.expressionValues,
      options.expressionValuesReplicatorCacheKey,
    );
    const viewport = options.viewport ? validateReplicatorViewport(options.viewport) : undefined;
    const strokePadding = requireFiniteNonNegative(options.strokePadding ?? 0, 'strokePadding');
    const maxDrawInstances = options.maxDrawInstances === undefined
      ? evaluation.effectiveCount
      : requirePositiveSafeInteger(options.maxDrawInstances, 'maxDrawInstances');
    const submittedInstances = Math.min(evaluation.effectiveCount, maxDrawInstances);
    const truncatedInstances = evaluation.effectiveCount - submittedInstances;
    const diagnostics: Array<
      Extract<ReplicatorRenderPacket, { ok: true }>['diagnostics'][number]
    > = [...evaluation.diagnostics];
    if (truncatedInstances > 0) {
      const diagnostic: ReplicatorRuntimeDiagnostic = {
        code: 'MOTION_REPLICATOR_RENDERER_TRUNCATED',
        severity: 'warning',
        message: `Renderer submitted ${submittedInstances} of ${evaluation.effectiveCount} effective instances`,
        limit: maxDrawInstances,
        actual: evaluation.effectiveCount,
      };
      diagnostics.push(diagnostic);
    }

    let visibleCount = 0;
    for (let index = 0; index < submittedInstances; index += 1) {
      const base = evaluation.instances[index];
      const modified = modifierInstances?.[index];
      if (modified?.clipped) continue;
      const expressions = expressionValues.byInstance.get(base.index);
      const transform = expressions
        ? composeReplicatorTransforms(
            modified?.layoutTransform ?? base.layoutTransform,
            applyExpressionValues(modified?.offsetTransform ?? base.offsetTransform, expressions),
          )
        : modified?.transform ?? base.transform;
      const bounds = modified || expressions
        ? transformedBounds(evaluation.sourceBounds, transform)
        : base.bounds;
      if (isVisible(bounds, viewport, strokePadding)) visibleCount += 1;
    }

    const instanceData = new Float32Array(
      visibleCount * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
    );
    const stableIndices = new Uint32Array(visibleCount);
    let contentBounds: ReplicatorBounds | null = null;
    let outputIndex = 0;
    for (let index = 0; index < submittedInstances; index += 1) {
      const base = evaluation.instances[index];
      const modified = modifierInstances?.[index];
      if (modified?.clipped) continue;
      const expressions = expressionValues.byInstance.get(base.index);
      const transform = expressions
        ? composeReplicatorTransforms(
            modified?.layoutTransform ?? base.layoutTransform,
            applyExpressionValues(modified?.offsetTransform ?? base.offsetTransform, expressions),
          )
        : modified?.transform ?? base.transform;
      const bounds = modified || expressions
        ? transformedBounds(evaluation.sourceBounds, transform)
        : base.bounds;
      if (!isVisible(bounds, viewport, strokePadding)) continue;
      writeInstance(instanceData, outputIndex, base.normalizedIndex, { transform, bounds });
      stableIndices[outputIndex] = base.index;
      contentBounds = unionBounds(contentBounds, bounds, strokePadding);
      outputIndex += 1;
    }
    const viewportIdentity = viewport
      ? `${viewport.minX},${viewport.minY},${viewport.maxX},${viewport.maxY}`
      : 'none';
    const cacheIdentity = [
      evaluation.cacheKey,
      modifierCacheKey ?? 'no-modifiers',
      expressionValues.cacheKey ?? 'no-expressions',
      `draw:${maxDrawInstances}`,
      `viewport:${viewportIdentity}`,
      `stroke:${strokePadding}`,
    ].join('|');

    return {
      ok: true,
      cacheIdentity,
      revision: evaluation.revision,
      instanceDataLayout: MOTION_REPLICATOR_INSTANCE_DATA_LAYOUT,
      instanceData,
      stableIndices,
      contentBounds,
      diagnostics,
      stats: {
        requestedInstances: evaluation.requestedCount,
        effectiveInstances: evaluation.effectiveCount,
        submittedInstances,
        visibleInstances: visibleCount,
        culledInstances: submittedInstances - visibleCount,
        truncatedInstances,
        encodedFloats: instanceData.length,
        encodedBytes: instanceData.byteLength,
      },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unknown Replicator render failure');
  }
}
