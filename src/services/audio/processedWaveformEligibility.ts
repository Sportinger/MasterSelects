import type {
  ClipAudioEditOperation,
  AudioEffectInstance,
  Effect,
  Keyframe,
  TimelineClip,
} from '../../types';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';
import {
  createClipAudioStateHash,
  type ClipAudioAnalysisIdentityInput,
} from './audioAnalysisIdentity';

function isEnabled<T extends { enabled?: boolean }>(item: T): boolean {
  return item.enabled !== false;
}

type RuntimeEffectFlags = {
  bypassed?: boolean;
  disabled?: boolean;
};

const DEFAULT_AUDIO_PARAM_EPSILON = 0.001;
const EQ_AUDIO_PARAM_EPSILON = 0.01;

function effectAutomationPropertyPrefix(effectId: string): string {
  return `effect.${effectId}.`;
}

export function hasAudioEffectAutomationKeyframes(
  effectId: string,
  keyframes: readonly Keyframe[] = [],
): boolean {
  const prefix = effectAutomationPropertyPrefix(effectId);
  return keyframes.some(keyframe => keyframe.property.startsWith(prefix));
}

function numericParamDiffers(
  value: unknown,
  defaultValue: number,
  epsilon: number,
): boolean {
  if (value === undefined) return false;
  return typeof value === 'number'
    ? Math.abs(value - defaultValue) > epsilon
    : true;
}

function audioEffectParamDiffersFromDefault(
  descriptorId: string,
  params: Record<string, unknown> | undefined,
): boolean {
  const descriptor = getAudioEffect(descriptorId);
  if (!descriptor) return false;

  const defaults = getAudioEffectDefaultParams(descriptorId);
  const epsilon = descriptorId === 'audio-eq' ? EQ_AUDIO_PARAM_EPSILON : DEFAULT_AUDIO_PARAM_EPSILON;

  return descriptor.paramNames.some(paramName => {
    const defaultValue = defaults[paramName];
    const value = params?.[paramName];

    if (typeof defaultValue === 'number') {
      return numericParamDiffers(value, defaultValue, epsilon);
    }

    if (value === undefined) return false;
    return value !== defaultValue;
  });
}

export function legacyAudioEffectRequiresProcessedAnalysis(
  effect: Effect | undefined,
  keyframes: readonly Keyframe[] = [],
): boolean {
  if (!effect || effect.enabled === false || !hasAudioEffect(effect.type)) return false;
  if (effect.type === 'audio-volume') return false;
  if (getAudioEffect(effect.type)?.defaultAudible === true) return true;
  if (hasAudioEffectAutomationKeyframes(effect.id, keyframes)) return true;
  return audioEffectParamDiffersFromDefault(effect.type, effect.params);
}

export function audioEffectInstanceRequiresProcessedAnalysis(
  effect: (AudioEffectInstance & RuntimeEffectFlags) | undefined,
  keyframes: readonly Keyframe[] = [],
): boolean {
  if (
    !effect ||
    effect.enabled === false ||
    effect.disabled === true ||
    effect.bypassed === true ||
    !hasAudioEffect(effect.descriptorId)
  ) {
    return false;
  }
  if (effect.descriptorId === 'audio-volume') return false;
  if (getAudioEffect(effect.descriptorId)?.defaultAudible === true) return true;
  if (hasAudioEffectAutomationKeyframes(effect.id, keyframes)) return true;
  return audioEffectParamDiffersFromDefault(effect.descriptorId, effect.params);
}

function hasEnabledSpectralLayer(clip: Pick<TimelineClip, 'audioState'>): boolean {
  return (clip.audioState?.spectralLayers ?? []).some(layer => layer.enabled !== false);
}

function hasEnabledSpectralEditOperation(clip: Pick<TimelineClip, 'audioState'>): boolean {
  return (clip.audioState?.editStack ?? []).some(operation =>
    operation.enabled !== false &&
    (operation.type === 'spectral-mask' || operation.type === 'spectral-resynthesis')
  );
}

const RENDERABLE_CLIP_AUDIO_EDIT_TYPES = new Set<ClipAudioEditOperation['type']>([
  'silence',
  'cut',
  'paste',
  'insert-silence',
  'delete-silence',
  'reverse',
  'invert-polarity',
  'swap-channels',
  'mono-sum',
  'split-stereo',
  'repair',
  'room-tone-fill',
  'spectral-mask',
  'spectral-resynthesis',
]);

function legacyEffectToAudioEffectInstance(effect: Effect): AudioEffectInstance | null {
  if (!hasAudioEffect(effect.type)) return null;

  return {
    id: effect.id,
    descriptorId: effect.type,
    enabled: effect.enabled !== false,
    params: { ...effect.params },
    automationMode: 'clip',
  };
}

export function collectRenderableClipAudioEffectInstances(
  clip: Pick<TimelineClip, 'audioState' | 'effects'>,
): AudioEffectInstance[] {
  const collected: AudioEffectInstance[] = [];
  const seenIds = new Set<string>();

  for (const effect of clip.audioState?.effectStack ?? []) {
    if (!isEnabled(effect) || !hasAudioEffect(effect.descriptorId)) continue;
    collected.push({
      ...effect,
      params: { ...effect.params },
    });
    seenIds.add(effect.id);
  }

  for (const legacyEffect of clip.effects ?? []) {
    if (seenIds.has(legacyEffect.id)) continue;
    const effect = legacyEffectToAudioEffectInstance(legacyEffect);
    if (!effect || !isEnabled(effect)) continue;
    collected.push(effect);
    seenIds.add(effect.id);
  }

  return collected;
}

export function collectProcessedAnalysisClipAudioEffectInstances(
  clip: Pick<TimelineClip, 'audioState' | 'effects'>,
  keyframes: readonly Keyframe[] = [],
): AudioEffectInstance[] {
  const collected: AudioEffectInstance[] = [];
  const seenIds = new Set<string>();

  for (const effect of clip.audioState?.effectStack ?? []) {
    if (!audioEffectInstanceRequiresProcessedAnalysis(effect, keyframes)) continue;
    collected.push({
      ...effect,
      params: { ...effect.params },
    });
    seenIds.add(effect.id);
  }

  for (const legacyEffect of clip.effects ?? []) {
    if (seenIds.has(legacyEffect.id)) continue;
    if (!legacyAudioEffectRequiresProcessedAnalysis(legacyEffect, keyframes)) continue;
    const effect = legacyEffectToAudioEffectInstance(legacyEffect);
    if (!effect) continue;
    collected.push(effect);
    seenIds.add(effect.id);
  }

  return collected;
}

export function collectRenderableClipAudioEditOperations(
  clip: Pick<TimelineClip, 'audioState'>,
): ClipAudioEditOperation[] {
  return (clip.audioState?.editStack ?? [])
    .filter(operation => isEnabled(operation) && RENDERABLE_CLIP_AUDIO_EDIT_TYPES.has(operation.type))
    .map(operation => ({
      ...operation,
      params: { ...operation.params },
      ...(operation.timeRange ? { timeRange: { ...operation.timeRange } } : {}),
      ...(operation.channelMask ? { channelMask: [...operation.channelMask] } : {}),
    }));
}

export function createProcessedClipAudioIdentityInput(
  clip: TimelineClip,
  options: {
    keyframes?: readonly Keyframe[];
    trackGraphIdentity?: string | null;
    masterGraphIdentity?: string | null;
  } = {},
): ClipAudioAnalysisIdentityInput {
  const processedEffects = collectProcessedAnalysisClipAudioEffectInstances(clip, options.keyframes);
  const processedEffectIds = new Set(processedEffects.map(effect => effect.id));
  const automationKeyframes = (options.keyframes ?? [])
    .filter(keyframe =>
      keyframe.property === 'speed' ||
      [...processedEffectIds].some(effectId => keyframe.property.startsWith(effectAutomationPropertyPrefix(effectId)))
    )
    .map(keyframe => ({
      property: keyframe.property,
      time: keyframe.time,
      value: keyframe.value,
      easing: keyframe.easing ?? null,
    }))
    .toSorted((a, b) => a.property.localeCompare(b.property) || a.time - b.time);

  return {
    audioState: {
      ...(clip.audioState ?? {}),
      muted: false,
      effectStack: processedEffects,
    },
    automationKeyframes: automationKeyframes.length > 0 ? automationKeyframes : undefined,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    duration: clip.duration,
    speed: clip.speed,
    reversed: clip.reversed,
    preservesPitch: clip.preservesPitch,
    trackGraphIdentity: options.trackGraphIdentity,
    masterGraphIdentity: options.masterGraphIdentity,
  };
}

export function createProcessedClipAudioStateHash(
  clip: TimelineClip,
  options: {
    keyframes?: readonly Keyframe[];
    trackGraphIdentity?: string | null;
    masterGraphIdentity?: string | null;
  } = {},
): string {
  return createClipAudioStateHash(createProcessedClipAudioIdentityInput(clip, options));
}

export function clipRequiresProcessedWaveformPyramid(
  clip: TimelineClip,
  keyframes: readonly Keyframe[] = [],
): boolean {
  if (clip.audioState?.muted === true) return true;
  if (clip.reversed === true) return true;
  if (Math.abs((clip.speed ?? 1) - 1) > 0.001) return true;
  if (keyframes.some(keyframe => keyframe.property === 'speed')) return true;
  if (hasEnabledSpectralLayer(clip)) return true;
  if (hasEnabledSpectralEditOperation(clip)) return true;
  if (collectRenderableClipAudioEditOperations(clip).length > 0) return true;
  return collectProcessedAnalysisClipAudioEffectInstances(clip, keyframes).length > 0;
}
