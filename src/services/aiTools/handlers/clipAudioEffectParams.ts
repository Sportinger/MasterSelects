// Parameter checks for the Volume tab's own audio effects (audio-volume, audio-eq) when a tool sets
// them. These effects live in the audio effect registry, not the visual one, so the visual checks in
// effects.ts (normalizeNumberParams, unknown-name rejection) do not see them. Without this check a
// misspelled name or a wrong type was stored silently and did nothing, or broke the audio graph.

import { getAudioEffect, getAudioEffectDefaultParams } from '../../../engine/audio/AudioEffectRegistry';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import { finiteEffectNumber, isUnusableEffectNumber } from '../../../effects/_shared/effectNumberParam';
import type { AudioEffectParamValue, AudioEffectParams } from '../../../types/audio';
import { getAudioEffectParamPathValue } from '../../../utils/audioEffectParamPath';

export interface ClipAudioParamCheck {
  /** Values to store: numeric text for a number parameter becomes a number. */
  params: AudioEffectParams;
  /** Names that are neither a parameter of the effect nor a path into its stored values. */
  unknown: string[];
  /** Known names whose value has the wrong type or is not one of the parameter's options. */
  invalid: string[];
  /** Top-level names the effect accepts (for the error message). */
  valid: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describe = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

/** The stored values a dotted path is read from: an old flat EQ gets its structured form first (as the store does). */
function pathBase(effectType: string, current: AudioEffectParams, path: readonly string[]): AudioEffectParams {
  if (effectType === 'audio-eq' && path[0] === 'eq' && !isRecord(current.eq)) {
    return { ...current, eq: normalizeAudioEqParams(current) as unknown as AudioEffectParamValue };
  }
  return current;
}

/**
 * Checks tool-given parameters against the audio effect's registry entry and the instance's stored
 * values. A name is a top-level parameter or a dotted path into an existing value
 * (e.g. `eq.audible.bands.<bandId>.gainDb`); the new value must have the type of the value it replaces.
 */
export function checkClipAudioEffectParams(
  effectType: string,
  current: AudioEffectParams | undefined,
  raw: Record<string, unknown>,
): ClipAudioParamCheck {
  const descriptor = getAudioEffect(effectType);
  const base: AudioEffectParams = current ?? getAudioEffectDefaultParams(effectType);
  const topLevel = new Set([...(descriptor?.paramNames ?? []), ...Object.keys(base), ...(effectType === 'audio-eq' ? ['eq'] : [])]);
  const params: AudioEffectParams = {};
  const unknown: string[] = [];
  const invalid: string[] = [];

  for (const [name, value] of Object.entries(raw)) {
    const path = name.split('.').filter(Boolean);
    const previous = path.length && topLevel.has(path[0]) ? getAudioEffectParamPathValue(pathBase(effectType, base, path), path) : undefined;
    if (previous === undefined) { unknown.push(name); continue; }
    if (typeof previous === 'number') {
      if (isUnusableEffectNumber(value) || typeof value === 'boolean' || value === null) { invalid.push(`${name}: ${describe(value)} is not a finite number`); continue; }
      params[name] = finiteEffectNumber(value, previous);
      continue;
    }
    const options = path.length === 1 ? descriptor?.params[name]?.options : undefined;
    if (typeof previous === 'string' && options && !options.includes(String(value))) {
      invalid.push(`${name}: ${describe(value)} is not one of ${options.join(', ')}`);
      continue;
    }
    const sameKind = previous === null || value === null
      ? true
      : Array.isArray(previous) ? Array.isArray(value)
        : isRecord(previous) ? isRecord(value)
          : typeof value === typeof previous;
    if (!sameKind) {
      const given = Array.isArray(value) ? 'a list' : isRecord(value) ? 'an object' : describe(value);
      invalid.push(`${name}: ${given} is not a ${Array.isArray(previous) ? 'list' : isRecord(previous) ? 'group of values' : typeof previous}`);
      continue;
    }
    params[name] = value as AudioEffectParamValue;
  }

  return { params, unknown, invalid, valid: [...topLevel].toSorted() };
}
