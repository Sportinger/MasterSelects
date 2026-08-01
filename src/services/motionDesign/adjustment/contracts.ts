import {
  assertAdjustmentEffectParameters,
  isSupportedAdjustmentEffectType,
} from './supportedEffects';
import {
  MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_LAYERS,
  MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_OPERATIONS,
  MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK,
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
  isMotionAdjustmentStableReference,
} from './contractLimits';
import {
  assertMotionAdjustmentSourceIdentity,
  isMotionAdjustmentSourceKind,
  type MotionAdjustmentSourceKind,
} from './sourceContracts';
import { assertMotionAdjustmentRevision } from './revisionContract';

export const MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION =
  'motion-adjustment-stack/v1' as const;

export const MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION =
  'motion-adjustment-operation-packet/v1' as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface MotionAdjustmentTimeRange {
  start: number;
  end: number;
}

export interface MotionAdjustmentTransformContract {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export const IDENTITY_ADJUSTMENT_TRANSFORM: MotionAdjustmentTransformContract = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
};

export type MotionAdjustmentBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add';

export interface MotionAdjustmentMaskPointContract {
  x: number;
  y: number;
}

export interface MotionAdjustmentMaskContract {
  id: string;
  mode: 'add' | 'subtract' | 'intersect';
  inverted: boolean;
  opacity: number;
  feather: number;
  points: MotionAdjustmentMaskPointContract[];
}

export interface MotionAdjustmentMixContract {
  opacity: number;
  blendMode: MotionAdjustmentBlendMode;
  masks: MotionAdjustmentMaskContract[];
}

export interface MotionAdjustmentEffectContract {
  id: string;
  effectType: string;
  enabled: boolean;
  parameters: JsonObject;
}

interface MotionAdjustmentLayerBaseContract {
  layerId: string;
  enabled: boolean;
  activeRange: MotionAdjustmentTimeRange;
}

export interface MotionAdjustmentSourceLayerContract
  extends MotionAdjustmentLayerBaseContract {
  kind: 'source';
  source: {
    kind: MotionAdjustmentSourceKind;
    sourceId: string;
  };
  mix: MotionAdjustmentMixContract;
}

export interface MotionAdjustmentLayerContract
  extends MotionAdjustmentLayerBaseContract {
  kind: 'adjustment';
  transform: MotionAdjustmentTransformContract;
  mix: MotionAdjustmentMixContract;
  effects: MotionAdjustmentEffectContract[];
}

export type MotionAdjustmentStackLayerContract =
  | MotionAdjustmentSourceLayerContract
  | MotionAdjustmentLayerContract;

/**
 * Canonical layer order is top-to-bottom, matching the timeline/layer panel.
 * The planner deliberately walks this stack in reverse compositor order.
 */
export interface MotionAdjustmentStackContract {
  contractVersion: typeof MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION;
  revision: number;
  compositionId: string;
  evaluationTime: number;
  inputOrder: 'top-to-bottom';
  layers: MotionAdjustmentStackLayerContract[];
}

export interface InitializeAccumulatorOperation {
  type: 'initialize-accumulator';
  outputRef: string;
}

export interface ResolveSourceOperation {
  type: 'resolve-source';
  layerId: string;
  sourceKind: MotionAdjustmentSourceLayerContract['source']['kind'];
  sourceId: string;
  outputRef: string;
}

export interface CompositeSourceOperation {
  type: 'composite-source';
  layerId: string;
  lowerAccumulatorRef: string;
  sourceRef: string;
  mix: MotionAdjustmentMixContract;
  outputRef: string;
}

export interface SnapshotAccumulatorOperation {
  type: 'snapshot-accumulator';
  layerId: string;
  inputRef: string;
  outputRef: string;
}

export interface ApplyAdjustmentEffectOperation {
  type: 'apply-adjustment-effect';
  layerId: string;
  effectId: string;
  effectType: string;
  parameters: JsonObject;
  inputRef: string;
  outputRef: string;
}

/**
 * Adjustment controls mix the processed lower accumulator over its untouched
 * snapshot. Keeping both references explicit prevents clip controls from being
 * mistaken for transforms on a synthetic source layer.
 */
export interface MixAdjustmentResultOperation {
  type: 'mix-adjustment-result';
  layerId: string;
  preEffectSnapshotRef: string;
  processedAccumulatorRef: string;
  mix: MotionAdjustmentMixContract;
  outputRef: string;
}

export type MotionAdjustmentCompositorOperation =
  | InitializeAccumulatorOperation
  | ResolveSourceOperation
  | CompositeSourceOperation
  | SnapshotAccumulatorOperation
  | ApplyAdjustmentEffectOperation
  | MixAdjustmentResultOperation;

/** Pure, runtime-handle-free packet consumed by a future compositor adapter. */
export interface MotionAdjustmentOperationPacket {
  contractVersion: typeof MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION;
  revision: number;
  compositionId: string;
  evaluationTime: number;
  inputOrder: 'top-to-bottom';
  operationOrder: 'bottom-to-top';
  operations: MotionAdjustmentCompositorOperation[];
  finalAccumulatorRef: string;
}

export function serializeMotionAdjustmentOperationPacket(
  packet: MotionAdjustmentOperationPacket,
): string {
  assertMotionAdjustmentOperationPacket(packet);
  return JSON.stringify(packet);
}

export function parseMotionAdjustmentOperationPacket(
  serialized: string,
): MotionAdjustmentOperationPacket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Motion adjustment operation packet is not valid JSON');
  }
  assertMotionAdjustmentOperationPacket(parsed);
  return parsed;
}

export function assertMotionAdjustmentOperationPacket(
  value: unknown,
): asserts value is MotionAdjustmentOperationPacket {
  assertMotionAdjustmentJsonData(value);
  if (!hasExactKeys(value, [
    'contractVersion',
    'revision',
    'compositionId',
    'evaluationTime',
    'inputOrder',
    'operationOrder',
    'operations',
    'finalAccumulatorRef',
  ])) {
    throw new Error('Motion adjustment operation packet must be an object');
  }
  if (value.contractVersion !== MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION) {
    throw new Error('Unsupported motion adjustment operation packet version');
  }
  assertMotionAdjustmentRevision(value.revision);
  if (
    !isMotionAdjustmentStableId(value.compositionId)
    || !isFiniteNumber(value.evaluationTime)
    || value.inputOrder !== 'top-to-bottom'
    || value.operationOrder !== 'bottom-to-top'
    || !Array.isArray(value.operations)
    || !isMotionAdjustmentStableReference(value.finalAccumulatorRef)
  ) {
    throw new Error('Invalid motion adjustment operation packet');
  }
  if (value.operations.length === 0) {
    throw new Error('Motion adjustment operation packet must initialize an accumulator');
  }
  if (value.operations.length > MOTION_ADJUSTMENT_MAX_OPERATIONS) {
    throw new Error('Motion adjustment operation count exceeds its hard budget');
  }

  const validatedOperations: MotionAdjustmentCompositorOperation[] = [];
  const layerIds = new Set<string>();
  const effectCountsByLayer = new Map<string, number>();
  for (const operation of value.operations) {
    if (!isMotionAdjustmentCompositorOperation(operation)) {
      throw new Error('Invalid motion adjustment compositor operation');
    }
    validatedOperations.push(operation);
    if (operation.type !== 'initialize-accumulator') {
      layerIds.add(operation.layerId);
      if (layerIds.size > MOTION_ADJUSTMENT_MAX_LAYERS) {
        throw new Error('Motion adjustment layer count exceeds its hard budget');
      }
    }
    if (operation.type === 'apply-adjustment-effect') {
      const effectCount = (effectCountsByLayer.get(operation.layerId) ?? 0) + 1;
      if (effectCount > MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER) {
        throw new Error('Motion adjustment effect count exceeds its hard budget');
      }
      effectCountsByLayer.set(operation.layerId, effectCount);
    }
  }
  if (validatedOperations[0]?.type !== 'initialize-accumulator') {
    throw new Error('Motion adjustment operation packet must initialize first');
  }
  assertCanonicalOperationStateMachine(
    validatedOperations,
    value.finalAccumulatorRef,
  );
}

function isMotionAdjustmentCompositorOperation(
  value: unknown,
): value is MotionAdjustmentCompositorOperation {
  if (!isJsonObject(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'initialize-accumulator':
      return hasExactKeys(value, ['type', 'outputRef'])
        && isMotionAdjustmentStableReference(value.outputRef);
    case 'resolve-source':
      if (!hasExactKeys(value, [
        'type',
        'layerId',
        'sourceKind',
        'sourceId',
        'outputRef',
      ])
        || !isMotionAdjustmentStableId(value.layerId)
        || !isMotionAdjustmentSourceKind(value.sourceKind)
        || !isMotionAdjustmentStableReference(value.outputRef)
      ) {
        return false;
      }
      assertMotionAdjustmentSourceIdentity(value.sourceKind, value.sourceId);
      return true;
    case 'composite-source':
      return hasExactKeys(value, [
        'type',
        'layerId',
        'lowerAccumulatorRef',
        'sourceRef',
        'mix',
        'outputRef',
      ])
        && isMotionAdjustmentStableId(value.layerId)
        && isMotionAdjustmentStableReference(value.lowerAccumulatorRef)
        && isMotionAdjustmentStableReference(value.sourceRef)
        && isMotionAdjustmentMix(value.mix)
        && isMotionAdjustmentStableReference(value.outputRef);
    case 'snapshot-accumulator':
      return hasExactKeys(value, [
        'type',
        'layerId',
        'inputRef',
        'outputRef',
      ])
        && isMotionAdjustmentStableId(value.layerId)
        && isMotionAdjustmentStableReference(value.inputRef)
        && isMotionAdjustmentStableReference(value.outputRef);
    case 'apply-adjustment-effect':
      if (!hasExactKeys(value, [
        'type',
        'layerId',
        'effectId',
        'effectType',
        'parameters',
        'inputRef',
        'outputRef',
      ])
        || !isMotionAdjustmentStableId(value.layerId)
        || !isMotionAdjustmentStableId(value.effectId)
        || typeof value.effectType !== 'string'
        || !isSupportedAdjustmentEffectType(value.effectType)
        || !isMotionAdjustmentStableReference(value.inputRef)
        || !isMotionAdjustmentStableReference(value.outputRef)
      ) {
        return false;
      }
      assertAdjustmentEffectParameters(value.effectType, value.parameters);
      return true;
    case 'mix-adjustment-result':
      return hasExactKeys(value, [
        'type',
        'layerId',
        'preEffectSnapshotRef',
        'processedAccumulatorRef',
        'mix',
        'outputRef',
      ])
        && isMotionAdjustmentStableId(value.layerId)
        && isMotionAdjustmentStableReference(value.preEffectSnapshotRef)
        && isMotionAdjustmentStableReference(value.processedAccumulatorRef)
        && isMotionAdjustmentMix(value.mix)
        && isMotionAdjustmentStableReference(value.outputRef);
    default:
      return false;
  }
}

function assertCanonicalOperationStateMachine(
  operations: readonly MotionAdjustmentCompositorOperation[],
  finalAccumulatorRef: string,
): void {
  const initialization = operations[0];
  if (
    initialization?.type !== 'initialize-accumulator'
    || initialization.outputRef !== 'accumulator:transparent'
  ) {
    throw new Error('Motion adjustment operation packet has a non-canonical initialization');
  }

  const seenLayerIds = new Set<string>();
  let currentAccumulatorRef = initialization.outputRef;
  let index = 1;
  while (index < operations.length) {
    const operation = operations[index]!;
    if (operation.type === 'resolve-source') {
      if (seenLayerIds.has(operation.layerId)) {
        throw new Error(`Duplicate motion adjustment layer transition: ${operation.layerId}`);
      }
      const sourceRef = `source:${operation.layerId}`;
      if (operation.outputRef !== sourceRef) {
        throw new Error(`Non-canonical motion adjustment source reference: ${operation.layerId}`);
      }
      const composite = operations[index + 1];
      if (
        composite?.type !== 'composite-source'
        || composite.layerId !== operation.layerId
        || composite.lowerAccumulatorRef !== currentAccumulatorRef
        || composite.sourceRef !== sourceRef
        || composite.outputRef !== `accumulator:after:${operation.layerId}`
      ) {
        throw new Error(`Invalid motion adjustment source transition: ${operation.layerId}`);
      }
      seenLayerIds.add(operation.layerId);
      currentAccumulatorRef = composite.outputRef;
      index += 2;
      continue;
    }

    if (operation.type !== 'snapshot-accumulator') {
      throw new Error('Invalid motion adjustment canonical operation order');
    }
    if (seenLayerIds.has(operation.layerId)) {
      throw new Error(`Duplicate motion adjustment layer transition: ${operation.layerId}`);
    }
    const snapshotRef = `accumulator:before-adjustment:${operation.layerId}`;
    if (
      operation.inputRef !== currentAccumulatorRef
      || operation.outputRef !== snapshotRef
    ) {
      throw new Error(`Invalid motion adjustment snapshot transition: ${operation.layerId}`);
    }

    const effectIds = new Set<string>();
    let processedAccumulatorRef = currentAccumulatorRef;
    index += 1;
    while (operations[index]?.type === 'apply-adjustment-effect') {
      const effect = operations[index] as ApplyAdjustmentEffectOperation;
      if (
        effect.layerId !== operation.layerId
        || effectIds.has(effect.effectId)
        || effect.inputRef !== processedAccumulatorRef
        || effect.outputRef
          !== `adjustment:${operation.layerId}:effect:${effect.effectId}`
      ) {
        throw new Error(`Invalid motion adjustment effect transition: ${operation.layerId}`);
      }
      effectIds.add(effect.effectId);
      processedAccumulatorRef = effect.outputRef;
      index += 1;
    }

    const mix = operations[index];
    if (
      mix?.type !== 'mix-adjustment-result'
      || mix.layerId !== operation.layerId
      || mix.preEffectSnapshotRef !== snapshotRef
      || mix.processedAccumulatorRef !== processedAccumulatorRef
      || mix.outputRef !== `accumulator:after:${operation.layerId}`
    ) {
      throw new Error(`Invalid motion adjustment mix transition: ${operation.layerId}`);
    }
    seenLayerIds.add(operation.layerId);
    currentAccumulatorRef = mix.outputRef;
    index += 1;
  }

  if (finalAccumulatorRef !== currentAccumulatorRef) {
    throw new Error('Motion adjustment final accumulator must match canonical state');
  }
}

function isMotionAdjustmentMix(value: unknown): value is MotionAdjustmentMixContract {
  if (!hasExactKeys(value, ['opacity', 'blendMode', 'masks'])) return false;
  if (
    !isUnitNumber(value.opacity)
    || !isBlendMode(value.blendMode)
    || !Array.isArray(value.masks)
    || value.masks.length > MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER
  ) {
    return false;
  }
  const maskIds = new Set<string>();
  for (const mask of value.masks) {
    if (!isMotionAdjustmentMask(mask) || maskIds.has(mask.id)) return false;
    maskIds.add(mask.id);
  }
  return true;
}

function isMotionAdjustmentMask(value: unknown): value is MotionAdjustmentMaskContract {
  if (!hasExactKeys(value, [
    'id',
    'mode',
    'inverted',
    'opacity',
    'feather',
    'points',
  ])) {
    return false;
  }
  return isMotionAdjustmentStableId(value.id)
    && (value.mode === 'add' || value.mode === 'subtract' || value.mode === 'intersect')
    && typeof value.inverted === 'boolean'
    && isUnitNumber(value.opacity)
    && isFiniteNumber(value.feather)
    && value.feather >= 0
    && Array.isArray(value.points)
    && value.points.length <= MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK
    && value.points.every((point) =>
      hasExactKeys(point, ['x', 'y'])
      && isFiniteNumber(point.x)
      && isFiniteNumber(point.y));
}

function isBlendMode(value: unknown): value is MotionAdjustmentBlendMode {
  return value === 'normal'
    || value === 'multiply'
    || value === 'screen'
    || value === 'overlay'
    || value === 'add';
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is JsonObject {
  if (!isJsonObject(value)) return false;
  const allowedKeys = new Set(keys);
  const actualKeys = Object.keys(value);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnitNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
