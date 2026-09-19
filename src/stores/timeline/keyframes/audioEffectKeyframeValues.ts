import type { Effect, TimelineClip } from '../../../types';
import type { AnimatableProperty } from '../types';
import { hasAudioEffect } from '../../../engine/audio/AudioEffectRegistry';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
} from '../../../engine/audio/eq/AudioEqDefaults';
import {
  getAudioEffectParamPathValue,
  mergeAudioEffectParamPatch,
} from '../../../utils/audioEffectParamPath';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';

export interface AudioKeyframeInvalidationTarget {
  clipId: string;
  property: AnimatableProperty;
}

export function parseEffectKeyframeProperty(property: AnimatableProperty): { effectId: string; paramName: string; paramPath: string[] } | null {
  const parts = property.split('.');
  if (parts.length < 3 || parts[0] !== 'effect') return null;
  return { effectId: parts[1], paramName: parts.slice(2).join('.'), paramPath: parts.slice(2) };
}

export function mergeLegacyEffectParamPatch(
  effect: Effect,
  params: Partial<Effect['params']>,
): Effect['params'] {
  if (hasAudioEffect(effect.type)) {
    return mergeAudioEffectParamPatch(effect.params, params, effect.type) as Effect['params'];
  }

  return { ...effect.params, ...params } as Effect['params'];
}

function getDefaultAudioEqNumericPathValue(path: readonly string[]): number | undefined {
  const [audible, bands, bandId, scope, paramName] = path;
  if (audible !== 'audible' || bands !== 'bands' || !bandId || !scope || !paramName) {
    return undefined;
  }

  if (scope === 'dynamic') {
    const value = AUDIO_EQ_DEFAULT_BAND_DYNAMICS[paramName as keyof typeof AUDIO_EQ_DEFAULT_BAND_DYNAMICS];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  if (scope === 'spectralDynamics') {
    const value = AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS[paramName as keyof typeof AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  return undefined;
}

export function getLegacyEffectKeyframeBaseValue(
  effect: Effect,
  paramName: string,
): number | undefined {
  if (!paramName.includes('.')) {
    const value = effect.params[paramName];
    // Cable defaults live in settings; explicit timeline keys supply the animated value.
    if (effect.type === 'face-cables' && /^cable_.+_(slack|windZ|windGusts|stiffness|gravity|damping|viscosity|width)$/.test(paramName)
      && value === undefined) return 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  const path = paramName.split('.').filter(Boolean);
  if (path.length === 0) {
    return undefined;
  }

  const value = effect.type === 'audio-eq' && path[0] === 'eq'
    ? getAudioEffectParamPathValue(
        normalizeAudioEqParams(effect.params) as unknown as Effect['params'],
        path.slice(1),
      )
    : getAudioEffectParamPathValue(effect.params, path);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return effect.type === 'audio-eq' && path[0] === 'eq'
    ? getDefaultAudioEqNumericPathValue(path.slice(1))
    : undefined;
}

function keyframePropertyInvalidatesProcessedAudio(
  clip: TimelineClip,
  property: AnimatableProperty,
): boolean {
  if (property === 'speed') return true;

  const effectProperty = parseEffectKeyframeProperty(property);
  if (!effectProperty) return false;

  const audioEffect = clip.audioState?.effectStack?.find(effect => effect.id === effectProperty.effectId);
  if (audioEffect && hasAudioEffect(audioEffect.descriptorId)) {
    if (audioEffect.descriptorId === 'audio-eq' && effectProperty.paramName.startsWith('eq.display.')) {
      return false;
    }
    return audioEffect.descriptorId !== 'audio-volume';
  }

  const legacyEffect = clip.effects?.find(effect => effect.id === effectProperty.effectId);
  if (legacyEffect && hasAudioEffect(legacyEffect.type)) {
    return legacyEffect.type !== 'audio-volume';
  }

  return false;
}

export function clearProcessedAudioAnalysisRefsForKeyframeTargets(
  clips: TimelineClip[],
  targets: readonly AudioKeyframeInvalidationTarget[],
): TimelineClip[] {
  if (targets.length === 0) return clips;

  const targetsByClip = new Map<string, Set<AnimatableProperty>>();
  for (const target of targets) {
    const properties = targetsByClip.get(target.clipId) ?? new Set<AnimatableProperty>();
    properties.add(target.property);
    targetsByClip.set(target.clipId, properties);
  }

  let changed = false;
  const nextClips = clips.map(clip => {
    const properties = targetsByClip.get(clip.id);
    if (!properties) return clip;
    const shouldInvalidate = [...properties].some(property =>
      keyframePropertyInvalidatesProcessedAudio(clip, property)
    );
    if (!shouldInvalidate) return clip;

    const nextClip = clearProcessedAudioAnalysisRefs(clip);
    if (nextClip !== clip) changed = true;
    return nextClip;
  });

  return changed ? nextClips : clips;
}
