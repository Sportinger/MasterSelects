import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  type AudioEffectParamValue,
} from '../AudioEffectRegistry';
import { normalizeAudioEqParams } from '../eq/AudioEqLegacy';
import type {
  AudioEffectInstanceWithBypass,
  AudioGraphDiagnostic,
  AudioGraphEffectDescriptor,
  AudioGraphEffectPlanStep,
  AudioGraphEffectStatus,
  AudioGraphJsonPrimitive,
  AudioGraphJsonValue,
  AudioGraphScope,
  AudioGraphSkippedEffect,
} from '../AudioGraphTypes';
import type { AudioEffectInstance } from '../../../types/audio';
import type { Effect } from '../../../types/effects';
import {
  PAYLOAD_FIELD_NAMES,
  compactObject,
  isJsonPrimitive,
  isRecord,
  normalizeGraphJsonValue,
  stringValue,
} from './graphValueNormalization';

function normalizeEffectParamValue(value: AudioEffectParamValue): AudioGraphJsonPrimitive {
  return isJsonPrimitive(value) ? value : null;
}

function normalizeLooseParams(
  params: unknown,
  effectId: string,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): Record<string, AudioGraphJsonValue> {
  if (!isRecord(params)) {
    return {};
  }

  const normalized: Record<string, AudioGraphJsonValue> = {};
  for (const key of Object.keys(params).toSorted()) {
    if (PAYLOAD_FIELD_NAMES.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-payload-param-dropped',
        message: `Dropped payload-shaped audio effect param from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    const value = params[key];
    const normalizedValue = normalizeGraphJsonValue(value);
    if (normalizedValue === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-dropped',
        message: `Dropped non-JSON audio effect param "${key}" from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    normalized[key] = normalizedValue;
  }

  return normalized;
}

function normalizeRegisteredParams(
  params: unknown,
  descriptorId: string,
  effectId: string,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): Record<string, AudioGraphJsonValue> {
  if (descriptorId === 'audio-eq') {
    return {
      eq: normalizeAudioEqParams(params) as unknown as AudioGraphJsonValue,
    };
  }

  const descriptor = getAudioEffect(descriptorId);
  const defaults = getAudioEffectDefaultParams(descriptorId);
  const paramNames = descriptor?.paramNames ?? [];
  const allowedParams = new Set(paramNames);
  const normalized: Record<string, AudioGraphJsonValue> = {};

  for (const paramName of paramNames) {
    normalized[paramName] = normalizeEffectParamValue(defaults[paramName]);
  }

  if (!isRecord(params)) {
    return normalized;
  }

  for (const key of Object.keys(params).toSorted()) {
    if (PAYLOAD_FIELD_NAMES.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-payload-param-dropped',
        message: `Dropped payload-shaped audio effect param from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    if (!allowedParams.has(key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-unknown',
        message: `Dropped unknown param "${key}" for audio effect descriptor "${descriptorId}".`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    const value = params[key];
    const normalizedValue = normalizeGraphJsonValue(value);
    if (normalizedValue === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-param-dropped',
        message: `Dropped non-JSON audio effect param "${key}" from ${effectId}.`,
        scope,
        refId: ownerId,
      });
      continue;
    }

    normalized[key] = normalizedValue;
  }

  return normalized;
}

function effectStatus(
  effect: AudioEffectInstanceWithBypass,
  descriptorExists: boolean
): AudioGraphEffectStatus {
  if (!descriptorExists) {
    return 'invalid';
  }

  if (effect.enabled === false || effect.disabled === true) {
    return 'disabled';
  }

  if (effect.bypassed === true) {
    return 'bypassed';
  }

  return 'active';
}

export function normalizeEffectStack(
  effects: readonly AudioEffectInstance[] | undefined,
  scope: AudioGraphScope,
  ownerId: string,
  diagnostics: AudioGraphDiagnostic[]
): AudioGraphEffectDescriptor[] {
  if (!effects || effects.length === 0) {
    return [];
  }

  const seenEffectIds = new Set<string>();

  return effects.map((effect, order) => {
    const input = effect as AudioEffectInstanceWithBypass;
    const id = stringValue(input.id, `${scope}-${ownerId}-effect-${order}`);
    const descriptorId = stringValue(input.descriptorId, 'unknown');
    const descriptor = getAudioEffect(descriptorId);

    if (seenEffectIds.has(id)) {
      diagnostics.push({
        severity: 'warning',
        code: 'audio-graph-effect-id-duplicate',
        message: `Duplicate audio effect id "${id}" in ${scope} "${ownerId}".`,
        scope,
        refId: ownerId,
      });
    }
    seenEffectIds.add(id);

    if (!descriptor) {
      diagnostics.push({
        severity: 'error',
        code: 'audio-graph-effect-descriptor-unknown',
        message: `Unknown audio effect descriptor "${descriptorId}" for effect "${id}".`,
        scope,
        refId: ownerId,
      });
    }

    const status = effectStatus(input, Boolean(descriptor));
    const params = descriptor
      ? normalizeRegisteredParams(input.params, descriptorId, id, scope, ownerId, diagnostics)
      : normalizeLooseParams(input.params, id, scope, ownerId, diagnostics);

    return compactObject<AudioGraphEffectDescriptor>({
      id,
      descriptorId,
      order,
      enabled: input.enabled !== false && input.disabled !== true,
      bypassed: input.bypassed === true,
      status,
      params,
      automationMode: input.automationMode,
    });
  });
}

export function normalizeLegacyClipAudioEffects(
  effects: readonly Effect[] | undefined,
  existingEffectIds: ReadonlySet<string>
): AudioEffectInstance[] {
  if (!effects || effects.length === 0) {
    return [];
  }

  return effects.flatMap((effect) => {
    const descriptor = getAudioEffect(effect.type);
    if (!descriptor || existingEffectIds.has(effect.id)) {
      return [];
    }

    return [{
      id: effect.id,
      descriptorId: descriptor.id,
      enabled: effect.enabled !== false,
      params: effect.params ?? {},
      automationMode: 'clip',
    } satisfies AudioEffectInstance];
  });
}

export function createEffectPlanSteps(
  effects: AudioGraphEffectDescriptor[],
  scope: AudioGraphScope,
  ownerId: string
): { active: AudioGraphEffectPlanStep[]; skipped: AudioGraphSkippedEffect[] } {
  const active: AudioGraphEffectPlanStep[] = [];
  const skipped: AudioGraphSkippedEffect[] = [];

  for (const effect of effects) {
    if (effect.status !== 'active') {
      skipped.push({
        effectId: effect.id,
        descriptorId: effect.descriptorId,
        order: effect.order,
        status: effect.status,
      });
      continue;
    }

    active.push(compactObject<AudioGraphEffectPlanStep>({
      nodeId: `${scope}:${ownerId}:effect:${effect.id}`,
      scope,
      ownerId,
      effectId: effect.id,
      descriptorId: effect.descriptorId,
      order: effect.order,
      params: effect.params,
      automationMode: effect.automationMode,
    }));
  }

  return { active, skipped };
}
