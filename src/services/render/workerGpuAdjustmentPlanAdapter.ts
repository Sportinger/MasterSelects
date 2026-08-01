import type { Layer, LayerSource } from '../../types/layers';
import type { JsonObject, MotionAdjustmentMaskContract } from '../motionDesign/adjustment/contracts';
import { adaptMotionAdjustmentTimelineStack } from '../motionDesign/adjustment/timelineStackAdapter';
import { planMotionAdjustmentOperations } from '../motionDesign/adjustment/operationPlanner';
import { planMotionAdjustmentWorkerGpuExecution } from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import type {
  MotionAdjustmentWorkerGpuExecutionPlan,
  MotionAdjustmentWorkerGpuFrameIdentity,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import type { MotionAdjustmentSourceKind } from '../motionDesign/adjustment/sourceContracts';
import type { MotionAdjustmentRenderSurface } from '../motionDesign/adjustment/supportedEffects';
import type { RenderSurfaceFrameContext } from './renderHostTypes';
import type { WorkerGpuRenderIntent } from './workerGpuRuntimeCommands';
import type { WorkerGpuVideoPresentationLayer } from './workerGpuMediaSourceRegistry';

type WorkerGpuAdjustmentVideoSourceBinding = Pick<
  WorkerGpuVideoPresentationLayer,
  'layerId' | 'sourceId'
>;

/** Runtime/LayerBuilder source kinds accepted at this adapter boundary. */
export type WorkerGpuAdjustmentRuntimeSourceKind =
  | LayerSource['type']
  | 'nestedComposition';

/**
 * A runtime source binding. `sourceKind` is deliberately a LayerBuilder kind,
 * not the already-frozen MotionAdjustmentSourceKind used by the render plan.
 */
export interface WorkerGpuAdjustmentSourceBinding {
  readonly layerId: string;
  readonly sourceKind: WorkerGpuAdjustmentRuntimeSourceKind;
  readonly sourceId: string;
}

interface NormalizedWorkerGpuAdjustmentSourceBinding {
  readonly layerId: string;
  readonly runtimeSourceKind: WorkerGpuAdjustmentRuntimeSourceKind;
  readonly planSourceKind: MotionAdjustmentSourceKind;
  readonly sourceId: string;
}

export interface BuildWorkerGpuAdjustmentPlanInput {
  readonly layers: readonly Layer[];
  /** Legacy video-only bindings retained for existing host callers. */
  readonly videoSources?: readonly WorkerGpuAdjustmentVideoSourceBinding[];
  /** Generic evaluated source bindings for mixed Worker GPU stacks. */
  readonly sourceBindings?: readonly WorkerGpuAdjustmentSourceBinding[];
  readonly frameContext: RenderSurfaceFrameContext;
  readonly requestId: string;
  readonly targetId: string;
  readonly frameIndex: number;
  readonly intent: WorkerGpuRenderIntent;
  readonly nowMs: number;
  /**
   * Authoritative exact frame identity for callers that already froze the
   * render deadline. When present, none of the legacy identity fields are
   * reconstructed or used to derive graph/deadline values.
   */
  readonly frameIdentity?: MotionAdjustmentWorkerGpuFrameIdentity;
  readonly resourceNamespace: string;
  readonly surface?: MotionAdjustmentRenderSurface;
}

function activeRangeAt(evaluationTime: number): { start: number; end: number } {
  return { start: evaluationTime - 1, end: evaluationTime + 1 };
}

function masksFromLayer(layer: Layer): MotionAdjustmentMaskContract[] {
  return (layer.masks ?? [])
    .filter((mask) => mask.enabled !== false && mask.closed)
    .map((mask) => ({
      id: mask.id,
      mode: mask.mode,
      inverted: mask.inverted,
      opacity: mask.opacity,
      feather: mask.feather,
      points: mask.vertices.map((vertex) => ({
        x: vertex.x + mask.position.x,
        y: vertex.y + mask.position.y,
      })),
    }));
}

function mixFromLayer(layer: Layer) {
  return {
    opacity: layer.opacity,
    blendMode: layer.blendMode as 'normal' | 'multiply' | 'screen' | 'overlay' | 'add',
    masks: masksFromLayer(layer),
  };
}

function planSourceKindFromRuntimeKind(
  sourceKind: WorkerGpuAdjustmentRuntimeSourceKind,
): MotionAdjustmentSourceKind {
  switch (sourceKind) {
    case 'motion':
      return 'motion-media';
    case 'text':
      return 'title';
    case 'nestedComposition':
      return 'nested-composition';
    case 'video':
    case 'image':
    case 'solid':
    case 'color':
      return 'timeline-media';
    default:
      throw new Error(
        `Worker GPU adjustment source kind is not supported: ${String(sourceKind)}`,
      );
  }
}

function runtimeSourceKindFromLayer(layer: Layer): WorkerGpuAdjustmentRuntimeSourceKind | null {
  if (!layer.source) return null;
  if (layer.source.nestedComposition) return 'nestedComposition';
  return layer.source.type;
}

function sourceBindingMap(
  input: BuildWorkerGpuAdjustmentPlanInput,
): ReadonlyMap<string, NormalizedWorkerGpuAdjustmentSourceBinding> {
  const sourceByLayerId = new Map<string, NormalizedWorkerGpuAdjustmentSourceBinding>();

  const register = (binding: WorkerGpuAdjustmentSourceBinding): void => {
    const normalized: NormalizedWorkerGpuAdjustmentSourceBinding = {
      layerId: binding.layerId,
      runtimeSourceKind: binding.sourceKind,
      planSourceKind: planSourceKindFromRuntimeKind(binding.sourceKind),
      sourceId: binding.sourceId,
    };
    const existing = sourceByLayerId.get(binding.layerId);
    if (existing) {
      const duplicate = existing.runtimeSourceKind === normalized.runtimeSourceKind
        && existing.sourceId === normalized.sourceId;
      throw new Error(
        `Worker GPU adjustment ${duplicate ? 'duplicate' : 'conflicting'} source binding: ${binding.layerId}`,
      );
    }
    sourceByLayerId.set(binding.layerId, normalized);
  };

  for (const source of input.videoSources ?? []) {
    register({ ...source, sourceKind: 'video' });
  }
  for (const source of input.sourceBindings ?? []) {
    register(source);
  }
  return sourceByLayerId;
}

function resolveSourceLayer(
  layer: Layer,
  sourceByLayerId: ReadonlyMap<string, NormalizedWorkerGpuAdjustmentSourceBinding>,
): NormalizedWorkerGpuAdjustmentSourceBinding {
  const sourceClipId = layer.sourceClipId ?? layer.id;
  const runtimeSourceKind = runtimeSourceKindFromLayer(layer);
  if (runtimeSourceKind === null || runtimeSourceKind === 'motion-adjustment') {
    throw new Error(
      `Worker GPU adjustment stack cannot resolve source layer ${sourceClipId} (${runtimeSourceKind ?? 'missing'})`,
    );
  }

  let planSourceKind: MotionAdjustmentSourceKind;
  try {
    planSourceKind = planSourceKindFromRuntimeKind(runtimeSourceKind);
  } catch {
    throw new Error(
      `Worker GPU adjustment stack does not support source layer ${sourceClipId} (${runtimeSourceKind})`,
    );
  }

  const binding = sourceByLayerId.get(layer.id);
  if (!binding) {
    throw new Error(`Worker GPU adjustment source is not admitted: ${sourceClipId}`);
  }
  if (binding.runtimeSourceKind !== runtimeSourceKind) {
    throw new Error(
      `Worker GPU adjustment source kind mismatch: ${sourceClipId} (${binding.runtimeSourceKind} != ${runtimeSourceKind})`,
    );
  }
  if (binding.planSourceKind !== planSourceKind) {
    throw new Error(`Worker GPU adjustment source mapping mismatch: ${sourceClipId}`);
  }
  return binding;
}

/**
 * Adapts the already-evaluated LayerBuilder output into the frozen MD7 plan.
 * The input Layer array is top-to-bottom; the frozen adapter receives the
 * exact bottom-to-top order used by the shared compositor.
 */
export function buildWorkerGpuAdjustmentExecutionPlan(
  input: BuildWorkerGpuAdjustmentPlanInput,
): MotionAdjustmentWorkerGpuExecutionPlan | null {
  if (!input.layers.some((layer) => layer.visible && layer.source?.type === 'motion-adjustment')) {
    return null;
  }

  const sourceByLayerId = sourceBindingMap(input);
  const evaluationTime = input.frameContext.timelineTimeSeconds;
  const admittedLayers = [...input.layers]
    .reverse()
    .filter((layer) => layer.visible && layer.opacity > 0);

  // Resolve every source before invoking the frozen adapter/planners. Unsupported
  // runtime kinds and stale/conflicting bindings therefore always fail closed.
  const resolvedSources = new Map(
    admittedLayers
      .filter((layer) => layer.source?.type !== 'motion-adjustment')
      .map((layer) => [layer.id, resolveSourceLayer(layer, sourceByLayerId)]),
  );
  const unusedBinding = [...sourceByLayerId.keys()].find((layerId) => !resolvedSources.has(layerId));
  if (unusedBinding) {
    throw new Error(`Worker GPU adjustment source binding is not consumed: ${unusedBinding}`);
  }

  const evaluatedLayers = admittedLayers.map((layer) => {
    const sourceClipId = layer.sourceClipId ?? layer.id;
    if (layer.source?.type === 'motion-adjustment') {
      return {
        kind: 'adjustment' as const,
        sourceClipId,
        enabled: true,
        activeRange: activeRangeAt(evaluationTime),
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        mix: mixFromLayer(layer),
        effects: layer.effects.map((effect) => ({
          id: effect.id,
          effectType: effect.type,
          enabled: effect.enabled,
          parameters: structuredClone(effect.params) as JsonObject,
        })),
      };
    }
    const source = resolvedSources.get(layer.id);
    if (!source) {
      throw new Error(`Worker GPU adjustment source is not admitted: ${sourceClipId}`);
    }
    return {
      kind: 'source' as const,
      sourceClipId,
      enabled: true,
      activeRange: activeRangeAt(evaluationTime),
      source: {
        kind: source.planSourceKind,
        sourceId: source.sourceId,
      },
      mix: mixFromLayer(layer),
    };
  });

  const adaptation = adaptMotionAdjustmentTimelineStack({
    revision: 0,
    compositionId: input.frameContext.compositionId,
    evaluationTime,
    inputOrder: 'bottom-to-top',
    layers: evaluatedLayers,
  });
  const packet = planMotionAdjustmentOperations(adaptation.stack);
  const frameIdentity = input.frameIdentity;
  return planMotionAdjustmentWorkerGpuExecution(packet, input.surface ?? 'preview', {
    deadline: frameIdentity ? {
      requestId: frameIdentity.requestId,
      targetId: frameIdentity.targetId,
      compositionId: frameIdentity.compositionId,
      timelineTime: frameIdentity.timelineTime,
      frameIndex: frameIdentity.frameIndex,
      intent: frameIdentity.intent,
      submitByMs: frameIdentity.submitByMs,
      expireAfterMs: frameIdentity.expireAfterMs,
      exact: frameIdentity.exact,
    } : {
      requestId: input.requestId,
      targetId: input.targetId,
      compositionId: input.frameContext.compositionId,
      timelineTime: evaluationTime,
      frameIndex: input.frameIndex,
      intent: input.intent,
      submitByMs: input.nowMs,
      expireAfterMs: input.nowMs + 1_000,
      exact: true,
    },
    graphVersion: frameIdentity?.graphVersion ?? input.frameIndex,
    resourceNamespace: input.resourceNamespace,
  });
}
