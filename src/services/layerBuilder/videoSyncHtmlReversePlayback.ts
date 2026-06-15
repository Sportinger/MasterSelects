import type { TimelineClip } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import { scrubSettleState } from '../scrubSettleState';
import type { FrameContext } from './types';

export interface VideoSyncHtmlReversePlaybackDeps {
  clipWasPlaying: Set<string>;
  clipWasDragging: Set<string>;
  htmlSeeks: {
    clearPreciseSeekTimer: (clipId: string) => void;
  };
  beginOrQueueSettleSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ) => void;
  throttledSeek: (clipId: string, video: HTMLVideoElement, time: number, ctx: FrameContext) => void;
  maybeRecoverScrubSettle: (clipId: string, video: HTMLVideoElement, targetTime: number) => void;
}

export function syncReverseOrNonstandardPlayback({
  clip,
  ctx,
  video,
  clipTime,
  timeDiff,
  isInteractivePreview,
  seekThreshold,
  clearPlayingState = false,
  deps,
}: {
  clip: TimelineClip;
  ctx: FrameContext;
  video: HTMLVideoElement;
  clipTime: number;
  timeDiff: number;
  isInteractivePreview: boolean;
  seekThreshold: number;
  clearPlayingState?: boolean;
  deps: VideoSyncHtmlReversePlaybackDeps;
}): void {
  if (!video.paused) video.pause();
  if (clearPlayingState) {
    deps.clipWasPlaying.delete(clip.id);
  }
  if (isInteractivePreview) {
    deps.clipWasDragging.add(clip.id);
  } else if (deps.clipWasDragging.has(clip.id)) {
    deps.clipWasDragging.delete(clip.id);
    deps.htmlSeeks.clearPreciseSeekTimer(clip.id);
    if (timeDiff > 0.001) {
      deps.beginOrQueueSettleSeek(clip.id, video, clipTime, undefined, 'scrub-stop');
      video.addEventListener('seeked', () => engine.requestNewFrameRender(), { once: true });
    } else {
      scrubSettleState.resolve(clip.id);
    }
    return;
  }
  if (timeDiff > seekThreshold) {
    deps.throttledSeek(clip.id, video, clipTime, ctx);
  }
  if (!isInteractivePreview) {
    deps.maybeRecoverScrubSettle(clip.id, video, clipTime);
  }
}
