import type { JsonObject, MotionAdjustmentEffectContract } from './contracts';
import { assertMotionAdjustmentJsonData } from './contractLimits';

/**
 * The effects the worker GPU executor (effectAdapter.ts, renderGraphExecutor.ts) can draw on an
 * adjustment layer: the original Adjustment 1.0 set. The main compositor draws every registry
 * effect an adjustment layer admits (adjustmentEffectClassification.ts); this list only says
 * which of them the opt-in worker render modes can take without falling back.
 */
export const WORKER_GPU_ADJUSTMENT_EFFECT_TYPES = Object.freeze([
  'brightness',
  'contrast',
  'saturation',
  'invert',
  'gaussian-blur',
] as const);

export type WorkerGpuAdjustmentEffectType =
  (typeof WORKER_GPU_ADJUSTMENT_EFFECT_TYPES)[number];

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
  readonly effectType: WorkerGpuAdjustmentEffectType;
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

/**
 * Frozen parameter policy of the worker-executable effects. Saved projects with these effects keep
 * validating and normalizing exactly as before the registry-wide admission.
 */
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
      // Accepted for saved projects; no renderer reads it (the effect's `deprecated` note tells tool callers).
      samples: numberPolicy(5, 1, 64, true),
    }),
  }),
}) satisfies Readonly<
  Record<WorkerGpuAdjustmentEffectType, MotionAdjustmentEffectCompatibilityEntry>
>;

const WORKER_GPU_EFFECT_TYPE_SET = new Set<string>(
  WORKER_GPU_ADJUSTMENT_EFFECT_TYPES,
);

/** Why one effect cannot run on an adjustment layer, from the registry classification. */
export interface AdjustmentEffectAdmissionVerdict {
  readonly admitted: boolean;
  readonly reason?: string;
}

/**
 * Registry-backed admission installed by the main thread (adjustmentEffectRegistryAdmission.ts).
 * This module stays free of the effect registry so worker bundles that validate execution plans
 * do not load every effect shader; without a policy only the worker-executable effects pass.
 */
export interface AdjustmentEffectAdmissionPolicy {
  classify(effectType: string): AdjustmentEffectAdmissionVerdict;
  /** Throws InvalidAdjustmentEffectParametersError; returns the validated, normalized copy. */
  normalizeParameters(effectType: string, parameters: JsonObject): JsonObject;
}

let admissionPolicy: AdjustmentEffectAdmissionPolicy | null = null;

export function installAdjustmentEffectAdmissionPolicy(
  policy: AdjustmentEffectAdmissionPolicy,
): void {
  admissionPolicy = policy;
}

export class UnsupportedAdjustmentEffectError extends Error {
  readonly code = 'UNSUPPORTED_ADJUSTMENT_EFFECT';
  readonly layerId: string;
  readonly effectId: string;
  readonly effectType: string;
  readonly reason: string | undefined;

  constructor(
    layerId: string,
    effectId: string,
    effectType: string,
    reason?: string,
  ) {
    super(
      `Adjustment layer ${layerId} uses unsupported effect ${effectType} (${effectId})${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'UnsupportedAdjustmentEffectError';
    this.layerId = layerId;
    this.effectId = effectId;
    this.effectType = effectType;
    this.reason = reason;
  }
}

export class InvalidAdjustmentEffectParametersError extends Error {
  readonly code = 'INVALID_ADJUSTMENT_EFFECT_PARAMETERS';
  readonly effectType: string;

  constructor(effectType: string, message: string) {
    super(`Invalid ${effectType} adjustment parameters: ${message}`);
    this.name = 'InvalidAdjustmentEffectParametersError';
    this.effectType = effectType;
  }
}

export function isWorkerGpuAdjustmentEffectType(
  effectType: string,
): effectType is WorkerGpuAdjustmentEffectType {
  return WORKER_GPU_EFFECT_TYPE_SET.has(effectType);
}

/** Admission verdict of one effect type: the registry policy, else the worker-executable set. */
export function adjustmentEffectAdmission(effectType: string): AdjustmentEffectAdmissionVerdict {
  if (isWorkerGpuAdjustmentEffectType(effectType)) return { admitted: true };
  if (admissionPolicy) return admissionPolicy.classify(effectType);
  return {
    admitted: false,
    reason: `only ${WORKER_GPU_ADJUSTMENT_EFFECT_TYPES.join(', ')} are available without the effect registry`,
  };
}

export function isSupportedAdjustmentEffectType(effectType: string): boolean {
  return adjustmentEffectAdmission(effectType).admitted;
}

export function assertSupportedAdjustmentEffect(
  layerId: string,
  effect: MotionAdjustmentEffectContract,
): void {
  const verdict = adjustmentEffectAdmission(effect.effectType);
  if (!verdict.admitted) {
    throw new UnsupportedAdjustmentEffectError(
      layerId,
      effect.id,
      effect.effectType,
      verdict.reason,
    );
  }
  assertAdjustmentEffectParameters(effect.effectType, effect.parameters);
}

export function assertAdjustmentEffectParameters(
  effectType: string,
  parameters: unknown,
): asserts parameters is JsonObject {
  normalizeAdjustmentEffectParameters(effectType, parameters);
}

/**
 * Validates and normalizes one admitted effect's parameters: the frozen policy for the
 * worker-executable effects, otherwise the effect's own registry definitions.
 */
export function normalizeAdjustmentEffectParameters(
  effectType: string,
  parameters: unknown,
): JsonObject {
  if (isWorkerGpuAdjustmentEffectType(effectType)) {
    return normalizeWorkerGpuAdjustmentEffectParameters(effectType, parameters);
  }
  assertMotionAdjustmentJsonData(parameters);
  if (!isPlainRecord(parameters)) {
    throw new InvalidAdjustmentEffectParametersError(
      effectType,
      'parameters must be a plain object',
    );
  }
  if (!admissionPolicy) {
    throw new InvalidAdjustmentEffectParametersError(
      effectType,
      'no parameter definitions are available for this effect here',
    );
  }
  return admissionPolicy.normalizeParameters(effectType, parameters as JsonObject);
}

export function assertWorkerGpuAdjustmentEffectParameters(
  effectType: WorkerGpuAdjustmentEffectType,
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

export function normalizeWorkerGpuAdjustmentEffectParameters(
  effectType: WorkerGpuAdjustmentEffectType,
  parameters: unknown,
): Record<string, number> {
  assertWorkerGpuAdjustmentEffectParameters(effectType, parameters);
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
