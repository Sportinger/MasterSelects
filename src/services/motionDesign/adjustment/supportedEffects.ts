import type { MotionAdjustmentEffectContract } from './contracts';
import { assertMotionAdjustmentJsonData } from './contractLimits';

export const SUPPORTED_ADJUSTMENT_EFFECT_TYPES = Object.freeze([
  'brightness',
  'contrast',
  'saturation',
  'invert',
  'gaussian-blur',
] as const);

export type SupportedAdjustmentEffectType =
  (typeof SUPPORTED_ADJUSTMENT_EFFECT_TYPES)[number];

export type MotionAdjustmentRenderSurface =
  | 'preview'
  | 'nested-preview'
  | 'target-preview'
  | 'export';

export interface MotionAdjustmentSurfaceCompatibility {
  readonly required: true;
  readonly supported: true;
  /** This is the Wave-2 target contract, not proof of current integration. */
  readonly integrationStatus: 'pending-wave-2-executor-parity';
}

export interface MotionAdjustmentNumberParameterPolicy {
  readonly type: 'number';
  readonly optional: true;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly integer: boolean;
}

export interface MotionAdjustmentEffectCompatibilityEntry {
  readonly effectType: SupportedAdjustmentEffectType;
  readonly surfaces: Readonly<
    Record<MotionAdjustmentRenderSurface, MotionAdjustmentSurfaceCompatibility>
  >;
  readonly parameters: Readonly<Record<string, MotionAdjustmentNumberParameterPolicy>>;
}

const REQUIRED_SURFACE_COMPATIBILITY = Object.freeze({
  required: true,
  supported: true,
  integrationStatus: 'pending-wave-2-executor-parity',
} as const);

const REQUIRED_ALL_SURFACES = Object.freeze({
  preview: REQUIRED_SURFACE_COMPATIBILITY,
  'nested-preview': REQUIRED_SURFACE_COMPATIBILITY,
  'target-preview': REQUIRED_SURFACE_COMPATIBILITY,
  export: REQUIRED_SURFACE_COMPATIBILITY,
});

function numberPolicy(
  defaultValue: number,
  minimum: number,
  maximum: number,
  integer: boolean,
): MotionAdjustmentNumberParameterPolicy {
  return Object.freeze({
    type: 'number',
    optional: true,
    defaultValue,
    minimum,
    maximum,
    integer,
  });
}

export const ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX = Object.freeze({
  brightness: Object.freeze({
    effectType: 'brightness',
    surfaces: REQUIRED_ALL_SURFACES,
    parameters: Object.freeze({ amount: numberPolicy(0, -1, 1, false) }),
  }),
  contrast: Object.freeze({
    effectType: 'contrast',
    surfaces: REQUIRED_ALL_SURFACES,
    parameters: Object.freeze({ amount: numberPolicy(1, 0, 3, false) }),
  }),
  saturation: Object.freeze({
    effectType: 'saturation',
    surfaces: REQUIRED_ALL_SURFACES,
    parameters: Object.freeze({ amount: numberPolicy(1, 0, 3, false) }),
  }),
  invert: Object.freeze({
    effectType: 'invert',
    surfaces: REQUIRED_ALL_SURFACES,
    parameters: Object.freeze({}),
  }),
  'gaussian-blur': Object.freeze({
    effectType: 'gaussian-blur',
    surfaces: REQUIRED_ALL_SURFACES,
    parameters: Object.freeze({
      radius: numberPolicy(10, 0, 50, false),
      samples: numberPolicy(5, 1, 64, true),
    }),
  }),
}) satisfies Readonly<
  Record<SupportedAdjustmentEffectType, MotionAdjustmentEffectCompatibilityEntry>
>;

const SUPPORTED_EFFECT_TYPE_SET = new Set<string>(
  SUPPORTED_ADJUSTMENT_EFFECT_TYPES,
);

export class UnsupportedAdjustmentEffectError extends Error {
  readonly code = 'UNSUPPORTED_ADJUSTMENT_EFFECT';
  readonly layerId: string;
  readonly effectId: string;
  readonly effectType: string;

  constructor(
    layerId: string,
    effectId: string,
    effectType: string,
  ) {
    super(
      `Adjustment layer ${layerId} uses unsupported effect ${effectType} (${effectId})`,
    );
    this.name = 'UnsupportedAdjustmentEffectError';
    this.layerId = layerId;
    this.effectId = effectId;
    this.effectType = effectType;
  }
}

export class InvalidAdjustmentEffectParametersError extends Error {
  readonly code = 'INVALID_ADJUSTMENT_EFFECT_PARAMETERS';
  readonly effectType: SupportedAdjustmentEffectType;

  constructor(effectType: SupportedAdjustmentEffectType, message: string) {
    super(`Invalid ${effectType} adjustment parameters: ${message}`);
    this.name = 'InvalidAdjustmentEffectParametersError';
    this.effectType = effectType;
  }
}

export function isSupportedAdjustmentEffectType(
  effectType: string,
): effectType is SupportedAdjustmentEffectType {
  return SUPPORTED_EFFECT_TYPE_SET.has(effectType);
}

export function assertSupportedAdjustmentEffect(
  layerId: string,
  effect: MotionAdjustmentEffectContract,
): asserts effect is MotionAdjustmentEffectContract & {
  effectType: SupportedAdjustmentEffectType;
} {
  if (!isSupportedAdjustmentEffectType(effect.effectType)) {
    throw new UnsupportedAdjustmentEffectError(
      layerId,
      effect.id,
      effect.effectType,
    );
  }
  assertAdjustmentEffectParameters(effect.effectType, effect.parameters);
}

export function assertAdjustmentEffectParameters(
  effectType: SupportedAdjustmentEffectType,
  parameters: unknown,
): asserts parameters is Record<string, number> {
  assertMotionAdjustmentJsonData(parameters);
  if (!isPlainRecord(parameters)) {
    throw new InvalidAdjustmentEffectParametersError(
      effectType,
      'parameters must be a plain object',
    );
  }
  const policy: Readonly<Record<string, MotionAdjustmentNumberParameterPolicy>> =
    ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX[effectType].parameters;
  const parameterNames = Object.keys(parameters);
  const supportedNames = Object.keys(policy);
  if (parameterNames.some((name) => !supportedNames.includes(name))) {
    throw new InvalidAdjustmentEffectParametersError(
      effectType,
      'unsupported parameter',
    );
  }
  for (const name of parameterNames) {
    const rule = policy[name];
    const value = parameters[name];
    if (
      !rule
      || typeof value !== 'number'
      || !Number.isFinite(value)
      || value < rule.minimum
      || value > rule.maximum
      || (rule.integer && !Number.isInteger(value))
    ) {
      throw new InvalidAdjustmentEffectParametersError(
        effectType,
        `${name} is outside its policy`,
      );
    }
  }
}

export function normalizeAdjustmentEffectParameters(
  effectType: SupportedAdjustmentEffectType,
  parameters: unknown,
): Record<string, number> {
  assertAdjustmentEffectParameters(effectType, parameters);
  const policy: Readonly<Record<string, MotionAdjustmentNumberParameterPolicy>> =
    ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX[effectType].parameters;
  return Object.fromEntries(
    Object.entries(policy).map(([name, rule]) => [
      name,
      parameters[name] ?? rule.defaultValue,
    ]),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
