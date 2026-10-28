import type { Effect } from '../../../types/effects';
import type { JsonObject } from './contracts';
import { classifyAdjustmentEffect } from './adjustmentEffectClassification';
import { sanitizeAdjustmentEffectParameters } from './adjustmentEffectRegistryAdmission';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from './supportedEffectContractAdapter';
import { isWorkerGpuAdjustmentEffectType } from './supportedEffects';

/** One effect the render admission leaves out of an adjustment layer, and why. */
export interface BypassedAdjustmentEffect {
  readonly effectId: string;
  readonly effectType: string;
  readonly reason: string;
}

/** A value the admission changed (a value of the wrong type replaced by its default). */
export interface AdjustedAdjustmentEffectParameter {
  readonly effectId: string;
  readonly effectType: string;
  readonly parameter: string;
  readonly message: string;
}

export interface AdjustmentEffectRenderAdmission {
  /** Effects the compositor renders, in stack order (disabled ones stay as they are). */
  readonly effects: Effect[];
  readonly bypassed: readonly BypassedAdjustmentEffect[];
  readonly adjusted: readonly AdjustedAdjustmentEffectParameter[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Per-effect render admission of an adjustment layer, shared by preview, nested compositions,
 * target previews, export and the inspector. One effect that cannot run (unavailable on adjustment
 * layers, malformed data) is bypassed on its own and reported; the rest of the stack still renders.
 */
export function admitAdjustmentEffectsForRender(
  layerId: string,
  effects: readonly Effect[],
): AdjustmentEffectRenderAdmission {
  const admitted: Effect[] = [];
  const bypassed: BypassedAdjustmentEffect[] = [];
  const adjusted: AdjustedAdjustmentEffectParameter[] = [];
  const seenIds = new Set<string>();
  for (const effect of effects) {
    if (seenIds.has(effect.id)) {
      bypassed.push({ effectId: effect.id, effectType: effect.type, reason: `Duplicate effect id ${effect.id} on this adjustment layer; the later copy is skipped.` });
      continue;
    }
    seenIds.add(effect.id);
    // Disabled and detached effects never render, so they need no admission.
    if (effect.enabled === false) {
      admitted.push(effect);
      continue;
    }
    const classification = classifyAdjustmentEffect(effect.type);
    // The retired `blur` type is no registry effect; the contract adapter maps it to Gaussian Blur.
    if (!classification.admitted && effect.type !== 'blur') {
      bypassed.push({ effectId: effect.id, effectType: effect.type, reason: classification.reason ?? `${effect.type} cannot run on an adjustment layer.` });
      continue;
    }
    try {
      admitted.push(admitEnabledEffect(layerId, effect, adjusted));
    } catch (error) {
      bypassed.push({ effectId: effect.id, effectType: effect.type, reason: errorMessage(error) });
    }
  }
  return { effects: admitted, bypassed, adjusted };
}

function contractEffect(layerId: string, effect: Effect, params: JsonObject): Effect {
  const [contract] = adaptTimelineEffectsToMotionAdjustmentContracts({
    layerId,
    effects: [{ id: effect.id, name: effect.name, type: effect.type, enabled: true, params }],
  });
  return { ...effect, type: contract!.effectType as Effect['type'], params: { ...contract!.parameters } as Effect['params'] };
}

/**
 * One enabled, admitted effect. The retired `blur` only loads through the contract adapter (its
 * mapping to Gaussian Blur). The worker-executable five keep their frozen normalization (saved
 * projects render exactly as before) while their values fit it; a value outside it (keyframe
 * overshoot, a node driver) renders as set, as it would on a clip, instead of dropping the effect.
 * Every other effect is checked by its own definitions and keeps its values.
 */
function admitEnabledEffect(layerId: string, effect: Effect, adjusted: AdjustedAdjustmentEffectParameter[]): Effect {
  if (effect.type === 'blur') return contractEffect(layerId, effect, effect.params as JsonObject);
  if (isWorkerGpuAdjustmentEffectType(effect.type)) {
    try {
      return contractEffect(layerId, effect, effect.params as JsonObject);
    } catch {
      // Falls through to the registry check below: the main compositor renders any finite value.
    }
  }
  const sanitized = sanitizeAdjustmentEffectParameters(effect.type, effect.params);
  for (const issue of sanitized.issues) {
    adjusted.push({ effectId: effect.id, effectType: effect.type, parameter: issue.parameter, message: issue.message });
  }
  const effectWithParams = { ...effect, params: { ...sanitized.parameters } as Effect['params'] };
  if (isWorkerGpuAdjustmentEffectType(effect.type)) return effectWithParams;
  // The contract adapter is the shared JSON-shape gate (budgets, ids) for registry effects.
  return contractEffect(layerId, effectWithParams, sanitized.parameters);
}
