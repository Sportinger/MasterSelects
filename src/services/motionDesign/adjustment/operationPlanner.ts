import {
  IDENTITY_ADJUSTMENT_TRANSFORM,
  MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
  MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
  assertMotionAdjustmentOperationPacket,
  type MotionAdjustmentCompositorOperation,
  type MotionAdjustmentLayerContract,
  type MotionAdjustmentMaskContract,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentOperationPacket,
  type MotionAdjustmentStackContract,
  type MotionAdjustmentStackLayerContract,
  type MotionAdjustmentTransformContract,
} from './contracts';
import {
  assertSupportedAdjustmentEffect,
  normalizeAdjustmentEffectParameters,
} from './supportedEffects';
import {
  MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_LAYERS,
  MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_OPERATIONS,
  MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK,
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import { assertMotionAdjustmentSourceIdentity } from './sourceContracts';
import { assertMotionAdjustmentRevision } from './revisionContract';

export type MotionAdjustmentContractErrorCode =
  | 'INVALID_ADJUSTMENT_CONTRACT'
  | 'NON_IDENTITY_ADJUSTMENT_TRANSFORM';

export class MotionAdjustmentContractError extends Error {
  readonly code: MotionAdjustmentContractErrorCode;
  readonly layerId: string | undefined;

  constructor(
    code: MotionAdjustmentContractErrorCode,
    message: string,
    layerId?: string,
  ) {
    super(message);
    this.name = 'MotionAdjustmentContractError';
    this.code = code;
    this.layerId = layerId;
  }
}

/**
 * Produces the deterministic parent-level compositor operation stream.
 * Validation is a complete first pass, so unsupported contracts fail before
 * an operation array or any derived result is built.
 */
export function planMotionAdjustmentOperations(
  stack: MotionAdjustmentStackContract,
): MotionAdjustmentOperationPacket {
  assertValidStackContract(stack);

  const operations: MotionAdjustmentCompositorOperation[] = [];
  let accumulatorRef = 'accumulator:transparent';
  operations.push({
    type: 'initialize-accumulator',
    outputRef: accumulatorRef,
  });

  const activeLayers = stack.layers.filter((layer) =>
    isLayerActiveAt(layer, stack.evaluationTime));

  for (const layer of [...activeLayers].reverse()) {
    if (layer.kind === 'source') {
      const sourceRef = `source:${layer.layerId}`;
      operations.push({
        type: 'resolve-source',
        layerId: layer.layerId,
        sourceKind: layer.source.kind,
        sourceId: layer.source.sourceId,
        outputRef: sourceRef,
      });
      const outputRef = `accumulator:after:${layer.layerId}`;
      operations.push({
        type: 'composite-source',
        layerId: layer.layerId,
        lowerAccumulatorRef: accumulatorRef,
        sourceRef,
        mix: cloneMix(layer.mix),
        outputRef,
      });
      accumulatorRef = outputRef;
      continue;
    }

    accumulatorRef = appendAdjustmentOperations(
      layer,
      accumulatorRef,
      operations,
    );
  }

  const packet: MotionAdjustmentOperationPacket = {
    contractVersion: MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
    revision: stack.revision,
    compositionId: stack.compositionId,
    evaluationTime: stack.evaluationTime,
    inputOrder: 'top-to-bottom',
    operationOrder: 'bottom-to-top',
    operations,
    finalAccumulatorRef: accumulatorRef,
  };
  assertMotionAdjustmentOperationPacket(packet);
  return packet;
}

function appendAdjustmentOperations(
  layer: MotionAdjustmentLayerContract,
  inputAccumulatorRef: string,
  operations: MotionAdjustmentCompositorOperation[],
): string {
  const snapshotRef = `accumulator:before-adjustment:${layer.layerId}`;
  operations.push({
    type: 'snapshot-accumulator',
    layerId: layer.layerId,
    inputRef: inputAccumulatorRef,
    outputRef: snapshotRef,
  });

  let processedAccumulatorRef = inputAccumulatorRef;
  for (const effect of layer.effects) {
    if (!effect.enabled) continue;
    assertSupportedAdjustmentEffect(layer.layerId, effect);
    const outputRef = `adjustment:${layer.layerId}:effect:${effect.id}`;
    operations.push({
      type: 'apply-adjustment-effect',
      layerId: layer.layerId,
      effectId: effect.id,
      effectType: effect.effectType,
      parameters: normalizeAdjustmentEffectParameters(
        effect.effectType,
        effect.parameters,
      ),
      inputRef: processedAccumulatorRef,
      outputRef,
    });
    processedAccumulatorRef = outputRef;
  }

  const outputRef = `accumulator:after:${layer.layerId}`;
  operations.push({
    type: 'mix-adjustment-result',
    layerId: layer.layerId,
    preEffectSnapshotRef: snapshotRef,
    processedAccumulatorRef,
    mix: cloneMix(layer.mix),
    outputRef,
  });
  return outputRef;
}

function assertValidStackContract(
  stack: MotionAdjustmentStackContract,
): void {
  assertMotionAdjustmentJsonData(stack);
  if (
    !isPlainRecord(stack)
    || !hasExactKeys(stack, [
      'contractVersion',
      'revision',
      'compositionId',
      'evaluationTime',
      'inputOrder',
      'layers',
    ])
  ) {
    throw invalidContract('Invalid motion adjustment stack contract');
  }
  assertMotionAdjustmentRevision(stack.revision);
  if (
    stack.contractVersion !== MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION
    || stack.inputOrder !== 'top-to-bottom'
    || !isMotionAdjustmentStableId(stack.compositionId)
    || !isFiniteNumber(stack.evaluationTime)
    || !Array.isArray(stack.layers)
  ) {
    throw invalidContract('Invalid motion adjustment stack contract');
  }
  if (stack.layers.length > MOTION_ADJUSTMENT_MAX_LAYERS) {
    throw invalidContract('Motion adjustment layer count exceeds its hard budget');
  }

  const layerIds = new Set<string>();
  let predictedOperationCount = 1;
  for (const layer of stack.layers) {
    assertValidLayer(layer, layerIds);
    if (!isLayerActiveAt(layer, stack.evaluationTime)) continue;
    predictedOperationCount += layer.kind === 'source'
      ? 2
      : 2 + layer.effects.filter((effect) => effect.enabled).length;
    if (predictedOperationCount > MOTION_ADJUSTMENT_MAX_OPERATIONS) {
      throw invalidContract('Motion adjustment operation count exceeds its hard budget');
    }
  }
}

function assertValidLayer(
  layer: MotionAdjustmentStackLayerContract,
  layerIds: Set<string>,
): void {
  if (!isPlainRecord(layer)) {
    throw invalidContract('Invalid adjustment stack layer');
  }
  const runtimeKind: unknown = layer.kind;
  const expectedKeys = runtimeKind === 'source'
    ? ['kind', 'layerId', 'enabled', 'activeRange', 'source', 'mix']
    : ['kind', 'layerId', 'enabled', 'activeRange', 'transform', 'mix', 'effects'];
  if (
    !hasExactKeys(layer, expectedKeys)
    || !isMotionAdjustmentStableId(layer.layerId)
    || layerIds.has(layer.layerId)
    || typeof layer.enabled !== 'boolean'
    || !isValidTimeRange(layer.activeRange)
  ) {
    throw invalidContract('Invalid or duplicate adjustment stack layer');
  }
  layerIds.add(layer.layerId);
  assertValidMix(layer.mix, layer.layerId);

  if (layer.kind === 'source') {
    if (
      !isPlainRecord(layer.source)
      || !hasExactKeys(layer.source, ['kind', 'sourceId'])
    ) {
      throw invalidContract(`Invalid source on layer ${layer.layerId}`, layer.layerId);
    }
    assertMotionAdjustmentSourceIdentity(layer.source.kind, layer.source.sourceId);
    return;
  }

  if (runtimeKind !== 'adjustment') {
    throw invalidContract(`Unknown layer kind on ${layer.layerId}`, layer.layerId);
  }
  assertIdentityAdjustmentTransform(layer.layerId, layer.transform);
  if (
    !Array.isArray(layer.effects)
    || layer.effects.length > MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER
  ) {
    throw invalidContract(`Invalid effects on ${layer.layerId}`, layer.layerId);
  }
  const effectIds = new Set<string>();
  for (const effect of layer.effects) {
    if (
      !isPlainRecord(effect)
      || !hasExactKeys(effect, [
        'id',
        'effectType',
        'enabled',
        'parameters',
      ])
      || !isMotionAdjustmentStableId(effect.id)
      || effectIds.has(effect.id)
      || typeof effect.enabled !== 'boolean'
    ) {
      throw invalidContract(`Invalid effect on ${layer.layerId}`, layer.layerId);
    }
    effectIds.add(effect.id);
    assertSupportedAdjustmentEffect(layer.layerId, effect);
  }
}

function assertIdentityAdjustmentTransform(
  layerId: string,
  transform: MotionAdjustmentTransformContract,
): void {
  const identity = IDENTITY_ADJUSTMENT_TRANSFORM;
  if (
    !isPlainRecord(transform)
    || !hasExactKeys(transform, [
      'x',
      'y',
      'scaleX',
      'scaleY',
      'rotation',
      'anchorX',
      'anchorY',
    ])
    || transform.x !== identity.x
    || transform.y !== identity.y
    || transform.scaleX !== identity.scaleX
    || transform.scaleY !== identity.scaleY
    || transform.rotation !== identity.rotation
    || transform.anchorX !== identity.anchorX
    || transform.anchorY !== identity.anchorY
  ) {
    throw new MotionAdjustmentContractError(
      'NON_IDENTITY_ADJUSTMENT_TRANSFORM',
      `Adjustment layer ${layerId} must use the identity transform in v1`,
      layerId,
    );
  }
}

function assertValidMix(
  mix: MotionAdjustmentMixContract,
  layerId: string,
): void {
  const blendModes = new Set(['normal', 'multiply', 'screen', 'overlay', 'add']);
  if (
    !isPlainRecord(mix)
    || !hasExactKeys(mix, ['opacity', 'blendMode', 'masks'])
    || !isUnitNumber(mix.opacity)
    || !blendModes.has(mix.blendMode)
    || !Array.isArray(mix.masks)
    || mix.masks.length > MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER
  ) {
    throw invalidContract(`Invalid mix controls on ${layerId}`, layerId);
  }
  const maskIds = new Set<string>();
  for (const mask of mix.masks) {
    assertValidMask(mask, layerId, maskIds);
  }
}

function assertValidMask(
  mask: MotionAdjustmentMaskContract,
  layerId: string,
  maskIds: Set<string>,
): void {
  const maskModes = new Set(['add', 'subtract', 'intersect']);
  if (
    !isPlainRecord(mask)
    || !hasExactKeys(mask, [
      'id',
      'mode',
      'inverted',
      'opacity',
      'feather',
      'points',
    ])
    || !isMotionAdjustmentStableId(mask.id)
    || maskIds.has(mask.id)
    || !maskModes.has(mask.mode)
    || typeof mask.inverted !== 'boolean'
    || !isUnitNumber(mask.opacity)
    || !isFiniteNumber(mask.feather)
    || mask.feather < 0
    || !Array.isArray(mask.points)
    || mask.points.length > MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK
    || mask.points.some((point) =>
      !isPlainRecord(point)
      || !hasExactKeys(point, ['x', 'y'])
      || !isFiniteNumber(point.x)
      || !isFiniteNumber(point.y))
  ) {
    throw invalidContract(`Invalid mask on ${layerId}`, layerId);
  }
  maskIds.add(mask.id);
}

function isLayerActiveAt(
  layer: MotionAdjustmentStackLayerContract,
  evaluationTime: number,
): boolean {
  return layer.enabled
    && evaluationTime >= layer.activeRange.start
    && evaluationTime < layer.activeRange.end;
}

function isValidTimeRange(value: unknown): value is { start: number; end: number } {
  return isPlainRecord(value)
    && hasExactKeys(value, ['start', 'end'])
    && isFiniteNumber(value.start)
    && isFiniteNumber(value.end)
    && value.end >= value.start;
}

function cloneMix(mix: MotionAdjustmentMixContract): MotionAdjustmentMixContract {
  return {
    opacity: mix.opacity,
    blendMode: mix.blendMode,
    masks: mix.masks.map((mask) => ({
      id: mask.id,
      mode: mask.mode,
      inverted: mask.inverted,
      opacity: mask.opacity,
      feather: mask.feather,
      points: mask.points.map((point) => ({ ...point })),
    })),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnitNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function invalidContract(
  message: string,
  layerId?: string,
): MotionAdjustmentContractError {
  return new MotionAdjustmentContractError(
    'INVALID_ADJUSTMENT_CONTRACT',
    message,
    layerId,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: object,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}
