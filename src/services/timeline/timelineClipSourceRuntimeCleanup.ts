import type { TimelineClip } from '../../types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { audioRoutingManager } from '../audioRoutingManager';
import { clearMasterAudio, playheadState } from '../layerBuilder/PlayheadState';
import { renderHostPort } from '../render/renderHostPort';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';

export interface TimelineClipSourceRuntimeCleanupOptions {
  cleanupVideoGpu?: boolean;
  disposeAudioRouting?: boolean;
  recurseNestedClips?: boolean;
  releaseVectorRuntime?: boolean;
  revokeObjectUrls?: boolean;
}

function safelyPauseMediaElement(element: HTMLMediaElement): void {
  try {
    element.pause();
  } catch {
    // Ignore cleanup errors from detached media elements.
  }
}

function safelyLoadMediaElement(element: HTMLMediaElement): void {
  try {
    element.load();
  } catch {
    // Ignore cleanup errors from detached media elements.
  }
}

function revokeElementSource(element: HTMLMediaElement): void {
  try {
    if (element.src) {
      URL.revokeObjectURL(element.src);
    }
  } catch {
    // Ignore invalid or already-revoked object URLs.
  }
}

export function detachLegacyTimelineMediaElement(
  element: HTMLMediaElement | null | undefined,
  options: Pick<TimelineClipSourceRuntimeCleanupOptions, 'disposeAudioRouting' | 'revokeObjectUrls'> = {},
): void {
  if (!element) return;

  if (playheadState.masterAudioElement === element) {
    clearMasterAudio();
  }

  safelyPauseMediaElement(element);

  if (options.revokeObjectUrls) {
    revokeElementSource(element);
  }

  if (options.disposeAudioRouting) {
    audioRoutingManager.disposeRoute(element);
  }

  element.removeAttribute('src');
  safelyLoadMediaElement(element);
}

function cleanupGpuVideoElement(element: HTMLVideoElement): void {
  renderHostPort.cleanupVideo(element);
}

export function releaseLegacyTimelineClipSourceRuntime(
  clip: TimelineClip,
  options: TimelineClipSourceRuntimeCleanupOptions = {},
): void {
  const source = clip.source;

  if (source?.type === 'video' && source.videoElement) {
    detachLegacyTimelineMediaElement(source.videoElement, options);
    if (options.cleanupVideoGpu) {
      cleanupGpuVideoElement(source.videoElement);
    }
  }

  if (source?.type === 'audio' && source.audioElement) {
    detachLegacyTimelineMediaElement(source.audioElement, options);
  }

  if (isVectorAnimationSourceType(source?.type) && options.releaseVectorRuntime !== false) {
    vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, source.type);
  }

  if (source?.webCodecsPlayer?.isPlaying) {
    source.webCodecsPlayer.pause();
  }

  if (options.recurseNestedClips) {
    clip.nestedClips?.forEach((nestedClip) => {
      releaseLegacyTimelineClipSourceRuntime(nestedClip, options);
    });
  }
}

export function releaseLegacyTimelineClipSourceRuntimes(
  clips: readonly TimelineClip[],
  options: TimelineClipSourceRuntimeCleanupOptions = {},
): void {
  clips.forEach((clip) => {
    releaseLegacyTimelineClipSourceRuntime(clip, options);
  });
}
