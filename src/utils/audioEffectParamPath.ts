import type { AudioEffectParamValue, AudioEffectParams } from '../types/audio';
import { normalizeAudioEqParams } from '../engine/audio/eq/AudioEqLegacy';

function isRecord(value: unknown): value is Record<string, AudioEffectParamValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneContainer(value: AudioEffectParamValue | undefined, nextKey: string): AudioEffectParamValue[] | Record<string, AudioEffectParamValue> {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (isRecord(value)) {
    return { ...value };
  }

  return nextKey.length > 0 && Number.isInteger(Number(nextKey)) ? [] : {};
}

function setArrayPathValue(
  array: AudioEffectParamValue[],
  path: readonly string[],
  value: AudioEffectParamValue,
): AudioEffectParamValue[] {
  const [segment, ...rest] = path;
  if (!segment) {
    return array;
  }

  const numericIndex = Number(segment);
  const index = Number.isInteger(numericIndex)
    ? numericIndex
    : array.findIndex(item => isRecord(item) && item.id === segment);

  if (index < 0) {
    return array;
  }

  const next = [...array];
  next[index] = setAudioEffectParamPathValue(next[index], rest, value);
  return next;
}

export function setAudioEffectParamPathValue(
  current: AudioEffectParamValue | undefined,
  path: readonly string[],
  value: AudioEffectParamValue,
): AudioEffectParamValue {
  if (path.length === 0) {
    return value;
  }

  if (Array.isArray(current)) {
    return setArrayPathValue(current, path, value);
  }

  const [segment, ...rest] = path;
  const container = cloneContainer(current, rest[0] ?? '');
  if (Array.isArray(container)) {
    return setArrayPathValue(container, path, value);
  }

  container[segment] = setAudioEffectParamPathValue(container[segment], rest, value);
  return container;
}

export function getAudioEffectParamPathValue(
  current: AudioEffectParamValue | undefined,
  path: readonly string[],
): AudioEffectParamValue | undefined {
  if (path.length === 0) {
    return current;
  }

  const [segment, ...rest] = path;
  if (Array.isArray(current)) {
    const numericIndex = Number(segment);
    const index = Number.isInteger(numericIndex)
      ? numericIndex
      : current.findIndex(item => isRecord(item) && item.id === segment);
    return index >= 0 ? getAudioEffectParamPathValue(current[index], rest) : undefined;
  }

  if (!isRecord(current)) {
    return undefined;
  }

  return getAudioEffectParamPathValue(current[segment], rest);
}

export function mergeAudioEffectParamPatch(
  current: AudioEffectParams,
  patch: Partial<AudioEffectParams>,
  descriptorId?: string,
): AudioEffectParams {
  let next: AudioEffectParams = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (!key.includes('.')) {
      next[key] = value;
      continue;
    }

    const path = key.split('.').filter(Boolean);
    if (path.length === 0) {
      continue;
    }

    if (descriptorId === 'audio-eq' && path[0] === 'eq' && !isRecord(next.eq)) {
      next = {
        ...next,
        eq: normalizeAudioEqParams(next) as unknown as AudioEffectParamValue,
      };
    }

    next = setAudioEffectParamPathValue(next, path, value) as AudioEffectParams;
  }

  return next;
}
