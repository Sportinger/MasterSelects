import { shouldStageHtmlVideoFrame } from '../../engine/texture/videoFrameCopyPolicy';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import type { VideoSyncHtmlSeekState } from './videoSyncHtmlSeekState';
import { recordSurfaceVideoFrameTime } from '../../engine/render/surfaceVideoFrame';

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: NonNullable<HTMLVideoElement['requestVideoFrameCallback']>;
  cancelVideoFrameCallback: NonNullable<HTMLVideoElement['cancelVideoFrameCallback']>;
};

function getVideoFrameCallbackVideo(video: HTMLVideoElement): VideoFrameCallbackVideo | null {
  const candidate = video as HTMLVideoElement & {
    requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'];
    cancelVideoFrameCallback?: HTMLVideoElement['cancelVideoFrameCallback'];
  };
  return typeof candidate.requestVideoFrameCallback === 'function'
    && typeof candidate.cancelVideoFrameCallback === 'function'
    ? candidate as VideoFrameCallbackVideo
    : null;
}

export function cancelHtmlVideoFrameCallback(video: HTMLVideoElement, handle: number): void {
  getVideoFrameCallbackVideo(video)?.cancelVideoFrameCallback(handle);
}

interface VideoSyncHtmlFramePresenterDeps {
  htmlSeeks: VideoSyncHtmlSeekState;
  flushQueuedSeekTarget: (
    clipId: string,
    video: HTMLVideoElement,
    source: 'seeked' | 'rvfc',
  ) => void;
  getTimelinePlaybackState: () => { isDragging: boolean; isPlaying: boolean };
}

export class VideoSyncHtmlFramePresenter {
  private readonly deps: VideoSyncHtmlFramePresenterDeps;
  private androidFrameCaptures = new WeakMap<HTMLVideoElement, Promise<number>>();

  constructor(deps: VideoSyncHtmlFramePresenterDeps) {
    this.deps = deps;
  }

  armSeekedFlush(clipId: string, video: HTMLVideoElement): void {
    if (this.deps.htmlSeeks.hasSeekedFlushArmed(clipId)) return;
    this.deps.htmlSeeks.armSeekedFlush(clipId);
    video.addEventListener('seeked', () => {
      this.deps.htmlSeeks.clearSeekedFlush(clipId);
      const presentedTime = video.currentTime;
      const finishSeeked = () => {
        renderHostPort.requestNewFrameRender();
        if (this.deps.getTimelinePlaybackState().isDragging
          && this.deps.htmlSeeks.getQueuedTarget(clipId) !== undefined) {
          const flush = () => this.deps.flushQueuedSeekTarget(clipId, video, 'seeked');
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
          else setTimeout(flush, 16);
          return;
        }
        this.deps.flushQueuedSeekTarget(clipId, video, 'seeked');
      };

      if (shouldStageHtmlVideoFrame(video)) {
        void this.captureAndroidHtmlFrame(clipId, video, presentedTime).then(finishSeeked);
        return;
      }
      renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
      renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId);
      renderHostPort.cacheFrameAtTime(video, presentedTime, clipId);
      finishSeeked();
    }, { once: true });
  }

  registerRVFC(clipId: string, video: HTMLVideoElement): void {
    const frameVideo = getVideoFrameCallbackVideo(video);
    if (!frameVideo) return;
    const previousHandle = this.deps.htmlSeeks.getRvfcHandle(clipId);
    if (previousHandle !== undefined) frameVideo.cancelVideoFrameCallback(previousHandle);
    this.deps.htmlSeeks.setRvfcHandle(clipId, frameVideo.requestVideoFrameCallback((_now, metadata) => {
      const metadataTime = metadata?.mediaTime;
      if (typeof metadataTime === 'number') recordSurfaceVideoFrameTime(video, metadataTime);
      const presentedTime = typeof metadataTime === 'number' && Number.isFinite(metadataTime)
        ? metadataTime
        : video.currentTime;
      this.deps.htmlSeeks.deleteRvfcHandle(clipId);
      this.deps.htmlSeeks.clearPendingTarget(clipId);
      const finishPresentedFrame = () => {
        scrubSettleState.resolve(clipId);
        vfPipelineMonitor.record('vf_seek_done', { clipId });
        this.deps.flushQueuedSeekTarget(clipId, video, 'rvfc');
        renderHostPort.requestNewFrameRender();
      };
      if (shouldStageHtmlVideoFrame(video)) {
        void this.captureAndroidHtmlFrame(clipId, video, presentedTime).then(finishPresentedFrame);
        return;
      }
      renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
      renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId);
      renderHostPort.cacheFrameAtTime(video, presentedTime, clipId);
      finishPresentedFrame();
    }));
  }

  private captureAndroidHtmlFrame(
    clipId: string,
    video: HTMLVideoElement,
    fallbackTime: number,
  ): Promise<number> {
    const activeCapture = this.androidFrameCaptures.get(video);
    if (activeCapture) return activeCapture;
    const capture = (async () => {
      video.muted = true;
      let presentedTime = fallbackTime;
      try {
        await video.play();
        presentedTime = await this.waitForPresentedFrame(video, fallbackTime);
        renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
        if (!renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId)) {
          await renderHostPort.preCacheVideoFrame(video, clipId);
        }
        renderHostPort.cacheFrameAtTime(video, presentedTime, clipId);
      } catch {
        await renderHostPort.preCacheVideoFrame(video, clipId);
      } finally {
        if (!this.deps.getTimelinePlaybackState().isPlaying) video.pause();
        this.androidFrameCaptures.delete(video);
      }
      return presentedTime;
    })();
    this.androidFrameCaptures.set(video, capture);
    return capture;
  }

  private waitForPresentedFrame(video: HTMLVideoElement, fallbackTime: number): Promise<number> {
    const frameVideo = getVideoFrameCallbackVideo(video);
    if (!frameVideo) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(video.currentTime || fallbackTime), 50);
      });
    }
    return new Promise((resolve) => {
      let handle = 0;
      const timeout = setTimeout(() => {
        frameVideo.cancelVideoFrameCallback(handle);
        resolve(video.currentTime || fallbackTime);
      }, 180);
      handle = frameVideo.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timeout);
        const mediaTime = metadata?.mediaTime;
        if (typeof mediaTime === 'number') recordSurfaceVideoFrameTime(video, mediaTime);
        resolve(typeof mediaTime === 'number' && Number.isFinite(mediaTime)
          ? mediaTime
          : video.currentTime || fallbackTime);
      });
    });
  }
}
