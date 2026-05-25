import type {
  ClipAudioEditOperation,
  AudioEffectInstance,
  Effect,
  Keyframe,
  TimelineClip,
} from '../../types';
import { hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import {
  createClipAudioStateHash,
  type ClipAudioAnalysisIdentityInput,
} from './audioAnalysisIdentity';

function isEnabled<T extends { enabled?: boolean }>(item: T): boolean {
  return item.enabled !== false;
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
    trackGraphIdentity?: string | null;
    masterGraphIdentity?: string | null;
  } = {},
): ClipAudioAnalysisIdentityInput {
  return {
    audioState: {
      ...(clip.audioState ?? {}),
      effectStack: collectRenderableClipAudioEffectInstances(clip),
    },
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
  if (collectRenderableClipAudioEditOperations(clip).length > 0) return true;
  return collectRenderableClipAudioEffectInstances(clip).length > 0;
}
