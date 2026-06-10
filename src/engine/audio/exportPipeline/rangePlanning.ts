import { getAudioEffect } from '../AudioEffectRegistry';
import type { AudioGraphEffectPlanStep, AudioGraphJsonValue } from '../AudioGraphTypes';
import { createBuffer as createAudioBufferLike } from '../audioBufferFactory';
import { finiteNumber } from '../audioMath';
import type { AudioEffectInstance, MasterAudioState } from '../../../types/audio';
import type { Effect } from '../../../types/effects';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

const MAX_EXPORT_EFFECT_TAIL_SECONDS = 30;

function clampExportTailSeconds(seconds: number): number {
  return Math.max(0, Math.min(MAX_EXPORT_EFFECT_TAIL_SECONDS, seconds));
}

function getParamNumber(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  return finiteNumber(params?.[key], fallback);
}

function getEffectTailSeconds(descriptorId: string, params?: Record<string, unknown>): number {
  const descriptor = getAudioEffect(descriptorId);
  const descriptorTail = finiteNumber(descriptor?.tailSeconds, 0);

  if (descriptorId === 'audio-reverb') {
    return clampExportTailSeconds(Math.max(descriptorTail, getParamNumber(params, 'decaySeconds', 0)));
  }

  if (descriptorId === 'audio-delay') {
    const delaySeconds = getParamNumber(params, 'delayMs', 0) / 1000;
    const feedback = Math.max(0, Math.min(0.95, getParamNumber(params, 'feedback', 0)));
    const repeats = feedback > 0.001
      ? Math.ceil(Math.log(0.001) / Math.log(feedback))
      : 1;
    return clampExportTailSeconds(Math.max(descriptorTail, delaySeconds * Math.max(1, repeats)));
  }

  return clampExportTailSeconds(descriptorTail);
}

function getEffectStackTailSeconds(effectStack: readonly AudioEffectInstance[] | undefined): number {
  return clampExportTailSeconds((effectStack ?? []).reduce((sum, effect) => {
    const flags = effect as AudioEffectInstance & { disabled?: boolean; bypassed?: boolean };
    if (effect.enabled === false || flags.disabled === true || flags.bypassed === true) return sum;
    return sum + getEffectTailSeconds(effect.descriptorId, effect.params as Record<string, unknown> | undefined);
  }, 0));
}

function getLegacyEffectTailSeconds(effects: readonly Effect[] | undefined): number {
  return clampExportTailSeconds((effects ?? []).reduce((sum, effect) => {
    if (effect.enabled === false) return sum;
    return sum + getEffectTailSeconds(effect.type, effect.params as Record<string, unknown> | undefined);
  }, 0));
}

export function getPlanTailSeconds(effectChain: readonly AudioGraphEffectPlanStep[] | undefined): number {
  return clampExportTailSeconds((effectChain ?? []).reduce((sum, effect) => (
    sum + getEffectTailSeconds(effect.descriptorId, effect.params as Record<string, AudioGraphJsonValue>)
  ), 0));
}

export function getClipExportTailSeconds(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  masterAudioState?: MasterAudioState,
): number {
  return clampExportTailSeconds(
    getEffectStackTailSeconds(clip.audioState?.effectStack) +
    getLegacyEffectTailSeconds(clip.effects) +
    getEffectStackTailSeconds(track?.audioState?.effectStack) +
    getEffectStackTailSeconds(masterAudioState?.effectStack)
  );
}

export function appendSilence(buffer: AudioBuffer, tailSeconds: number): AudioBuffer {
  const tailSamples = Math.max(0, Math.ceil(clampExportTailSeconds(tailSeconds) * buffer.sampleRate));
  if (tailSamples <= 0) return buffer;

  const extended = createAudioBufferLike(buffer.numberOfChannels, buffer.length + tailSamples, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    extended.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return extended;
}
