import type { TimelineClip } from '../../types';
import { compositionAudioMixer, type CompositionMixdownResult } from '../compositionAudioMixer';
import { useTimelineStore } from '../../stores/timeline';

export interface CompositionAudioMixdownRequestResult extends CompositionMixdownResult {
  key: string;
}

interface PendingMixdownEntry {
  promise: Promise<CompositionAudioMixdownRequestResult | null>;
}

export const MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS = 12;

const pendingMixdowns = new Map<string, PendingMixdownEntry>();
const completedMixdowns = new Map<string, CompositionAudioMixdownRequestResult | null>();

function rememberCompletedMixdown(key: string, value: CompositionAudioMixdownRequestResult | null): void {
  completedMixdowns.delete(key);
  completedMixdowns.set(key, value);

  while (completedMixdowns.size > MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS) {
    const oldestKey = completedMixdowns.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    completedMixdowns.delete(oldestKey);
  }
}

function getCompletedMixdown(key: string): CompositionAudioMixdownRequestResult | null | undefined {
  if (!completedMixdowns.has(key)) {
    return undefined;
  }
  const value = completedMixdowns.get(key) ?? null;
  rememberCompletedMixdown(key, value);
  return value;
}

export function getCompositionAudioMixdownKey(
  clip: Pick<TimelineClip, 'compositionId' | 'nestedContentHash'>,
): string | null {
  if (!clip.compositionId) return null;
  return [
    clip.compositionId,
    clip.nestedContentHash ?? 'unknown-content',
  ].join(':');
}

function resultFromExistingBuffer(
  clip: Pick<TimelineClip, 'compositionId' | 'nestedContentHash' | 'mixdownBuffer' | 'mixdownWaveform' | 'waveform' | 'duration' | 'source'>,
  key: string,
): CompositionAudioMixdownRequestResult | null {
  if (!clip.mixdownBuffer) return null;
  return {
    key,
    buffer: clip.mixdownBuffer,
    waveform: clip.mixdownWaveform ?? clip.waveform ?? [],
    duration: clip.source?.naturalDuration ?? clip.mixdownBuffer.duration ?? clip.duration,
    hasAudio: true,
  };
}

export async function requestCompositionAudioMixdown(
  clip: Pick<TimelineClip, 'compositionId' | 'nestedContentHash' | 'mixdownBuffer' | 'mixdownWaveform' | 'waveform' | 'duration' | 'source'>,
): Promise<CompositionAudioMixdownRequestResult | null> {
  const key = getCompositionAudioMixdownKey(clip);
  if (!key || !clip.compositionId) return null;

  const existing = resultFromExistingBuffer(clip, key);
  if (existing) return existing;

  const completed = getCompletedMixdown(key);
  if (completed !== undefined) {
    return completed;
  }

  const pending = pendingMixdowns.get(key);
  if (pending) return pending.promise;

  const promise = compositionAudioMixer
    .mixdownComposition(clip.compositionId)
    .then((result): CompositionAudioMixdownRequestResult | null => {
      const value = result ? { ...result, key } : null;
      rememberCompletedMixdown(key, value);
      return value;
    })
    .finally(() => {
      pendingMixdowns.delete(key);
    });

  pendingMixdowns.set(key, { promise });
  return promise;
}

export function createCompositionMixdownAudioElement(clipId: string, buffer: AudioBuffer): HTMLAudioElement {
  return compositionAudioMixer.createAudioElement(buffer, { ownerClipId: clipId });
}

export function applyCompositionAudioMixdownToTimelineClip(
  clipId: string,
  result: CompositionAudioMixdownRequestResult,
  options: { audioElement?: HTMLAudioElement } = {},
): void {
  useTimelineStore.setState((state) => ({
    clips: state.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const audioSource = clip.source?.type === 'audio'
        ? {
            ...clip.source,
            ...(options.audioElement ? { audioElement: options.audioElement } : {}),
            naturalDuration: result.duration,
          }
        : clip.source;
      return {
        ...clip,
        source: audioSource,
        ...(clip.source?.type !== 'audio' && options.audioElement ? { mixdownAudio: options.audioElement } : {}),
        mixdownBuffer: result.hasAudio ? result.buffer : undefined,
        mixdownWaveform: result.hasAudio ? result.waveform : undefined,
        waveform: result.hasAudio && clip.source?.type === 'audio' ? result.waveform : clip.waveform,
        mixdownGenerating: false,
        hasMixdownAudio: result.hasAudio,
      };
    }),
  }));
}

export function clearCompositionAudioMixdownCache(): void {
  pendingMixdowns.clear();
  completedMixdowns.clear();
}

export function getCompositionAudioMixdownCacheStats(): {
  pendingCount: number;
  completedCount: number;
  maxCompletedCount: number;
} {
  return {
    pendingCount: pendingMixdowns.size,
    completedCount: completedMixdowns.size,
    maxCompletedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
  };
}
