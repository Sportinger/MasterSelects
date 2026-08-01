import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
  isMotionAdjustmentStableReference,
} from './contractLimits';
import type { ApplyAdjustmentEffectOperation } from './contracts';
import {
  UnsupportedAdjustmentEffectError,
  isSupportedAdjustmentEffectType,
  normalizeAdjustmentEffectParameters,
  type SupportedAdjustmentEffectType,
} from './supportedEffects';

export const MOTION_ADJUSTMENT_EFFECT_ADAPTER_VERSION =
  'motion-adjustment-effect-adapter/v1' as const;

export interface MotionAdjustmentColorMatrixEffect {
  readonly adapterVersion: typeof MOTION_ADJUSTMENT_EFFECT_ADAPTER_VERSION;
  readonly primitive: 'color-matrix-4x5';
  readonly effectType: Exclude<SupportedAdjustmentEffectType, 'gaussian-blur'>;
  readonly parameters: Readonly<Record<string, number>>;
  readonly matrix: readonly number[];
}

export interface MotionAdjustmentGaussianBlurEffect {
  readonly adapterVersion: typeof MOTION_ADJUSTMENT_EFFECT_ADAPTER_VERSION;
  readonly primitive: 'separable-gaussian-blur';
  readonly effectType: 'gaussian-blur';
  readonly parameters: Readonly<{ radius: number; samples: number }>;
  readonly passes: readonly ['horizontal', 'vertical'];
}

export type MotionAdjustmentEvaluatedEffect =
  | MotionAdjustmentColorMatrixEffect
  | MotionAdjustmentGaussianBlurEffect;

/**
 * Converts one frozen effect operation into a renderer-neutral primitive.
 * The complete operation is admitted before any result object is produced.
 */
export function planMotionAdjustmentEffectAdapter(
  operation: ApplyAdjustmentEffectOperation,
): MotionAdjustmentEvaluatedEffect {
  assertMotionAdjustmentJsonData(operation);
  if (
    !isPlainRecord(operation)
    || !hasExactKeys(operation, [
      'type',
      'layerId',
      'effectId',
      'effectType',
      'parameters',
      'inputRef',
      'outputRef',
    ])
    || operation.type !== 'apply-adjustment-effect'
    || !isMotionAdjustmentStableId(operation.layerId)
    || !isMotionAdjustmentStableId(operation.effectId)
    || !isMotionAdjustmentStableReference(operation.inputRef)
    || !isMotionAdjustmentStableReference(operation.outputRef)
    || typeof operation.effectType !== 'string'
  ) {
    throw new Error('Invalid motion adjustment effect adapter operation');
  }
  if (!isSupportedAdjustmentEffectType(operation.effectType)) {
    throw new UnsupportedAdjustmentEffectError(
      operation.layerId,
      operation.effectId,
      operation.effectType,
    );
  }

  const parameters = normalizeAdjustmentEffectParameters(
    operation.effectType,
    operation.parameters,
  );
  if (operation.effectType === 'gaussian-blur') {
    return Object.freeze({
      adapterVersion: MOTION_ADJUSTMENT_EFFECT_ADAPTER_VERSION,
      primitive: 'separable-gaussian-blur',
      effectType: operation.effectType,
      parameters: Object.freeze({
        radius: parameters.radius!,
        samples: parameters.samples!,
      }),
      passes: Object.freeze(['horizontal', 'vertical'] as const),
    });
  }

  return Object.freeze({
    adapterVersion: MOTION_ADJUSTMENT_EFFECT_ADAPTER_VERSION,
    primitive: 'color-matrix-4x5',
    effectType: operation.effectType,
    parameters: Object.freeze({ ...parameters }),
    matrix: Object.freeze(createColorMatrix(operation.effectType, parameters)),
  });
}

function createColorMatrix(
  effectType: Exclude<SupportedAdjustmentEffectType, 'gaussian-blur'>,
  parameters: Readonly<Record<string, number>>,
): number[] {
  switch (effectType) {
    case 'brightness': {
      const amount = parameters.amount!;
      return [
        1, 0, 0, 0, amount,
        0, 1, 0, 0, amount,
        0, 0, 1, 0, amount,
        0, 0, 0, 1, 0,
      ];
    }
    case 'contrast': {
      const amount = parameters.amount!;
      const offset = 0.5 * (1 - amount);
      return [
        amount, 0, 0, 0, offset,
        0, amount, 0, 0, offset,
        0, 0, amount, 0, offset,
        0, 0, 0, 1, 0,
      ];
    }
    case 'saturation': {
      const amount = parameters.amount!;
      const inverse = 1 - amount;
      const red = 0.2126 * inverse;
      const green = 0.7152 * inverse;
      const blue = 0.0722 * inverse;
      return [
        red + amount, green, blue, 0, 0,
        red, green + amount, blue, 0, 0,
        red, green, blue + amount, 0, 0,
        0, 0, 0, 1, 0,
      ];
    }
    case 'invert':
      return [
        -1, 0, 0, 0, 1,
        0, -1, 0, 0, 1,
        0, 0, -1, 0, 1,
        0, 0, 0, 1, 0,
      ];
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}
