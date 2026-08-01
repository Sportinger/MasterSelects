import type {
  JsonObject,
  MotionAdjustmentEffectContract,
} from './contracts';
import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import {
  InvalidAdjustmentEffectParametersError,
  UnsupportedAdjustmentEffectError,
  normalizeAdjustmentEffectParameters,
  type SupportedAdjustmentEffectType,
} from './supportedEffects';

export const MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP = Object.freeze({
  brightness: 'brightness',
  contrast: 'contrast',
  saturation: 'saturation',
  invert: 'invert',
  'gaussian-blur': 'gaussian-blur',
  blur: 'gaussian-blur',
} as const satisfies Readonly<Record<string, SupportedAdjustmentEffectType>>);

export interface TimelineAdjustmentEffectInput {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly params: JsonObject;
}

export interface AdaptTimelineAdjustmentEffectsInput {
  readonly layerId: string;
  readonly effects: readonly TimelineAdjustmentEffectInput[];
}

export type MotionAdjustmentSupportedEffectAdapterErrorCode =
  | 'INVALID_ADJUSTMENT_EFFECT_INPUT'
  | 'DUPLICATE_ADJUSTMENT_EFFECT_ID';

export class MotionAdjustmentSupportedEffectAdapterError extends Error {
  readonly code: MotionAdjustmentSupportedEffectAdapterErrorCode;
  readonly layerId: string | undefined;
  readonly effectId: string | undefined;

  constructor(
    code: MotionAdjustmentSupportedEffectAdapterErrorCode,
    message: string,
    layerId?: string,
    effectId?: string,
  ) {
    super(message);
    this.name = 'MotionAdjustmentSupportedEffectAdapterError';
    this.code = code;
    this.layerId = layerId;
    this.effectId = effectId;
  }
}

interface AdmittedTimelineEffect {
  readonly id: string;
  readonly enabled: boolean;
  readonly effectType: SupportedAdjustmentEffectType;
  readonly parameters: Readonly<Record<string, number>>;
}

/**
 * Maps JSON-only timeline effects into the frozen Adjustment 1.0 contract.
 * Validation and normalization finish for the complete ordered list before a
 * caller-visible contract array is created.
 */
export function adaptTimelineEffectsToMotionAdjustmentContracts(
  input: AdaptTimelineAdjustmentEffectsInput,
): MotionAdjustmentEffectContract[] {
  assertJsonInput(input);
  if (
    !hasExactKeys(input, ['layerId', 'effects'])
    || !isMotionAdjustmentStableId(input.layerId)
    || !Array.isArray(input.effects)
  ) {
    throw invalidInput('Invalid timeline adjustment effect adapter input');
  }

  const effectIds = new Set<string>();
  const admitted = input.effects.map((effect) => {
    if (
      !hasExactKeys(effect, ['id', 'name', 'type', 'enabled', 'params'])
      || !isMotionAdjustmentStableId(effect.id)
      || typeof effect.name !== 'string'
      || typeof effect.type !== 'string'
      || typeof effect.enabled !== 'boolean'
      || !isPlainRecord(effect.params)
    ) {
      throw invalidInput(
        'Invalid timeline adjustment effect',
        input.layerId,
        isPlainRecord(effect) && typeof effect.id === 'string'
          ? effect.id
          : undefined,
      );
    }
    if (effectIds.has(effect.id)) {
      throw new MotionAdjustmentSupportedEffectAdapterError(
        'DUPLICATE_ADJUSTMENT_EFFECT_ID',
        `Duplicate timeline adjustment effect id: ${effect.id}`,
        input.layerId,
        effect.id,
      );
    }
    effectIds.add(effect.id);
    return admitEffect(
      input.layerId,
      effect as unknown as TimelineAdjustmentEffectInput,
    );
  });

  return admitted.map((effect) => ({
    id: effect.id,
    effectType: effect.effectType,
    enabled: effect.enabled,
    parameters: { ...effect.parameters },
  }));
}

function admitEffect(
  layerId: string,
  effect: TimelineAdjustmentEffectInput,
): AdmittedTimelineEffect {
  const effectType = canonicalEffectType(layerId, effect);
  const parameters = effect.type === 'blur'
    ? normalizeLegacyBlurParameters(effect.params)
    : normalizeAdjustmentEffectParameters(effectType, effect.params);
  return {
    id: effect.id,
    enabled: effect.enabled,
    effectType,
    parameters,
  };
}

function canonicalEffectType(
  layerId: string,
  effect: TimelineAdjustmentEffectInput,
): SupportedAdjustmentEffectType {
  if (Object.hasOwn(MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP, effect.type)) {
    return MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP[
      effect.type as keyof typeof MOTION_ADJUSTMENT_TIMELINE_EFFECT_TYPE_MAP
    ];
  }
  throw new UnsupportedAdjustmentEffectError(
    layerId,
    effect.id,
    effect.type,
  );
}

function normalizeLegacyBlurParameters(
  params: JsonObject,
): Record<string, number> {
  const parameterNames = Object.keys(params);
  if (parameterNames.some((name) =>
    name !== 'radius' && name !== 'amount' && name !== 'samples')) {
    throw new InvalidAdjustmentEffectParametersError(
      'gaussian-blur',
      'unsupported legacy blur parameter',
    );
  }
  if (params.radius !== undefined && params.amount !== undefined) {
    throw new InvalidAdjustmentEffectParametersError(
      'gaussian-blur',
      'legacy blur radius and amount are ambiguous when both are provided',
    );
  }

  return normalizeAdjustmentEffectParameters('gaussian-blur', {
    ...(params.radius === undefined && params.amount === undefined
      ? {}
      : { radius: params.radius ?? params.amount }),
    ...(params.samples === undefined ? {} : { samples: params.samples }),
  });
}

function assertJsonInput(input: unknown): void {
  try {
    assertMotionAdjustmentJsonData(input);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw invalidInput(`Timeline adjustment effects require JSON-only data${detail}`);
  }
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

function invalidInput(
  message: string,
  layerId?: string,
  effectId?: string,
): MotionAdjustmentSupportedEffectAdapterError {
  return new MotionAdjustmentSupportedEffectAdapterError(
    'INVALID_ADJUSTMENT_EFFECT_INPUT',
    message,
    layerId,
    effectId,
  );
}
