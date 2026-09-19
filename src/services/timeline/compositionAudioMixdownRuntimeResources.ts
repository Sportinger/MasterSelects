import type { TimelineClip } from '../../types/timeline';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';
import { detachLegacyTimelineMediaElement } from './timelineClipSourceRuntimeCleanup';

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function hashCompositionAudioMixdownKey(key: string): string {
  return hashString(key);
}

export function getCompositionMixdownAudioElementResourceId(clipId: string): string {
  return `composition-audio-mixdown:playback-element:${clipId}`;
}

export function getCompositionMixdownBufferResourceId(key: string): string {
  return `composition-audio-mixdown:buffer:${hashString(key)}`;
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

export function releaseCompositionMixdownAudioElementResource(clipId: string): void {
  timelineRuntimeCoordinator.releaseResource(getCompositionMixdownAudioElementResourceId(clipId));
}

export function releaseCompletedCompositionAudioMixdownResource(key: string): void {
  timelineRuntimeCoordinator.releaseResource(getCompositionMixdownBufferResourceId(key));
}

export function detachCompositionMixdownAudioElement(
  clip: Pick<TimelineClip, 'source' | 'mixdownAudio'>,
): void {
  detachLegacyTimelineMediaElement(
    clip.source?.type === 'audio' ? clip.source.audioElement : clip.mixdownAudio,
    { disposeAudioRouting: true },
  );
}

export function releaseCompositionMixdownClipRuntime(
  clip: Pick<TimelineClip, 'id' | 'compositionId' | 'nestedContentHash'>,
): void {
  releaseCompositionMixdownAudioElementResource(clip.id);
  const key = getCompositionAudioMixdownKey(clip);
  if (!key) return;
  releaseCompletedCompositionAudioMixdownResource(key);
  void import('./compositionAudioMixdownCache').then(({ forgetCompletedCompositionAudioMixdown }) => {
    forgetCompletedCompositionAudioMixdown(key);
  });
}
