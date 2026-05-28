import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';
import type {
  AudioEffectInstance,
  AudioEffectParams,
  AudioEffectParamValue,
  ClipAudioEditOperation,
} from '../../types';

const REGION_EFFECT_METADATA_KEYS = new Set([
  'label',
  'timelineStart',
  'timelineEnd',
  'preserveClipDuration',
  'effectDescriptorId',
  'descriptorId',
  'effectLabel',
  'featherTime',
]);

function isAudioEffectParamValue(value: unknown): value is AudioEffectParamValue {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
}

export function getAudioRegionEffectDescriptorId(
  operation: Pick<ClipAudioEditOperation, 'type' | 'params'>,
): string | null {
  if (operation.type !== 'effect') return null;
  const descriptorId = operation.params.effectDescriptorId ?? operation.params.descriptorId;
  return typeof descriptorId === 'string' && hasAudioEffect(descriptorId) ? descriptorId : null;
}

export function getAudioRegionEffectParams(
  operation: Pick<ClipAudioEditOperation, 'type' | 'params'>,
): AudioEffectParams {
  const descriptorId = getAudioRegionEffectDescriptorId(operation);
  if (!descriptorId) return {};

  const descriptor = getAudioEffect(descriptorId);
  const defaults = getAudioEffectDefaultParams(descriptorId);
  const params: AudioEffectParams = {};

  for (const paramName of descriptor?.paramNames ?? []) {
    const value = operation.params[paramName];
    if (isAudioEffectParamValue(value)) {
      params[paramName] = value;
    } else if (defaults[paramName] !== undefined) {
      params[paramName] = defaults[paramName];
    }
  }

  for (const [key, value] of Object.entries(operation.params)) {
    if (REGION_EFFECT_METADATA_KEYS.has(key) || params[key] !== undefined) continue;
    if (isAudioEffectParamValue(value)) {
      params[key] = value;
    }
  }

  return params;
}

export function createAudioRegionEffectInstance(
  operation: ClipAudioEditOperation,
): AudioEffectInstance | null {
  const descriptorId = getAudioRegionEffectDescriptorId(operation);
  if (!descriptorId) return null;

  return {
    id: operation.id,
    descriptorId,
    enabled: operation.enabled !== false,
    params: getAudioRegionEffectParams(operation),
    automationMode: 'clip',
  };
}

export function getAudioRegionEffectLabel(
  operation: Pick<ClipAudioEditOperation, 'type' | 'params'>,
): string {
  const label = operation.params.label;
  if (typeof label === 'string' && label.trim().length > 0) return label.trim();

  const effectLabel = operation.params.effectLabel;
  if (typeof effectLabel === 'string' && effectLabel.trim().length > 0) {
    return effectLabel.trim();
  }

  const descriptorId = getAudioRegionEffectDescriptorId(operation);
  return descriptorId ? getAudioEffect(descriptorId)?.name ?? descriptorId : 'Region FX';
}
