import {
  MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
  type JsonObject,
  type JsonValue,
  type MotionAdjustmentEffectContract,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentStackContract,
  type MotionAdjustmentStackLayerContract,
  type MotionAdjustmentTimeRange,
  type MotionAdjustmentTransformContract,
} from './contracts';
import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import { planMotionAdjustmentOperations } from './operationPlanner';
import { assertMotionAdjustmentRevision } from './revisionContract';
import type { MotionAdjustmentSourceKind } from './sourceContracts';

interface EvaluatedTimelineLayerBase {
  readonly sourceClipId: string;
  readonly enabled: boolean;
  readonly activeRange: MotionAdjustmentTimeRange;
}

export interface EvaluatedTimelineSourceLayer
  extends EvaluatedTimelineLayerBase {
  readonly kind: 'source';
  readonly source: {
    readonly kind: MotionAdjustmentSourceKind;
    readonly sourceId: string;
  };
  readonly mix: MotionAdjustmentMixContract;
}

export interface EvaluatedTimelineAdjustmentLayer
  extends EvaluatedTimelineLayerBase {
  readonly kind: 'adjustment';
  readonly transform: MotionAdjustmentTransformContract;
  readonly mix: MotionAdjustmentMixContract;
  readonly effects: readonly MotionAdjustmentEffectContract[];
}

export type EvaluatedTimelineStackLayer =
  | EvaluatedTimelineSourceLayer
  | EvaluatedTimelineAdjustmentLayer;

/**
 * Pure adapter input. The caller has already evaluated visibility/time and
 * supplies the exact order in which the compositor can walk the timeline.
 */
export interface MotionAdjustmentTimelineStackInput {
  readonly revision: number;
  readonly compositionId: string;
  readonly evaluationTime: number;
  readonly inputOrder: 'bottom-to-top';
  readonly layers: readonly EvaluatedTimelineStackLayer[];
}

export interface MotionAdjustmentTimelineSourceBinding {
  readonly sourceClipId: string;
  readonly layerId: string;
  readonly sourceKind: MotionAdjustmentSourceKind;
  readonly sourceId: string;
  readonly bottomToTopIndex: number;
}

export interface MotionAdjustmentTimelineStackAdaptation {
  readonly stack: MotionAdjustmentStackContract;
  readonly sourceBindings: readonly MotionAdjustmentTimelineSourceBinding[];
}

export type MotionAdjustmentTimelineStackAdapterErrorCode =
  | 'INVALID_TIMELINE_STACK_INPUT'
  | 'MISSING_STABLE_SOURCE_CLIP_ID'
  | 'DUPLICATE_SOURCE_CLIP_ID';

export class MotionAdjustmentTimelineStackAdapterError extends Error {
  readonly code: MotionAdjustmentTimelineStackAdapterErrorCode;
  readonly sourceClipId: string | undefined;

  constructor(
    code: MotionAdjustmentTimelineStackAdapterErrorCode,
    message: string,
    sourceClipId?: string,
  ) {
    super(message);
    this.name = 'MotionAdjustmentTimelineStackAdapterError';
    this.code = code;
    this.sourceClipId = sourceClipId;
  }
}

/**
 * Converts the evaluated compositor order into the canonical persisted stack
 * order. Stable sourceClipId values become stack layer ids and source bindings,
 * so preview and export can resolve the same timeline owners.
 */
export function adaptMotionAdjustmentTimelineStack(
  input: MotionAdjustmentTimelineStackInput,
): MotionAdjustmentTimelineStackAdaptation {
  assertMotionAdjustmentJsonData(input);
  assertValidRoot(input);

  const seenSourceClipIds = new Set<string>();
  const bottomToTopLayers: MotionAdjustmentStackContract['layers'] = [];

  for (const layer of input.layers) {
    if (!isPlainRecord(layer)) {
      throw invalidInput('Invalid evaluated timeline stack layer');
    }
    const sourceClipId = layer.sourceClipId;
    if (!isMotionAdjustmentStableId(sourceClipId)) {
      throw new MotionAdjustmentTimelineStackAdapterError(
        'MISSING_STABLE_SOURCE_CLIP_ID',
        'Evaluated timeline stack layers require a stable sourceClipId',
      );
    }
    if (seenSourceClipIds.has(sourceClipId)) {
      throw new MotionAdjustmentTimelineStackAdapterError(
        'DUPLICATE_SOURCE_CLIP_ID',
        `Duplicate evaluated timeline sourceClipId: ${sourceClipId}`,
        sourceClipId,
      );
    }
    seenSourceClipIds.add(sourceClipId);

    if (layer.kind === 'source') {
      assertExactLayerKeys(layer, [
        'kind',
        'sourceClipId',
        'enabled',
        'activeRange',
        'source',
        'mix',
      ]);
      bottomToTopLayers.push(cloneStackLayer(layer, sourceClipId));
      continue;
    }

    if (layer.kind === 'adjustment') {
      assertExactLayerKeys(layer, [
        'kind',
        'sourceClipId',
        'enabled',
        'activeRange',
        'transform',
        'mix',
        'effects',
      ]);
      bottomToTopLayers.push(cloneStackLayer(layer, sourceClipId));
      continue;
    }

    throw invalidInput(`Unknown evaluated timeline layer kind: ${String(layer.kind)}`);
  }

  const stack: MotionAdjustmentStackContract = {
    contractVersion: MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
    revision: input.revision,
    compositionId: input.compositionId,
    evaluationTime: input.evaluationTime,
    inputOrder: 'top-to-bottom',
    layers: [...bottomToTopLayers].reverse(),
  };

  // Reuse the frozen contract/planner as the final, fail-closed admission gate.
  planMotionAdjustmentOperations(stack);

  const sourceBindings = bottomToTopLayers.flatMap((layer, bottomToTopIndex) =>
    layer.kind === 'source'
      ? [{
          sourceClipId: layer.layerId,
          layerId: layer.layerId,
          sourceKind: layer.source.kind,
          sourceId: layer.source.sourceId,
          bottomToTopIndex,
        }]
      : []);

  return { stack, sourceBindings };
}

function assertValidRoot(input: unknown): asserts input is MotionAdjustmentTimelineStackInput {
  if (
    !hasExactKeys(input, [
      'revision',
      'compositionId',
      'evaluationTime',
      'inputOrder',
      'layers',
    ])
  ) {
    throw invalidInput('Invalid motion adjustment timeline stack input');
  }
  assertMotionAdjustmentRevision(input.revision);
  if (
    !isMotionAdjustmentStableId(input.compositionId)
    || typeof input.evaluationTime !== 'number'
    || !Number.isFinite(input.evaluationTime)
    || input.inputOrder !== 'bottom-to-top'
    || !Array.isArray(input.layers)
  ) {
    throw invalidInput('Invalid motion adjustment timeline stack input');
  }
}

function assertExactLayerKeys(
  layer: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (!hasExactKeys(layer, keys)) {
    throw invalidInput('Invalid evaluated timeline stack layer');
  }
}

function cloneStackLayer(
  layer: Record<string, unknown> & EvaluatedTimelineStackLayer,
  layerId: string,
): MotionAdjustmentStackLayerContract {
  const cloned = cloneJsonObject(layer as unknown as JsonObject);
  delete cloned.sourceClipId;
  cloned.layerId = layerId;
  return cloned as unknown as MotionAdjustmentStackLayerContract;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
  );
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === 'object') return cloneJsonObject(value);
  return value;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidInput(message: string): MotionAdjustmentTimelineStackAdapterError {
  return new MotionAdjustmentTimelineStackAdapterError(
    'INVALID_TIMELINE_STACK_INPUT',
    message,
  );
}
