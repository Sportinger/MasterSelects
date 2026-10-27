// The audio effects the phone offers: the editor's own audio effect registry (the same list the
// desktop "Audio FX Stack" picker shows, without the level control the Volume sheet owns and the
// node-only Audio Math), grouped by the registry's categories. Each effect names one main
// parameter for the phone slider; the rest is reached through "All parameters" (Properties).
// Effects whose editor defaults are neutral (a compressor at ratio 1, a reverb at mix 0) get a
// phone starting point when added, so a tap is audible; every value stays a normal desktop value.

import {
  AUDIO_EFFECT_CATEGORY_LABELS,
  getAllAudioEffects,
  getAudioEffect,
  type AudioEffectCategory,
  type AudioEffectDescriptor,
} from '../../../engine/audio/AudioEffectRegistry';
import { getParamControlMeta } from '../../panels/properties/audioEffectParamMeta';
import type { AudioEffectParamValue } from '../../../types/audio';

/** Not offered here: the level (Volume sheet) and the graph-only Audio Math. */
const PHONE_AUDIO_FX_EXCLUDED = new Set(['audio-volume', 'audio-math']);

/** Main parameter per effect; effects without one are on/off here (stereo tools, the 10-band EQ). */
const MAIN_PARAM: Readonly<Record<string, string>> = {
  'audio-pan': 'pan',
  'audio-normalize': 'targetPeakDb',
  'audio-parametric-eq': 'gainDb',
  'audio-high-pass': 'frequencyHz',
  'audio-low-pass': 'frequencyHz',
  'audio-hum-notch': 'frequencyHz',
  'audio-de-click': 'threshold',
  'audio-noise-reduction': 'reductionDb',
  'audio-spectral-gate': 'reductionDb',
  'audio-compressor': 'thresholdDb',
  'audio-de-esser': 'thresholdDb',
  'audio-limiter': 'ceilingDb',
  'audio-noise-gate': 'thresholdDb',
  'audio-expander': 'thresholdDb',
  'audio-delay': 'mix',
  'audio-reverb': 'mix',
  'audio-saturation': 'driveDb',
  'audio-stereo-split': 'sourceChannel',
};

/** Phone starting points for effects whose editor defaults do nothing audible. */
const STARTING_POINT: Readonly<Record<string, Readonly<Record<string, AudioEffectParamValue>>>> = {
  'audio-compressor': { thresholdDb: -18, ratio: 3, makeupGainDb: 3 },
  'audio-de-esser': { thresholdDb: -24, ratio: 4 },
  'audio-limiter': { ceilingDb: -1 },
  'audio-noise-gate': { thresholdDb: -50 },
  'audio-expander': { thresholdDb: -40, ratio: 2, rangeDb: 12 },
  'audio-noise-reduction': { reductionDb: 12, mix: 1 },
  'audio-spectral-gate': { reductionDb: 12 },
  'audio-delay': { mix: 0.25, feedback: 0.3 },
  'audio-reverb': { mix: 0.25 },
  'audio-saturation': { driveDb: 6, mix: 1 },
};

export interface PhoneAudioFxGroup {
  id: AudioEffectCategory | 'other';
  label: string;
  effects: AudioEffectDescriptor[];
}

export interface PhoneAudioFxParamUi {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  suffix: string;
  defaultValue: number;
}

export function phoneAudioFxEffects(): AudioEffectDescriptor[] {
  return getAllAudioEffects().filter((effect) => !PHONE_AUDIO_FX_EXCLUDED.has(effect.id));
}

export function isPhoneAudioFxOffered(descriptorId: string): boolean {
  return !PHONE_AUDIO_FX_EXCLUDED.has(descriptorId) && getAudioEffect(descriptorId) !== undefined;
}

/** Registry effects by category, in the desktop browser's category order. */
export function phoneAudioFxGroups(): PhoneAudioFxGroup[] {
  const effects = phoneAudioFxEffects();
  const groups: PhoneAudioFxGroup[] = (Object.keys(AUDIO_EFFECT_CATEGORY_LABELS) as AudioEffectCategory[]).map((id) => ({
    id, label: AUDIO_EFFECT_CATEGORY_LABELS[id], effects: effects.filter((effect) => effect.category === id),
  }));
  const other = effects.filter((effect) => !effect.category || !(effect.category in AUDIO_EFFECT_CATEGORY_LABELS));
  if (other.length > 0) groups.push({ id: 'other', label: 'Other', effects: other });
  return groups.filter((group) => group.effects.length > 0);
}

export function formatPhoneAudioParamLabel(paramName: string): string {
  return paramName
    .replace(/Db\b/g, '')
    .replace(/Hz\b/g, '')
    .replace(/Ms\b/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

/** Slider range of the main parameter, from the same table the desktop stack control uses. */
export function phoneAudioFxMainParam(descriptorId: string): PhoneAudioFxParamUi | null {
  const descriptor = getAudioEffect(descriptorId);
  const name = MAIN_PARAM[descriptorId];
  const param = name ? descriptor?.params[name] : undefined;
  if (!descriptor || !name || !param || typeof param.default !== 'number') return null;
  const meta = getParamControlMeta(name, param.default);
  return {
    name,
    label: formatPhoneAudioParamLabel(name),
    min: meta.min,
    max: meta.max,
    step: meta.decimals === 0 ? 1 : Math.pow(10, -meta.decimals),
    decimals: meta.decimals,
    suffix: meta.suffix.trim(),
    defaultValue: param.default,
  };
}

export function phoneAudioFxStartingPoint(descriptorId: string): Readonly<Record<string, AudioEffectParamValue>> | null {
  return STARTING_POINT[descriptorId] ?? null;
}

/** The numeric value of a parameter as stored (or the registry default). */
export function readPhoneAudioParam(params: Readonly<Record<string, AudioEffectParamValue>>, descriptorId: string, name: string): number {
  const stored = params[name];
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  const fallback = getAudioEffect(descriptorId)?.params[name]?.default;
  return typeof fallback === 'number' ? fallback : 0;
}

export function phoneAudioFxName(descriptorId: string): string {
  return getAudioEffect(descriptorId)?.name ?? descriptorId;
}
