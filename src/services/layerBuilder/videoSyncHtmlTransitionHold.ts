import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';

export interface VideoSyncHtmlTransitionHoldDeps {
  clipWasPlaying: Set<string>;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
  isForceDecodeInProgress: (clipId: string) => boolean;
  forceVideoFrameDecode: (clipId: string, video: HTMLVideoElement) => void;
}

export function syncHtmlTransitionSourceHold({
  clip,
  video,
  clipTime,
  timeDiff,
  isInteractivePreview,
  deps,
}: {
  clip: TimelineClip;
  video: HTMLVideoElement;
  clipTime: number;
  timeDiff: number;
  isInteractivePreview: boolean;
  deps: VideoSyncHtmlTransitionHoldDeps;
}): void {
  deps.clipWasPlaying.delete(clip.id);
  scrubSettleState.resolve(clip.id);

  if (video.playbackRate !== 1) {
    video.playbackRate = 1;
  }
  if (!video.paused) {
    video.pause();
    vfPipelineMonitor.record('vf_pause', { clipId: clip.id, reason: 'transition-hold' });
  }

  const seekThreshold = isInteractivePreview ? 0.04 : 0.015;
  if (!video.seeking && timeDiff > seekThreshold) {
    const seekTime = deps.safeSeekTime(video, clipTime);
    video.addEventListener('seeked', () => {
      renderHostPort.markVideoFramePresented(video, seekTime, clip.id);
      if (!renderHostPort.captureVideoFrameAtTime(video, seekTime, clip.id)) {
        renderHostPort.ensureVideoFrameCached(video, clip.id);
      }
      renderHostPort.requestNewFrameRender();
    }, { once: true });
    video.currentTime = seekTime;
    vfPipelineMonitor.record('vf_transition_hold_seek', {
      clipId: clip.id,
      target: Math.round(clipTime * 1000) / 1000,
      seekTo: Math.round(seekTime * 1000) / 1000,
      driftMs: Math.round(timeDiff * 1000),
    });
    return;
  }

  if (video.readyState >= 2) {
    const presentedTime = deps.safeSeekTime(video, clipTime);
    renderHostPort.markVideoFramePresented(video, presentedTime, clip.id);
    if (!renderHostPort.captureVideoFrameAtTime(video, presentedTime, clip.id)) {
      renderHostPort.ensureVideoFrameCached(video, clip.id);
    }
  } else if (!video.seeking && !deps.isForceDecodeInProgress(clip.id)) {
    vfPipelineMonitor.record('vf_readystate_drop', {
      clipId: clip.id,
      readyState: video.readyState,
      reason: 'transition-hold',
    });
    deps.forceVideoFrameDecode(clip.id, video);
  }
}
