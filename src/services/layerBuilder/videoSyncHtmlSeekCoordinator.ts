import { useTimelineStore } from '../../stores/timeline';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import type { FrameContext } from './types';
import type { VideoSyncHtmlSeekState } from './videoSyncHtmlSeekState';

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

function getFastSeek(video: HTMLVideoElement): ((time: number) => void) | null {
  const fastSeek = (video as HTMLVideoElement & {
    fastSeek?: (time: number) => void;
  }).fastSeek;
  return typeof fastSeek === 'function' ? fastSeek.bind(video) : null;
}

export type VideoSyncHtmlSeekCoordinatorDeps = {
  htmlSeeks: VideoSyncHtmlSeekState;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
  maybeRecoverDraggingPendingSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number
  ) => boolean;
};

export class VideoSyncHtmlSeekCoordinator {
  private static readonly SCRUB_SETTLE_TIMEOUT_MS = 220;
  private static readonly SCRUB_SETTLE_RVFC_DEFER_MS = 90;
  private static readonly SCRUB_DRAG_RVFC_FOLLOW_THRESHOLD = 0.16;
  private static readonly SCRUB_DRAG_RVFC_FORCE_PRECISE_THRESHOLD = 0.7;

  private readonly deps: VideoSyncHtmlSeekCoordinatorDeps;

  constructor(deps: VideoSyncHtmlSeekCoordinatorDeps) {
    this.deps = deps;
  }

  beginOrQueueSettleSeek(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ): void {
    scrubSettleState.begin(clipId, targetTime, VideoSyncHtmlSeekCoordinator.SCRUB_SETTLE_TIMEOUT_MS, reason);

    const pendingTarget = this.deps.htmlSeeks.getPendingTarget(clipId);
    const hasNearPendingTarget =
      typeof pendingTarget === 'number' &&
      Math.abs(pendingTarget - targetTime) <= 0.08;

    if (video.seeking || this.deps.htmlSeeks.hasRvfcHandle(clipId) || hasNearPendingTarget) {
      this.deps.htmlSeeks.setQueuedTarget(clipId, targetTime);
      this.armSeekedFlush(clipId, video);
      vfPipelineMonitor.record('vf_settle_seek', {
        clipId,
        target: Math.round(targetTime * 1000) / 1000,
        queued: 'true',
        ...detail,
      });
      return;
    }

    this.deps.htmlSeeks.setPendingTarget(clipId, targetTime, performance.now());
    video.currentTime = this.deps.safeSeekTime(video, targetTime);
    this.armSeekedFlush(clipId, video);
    vfPipelineMonitor.record('vf_settle_seek', {
      clipId,
      target: Math.round(targetTime * 1000) / 1000,
      ...detail,
    });
    this.registerRVFC(clipId, video);
  }

  clearHtmlSeekState(clipId: string, video?: HTMLVideoElement): void {
    this.cancelRvfcHandle(clipId, video);
    this.deps.htmlSeeks.clearClipTargets(clipId);
  }

  cancelRvfcHandle(clipId: string, video?: HTMLVideoElement): void {
    const handle = this.deps.htmlSeeks.getRvfcHandle(clipId);
    if (handle !== undefined) {
      if (video && hasVideoFrameCallback(video)) video.cancelVideoFrameCallback(handle);
      this.deps.htmlSeeks.deleteRvfcHandle(clipId);
    }
  }

  throttledSeek(clipId: string, video: HTMLVideoElement, time: number, ctx: FrameContext): void {
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
    const fastSeek = getFastSeek(video);
    const supportsFastSeek = fastSeek !== null;
    const presentedTime = renderHostPort.getLastPresentedVideoTime(video);
    const effectiveDisplayedTime =
      typeof presentedTime === 'number' ? presentedTime : video.currentTime;
    const displayedDriftSeconds = Math.abs(effectiveDisplayedTime - time);

    if (this.hasPendingDuplicateSeek(clipId, video, time)) {
      if (isInteractivePreview) {
        this.deps.htmlSeeks.setLatestTarget(clipId, time);
      }
      return;
    }

    if ((video.seeking || this.deps.htmlSeeks.hasRvfcHandle(clipId)) && this.deps.htmlSeeks.getPendingTarget(clipId) !== undefined) {
      const allowInFlightRetarget = isInteractivePreview && supportsFastSeek;
      if (isInteractivePreview && !allowInFlightRetarget) {
        const pendingTarget = this.deps.htmlSeeks.getPendingTarget(clipId);
        const pendingAge = ctx.now - (this.deps.htmlSeeks.getPendingStartedAt(clipId) ?? ctx.now);
        const pendingTargetDrift =
          typeof pendingTarget === 'number'
            ? Math.abs(pendingTarget - time)
            : 0;
        if (
          displayedDriftSeconds >= 1 &&
          pendingAge >= 45 &&
          pendingTargetDrift >= 0.35
        ) {
          this.deps.htmlSeeks.setPendingTarget(clipId, time, ctx.now);
          this.deps.htmlSeeks.setLatestTarget(clipId, time);
          video.currentTime = this.deps.safeSeekTime(video, time);
          this.armSeekedFlush(clipId, video);
          vfPipelineMonitor.record('vf_seek_precise', {
            clipId,
            target: Math.round(time * 1000) / 1000,
            retarget: 'true',
            followup: 'drag-force-retarget',
          });
          this.registerRVFC(clipId, video);
          this.deps.htmlSeeks.setLastSeekAt(clipId, ctx.now);
          return;
        }
        this.deps.htmlSeeks.setQueuedTarget(clipId, time);
        this.deps.htmlSeeks.setLatestTarget(clipId, time);
        this.armSeekedFlush(clipId, video);
        if (this.deps.maybeRecoverDraggingPendingSeek(clipId, video, time, ctx.now)) {
          this.deps.htmlSeeks.setLastSeekAt(clipId, ctx.now);
        }
        return;
      }
      if (this.shouldRetargetPendingSeek(
        clipId,
        time,
        ctx.now,
        isInteractivePreview,
        allowInFlightRetarget,
        displayedDriftSeconds
      )) {
        this.deps.htmlSeeks.setPendingTarget(clipId, time, ctx.now);
        if (isInteractivePreview) {
          this.deps.htmlSeeks.setLatestTarget(clipId, time);
        }

        if (isInteractivePreview && supportsFastSeek) {
          fastSeek(this.deps.safeSeekTime(video, time));
          this.armSeekedFlush(clipId, video);
          vfPipelineMonitor.record('vf_seek_fast', {
            clipId,
            target: Math.round(time * 1000) / 1000,
            retarget: 'true',
          });

          this.deps.htmlSeeks.replacePreciseSeekTimer(clipId, setTimeout(() => {
            const target = this.deps.htmlSeeks.getLatestTarget(clipId);
            if (target !== undefined && Math.abs(video.currentTime - target) > 0.01) {
              this.deps.htmlSeeks.setPendingTarget(clipId, target, performance.now());
              video.currentTime = this.deps.safeSeekTime(video, target);
              this.armSeekedFlush(clipId, video);
              vfPipelineMonitor.record('vf_seek_precise', {
                clipId,
                target: Math.round(target * 1000) / 1000,
                deferred: 'true',
                retarget: 'true',
              });
              this.registerRVFC(clipId, video);
            }
          }, 90));
        } else {
          video.currentTime = this.deps.safeSeekTime(video, time);
          this.armSeekedFlush(clipId, video);
          vfPipelineMonitor.record('vf_seek_precise', {
            clipId,
            target: Math.round(time * 1000) / 1000,
            retarget: 'true',
          });
          this.registerRVFC(clipId, video);
        }

        this.deps.htmlSeeks.setLastSeekAt(clipId, ctx.now);
        return;
      }

      this.deps.htmlSeeks.setQueuedTarget(clipId, time);
      if (isInteractivePreview) {
        this.deps.htmlSeeks.setLatestTarget(clipId, time);
      }
      this.armSeekedFlush(clipId, video);
      if (this.deps.maybeRecoverDraggingPendingSeek(clipId, video, time, ctx.now)) {
        this.deps.htmlSeeks.setLastSeekAt(clipId, ctx.now);
      }
      return;
    }

    const lastSeek = this.deps.htmlSeeks.getLastSeekAt(clipId);
    const dragDrift = Math.abs(effectiveDisplayedTime - time);
    const threshold = isInteractivePreview
      ? supportsFastSeek
        ? dragDrift >= 1
          ? 16
          : dragDrift >= 0.35
            ? 28
            : 50
        : dragDrift >= 1
          ? 60
          : dragDrift >= 0.35
            ? 85
            : 110
      : 33;
    if (ctx.now - lastSeek > threshold) {
      if (isInteractivePreview && supportsFastSeek) {
        this.deps.htmlSeeks.setPendingTarget(clipId, time, ctx.now);
        fastSeek(this.deps.safeSeekTime(video, time));
        this.armSeekedFlush(clipId, video);
        vfPipelineMonitor.record('vf_seek_fast', {
          clipId,
          target: Math.round(time * 1000) / 1000,
        });

        this.deps.htmlSeeks.setLatestTarget(clipId, time);
        this.deps.htmlSeeks.replacePreciseSeekTimer(clipId, setTimeout(() => {
          const target = this.deps.htmlSeeks.getLatestTarget(clipId);
          if (target !== undefined && Math.abs(video.currentTime - target) > 0.01) {
            this.deps.htmlSeeks.setPendingTarget(clipId, target, performance.now());
            video.currentTime = this.deps.safeSeekTime(video, target);
            this.armSeekedFlush(clipId, video);
            vfPipelineMonitor.record('vf_seek_precise', {
              clipId,
              target: Math.round(target * 1000) / 1000,
              deferred: 'true',
            });
            this.registerRVFC(clipId, video);
          }
        }, 120));
      } else {
        if (!isInteractivePreview) {
          scrubSettleState.begin(clipId, time, VideoSyncHtmlSeekCoordinator.SCRUB_SETTLE_TIMEOUT_MS, 'manual-seek');
        }
        this.deps.htmlSeeks.setPendingTarget(clipId, time, ctx.now);
        video.currentTime = this.deps.safeSeekTime(video, time);
        this.armSeekedFlush(clipId, video);
        vfPipelineMonitor.record('vf_seek_precise', {
          clipId,
          target: Math.round(time * 1000) / 1000,
        });
        this.deps.htmlSeeks.clearPreciseSeekTimer(clipId);
      }
      this.deps.htmlSeeks.setLastSeekAt(clipId, ctx.now);

      this.registerRVFC(clipId, video);
    }
  }

  private hasPendingDuplicateSeek(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number
  ): boolean {
    const pendingTarget = this.deps.htmlSeeks.getPendingTarget(clipId);
    if (pendingTarget === undefined || Math.abs(pendingTarget - targetTime) > 0.01) {
      return false;
    }

    return (
      video.seeking ||
      this.deps.htmlSeeks.hasRvfcHandle(clipId) ||
      this.deps.htmlSeeks.hasPreciseSeekTimer(clipId)
    );
  }

  private shouldRetargetPendingSeek(
    clipId: string,
    nextTargetTime: number,
    now: number,
    isDragging: boolean,
    allowInFlightRetarget: boolean,
    displayedDriftSeconds: number = 0
  ): boolean {
    const pendingTarget = this.deps.htmlSeeks.getPendingTarget(clipId);
    if (pendingTarget === undefined) {
      return false;
    }

    const pendingAge = now - (this.deps.htmlSeeks.getPendingStartedAt(clipId) ?? now);
    const targetDrift = Math.abs(pendingTarget - nextTargetTime);
    if (isDragging && !allowInFlightRetarget) {
      if (displayedDriftSeconds >= 1.2) {
        return pendingAge >= 65 && targetDrift >= 0.12;
      }
      if (displayedDriftSeconds >= 0.5) {
        return pendingAge >= 95 && targetDrift >= 0.16;
      }
      return pendingAge >= 170 && targetDrift >= 0.28;
    }

    return pendingAge >= (isDragging ? 90 : 120) && targetDrift >= (isDragging ? 0.12 : 0.2);
  }

  private flushQueuedSeekTarget(
    clipId: string,
    video: HTMLVideoElement,
    source: 'seeked' | 'rvfc'
  ): void {
    const queuedTarget = this.deps.htmlSeeks.getQueuedTarget(clipId);
    if (queuedTarget === undefined) {
      return;
    }

    this.deps.htmlSeeks.clearQueuedTarget(clipId);
    if (Math.abs(video.currentTime - queuedTarget) <= 0.01 && !video.seeking) {
      this.deps.htmlSeeks.clearPendingTarget(clipId);
      return;
    }

    const timelineState = useTimelineStore.getState();
    const isDragging = timelineState.isDraggingPlayhead || timelineState.clipDragPreview != null;
    const fastSeek = getFastSeek(video);
    const supportsFastSeek = fastSeek !== null;
    const presentedTime = renderHostPort.getLastPresentedVideoTime(video);
    const effectiveTime = typeof presentedTime === 'number' ? presentedTime : video.currentTime;
    const targetDrift = Math.abs(effectiveTime - queuedTarget);
    const settle = scrubSettleState.get(clipId);

    if (isDragging && !supportsFastSeek && source === 'rvfc') {
      if (targetDrift <= 0.04) {
        this.deps.htmlSeeks.setLatestTarget(clipId, queuedTarget);
        this.deps.htmlSeeks.setLastSeekAt(clipId, performance.now());
        renderHostPort.requestNewFrameRender();
        return;
      }

      if (
        targetDrift <= VideoSyncHtmlSeekCoordinator.SCRUB_DRAG_RVFC_FOLLOW_THRESHOLD ||
        targetDrift >= VideoSyncHtmlSeekCoordinator.SCRUB_DRAG_RVFC_FORCE_PRECISE_THRESHOLD
      ) {
        this.deps.htmlSeeks.setPendingTarget(clipId, queuedTarget, performance.now());
        video.currentTime = this.deps.safeSeekTime(video, queuedTarget);
        this.armSeekedFlush(clipId, video);
        vfPipelineMonitor.record('vf_seek_precise', {
          clipId,
          target: Math.round(queuedTarget * 1000) / 1000,
          coalesced: source,
          followup:
            targetDrift >= VideoSyncHtmlSeekCoordinator.SCRUB_DRAG_RVFC_FORCE_PRECISE_THRESHOLD
              ? 'drag-rvfc-force'
              : 'drag-rvfc',
        });
        this.registerRVFC(clipId, video);
        renderHostPort.requestNewFrameRender();
        return;
      }

      this.deps.htmlSeeks.setLatestTarget(clipId, queuedTarget);
      this.deps.htmlSeeks.setLastSeekAt(clipId, performance.now());
      vfPipelineMonitor.record('vf_settle_seek', {
        clipId,
        target: Math.round(queuedTarget * 1000) / 1000,
        deferred: 'drag-rvfc',
        driftMs: Math.round(targetDrift * 1000),
      });
      renderHostPort.requestNewFrameRender();
      return;
    }

    if (!isDragging && source === 'rvfc') {
      if (targetDrift <= 0.08) {
        scrubSettleState.resolve(clipId);
        vfPipelineMonitor.record('vf_settle_seek', {
          clipId,
          target: Math.round(queuedTarget * 1000) / 1000,
          satisfied: 'rvfc',
          driftMs: Math.round(targetDrift * 1000),
        });
        renderHostPort.requestNewFrameRender();
        return;
      }

      if (settle?.stage === 'settle' && targetDrift <= 0.35) {
        scrubSettleState.begin(
          clipId,
          queuedTarget,
          VideoSyncHtmlSeekCoordinator.SCRUB_SETTLE_RVFC_DEFER_MS
        );
        vfPipelineMonitor.record('vf_settle_seek', {
          clipId,
          target: Math.round(queuedTarget * 1000) / 1000,
          deferred: 'rvfc',
          driftMs: Math.round(targetDrift * 1000),
        });
        renderHostPort.requestNewFrameRender();
        return;
      }
    }

    this.deps.htmlSeeks.setPendingTarget(clipId, queuedTarget, performance.now());
    if (isDragging && supportsFastSeek) {
      this.deps.htmlSeeks.setLatestTarget(clipId, queuedTarget);
      fastSeek(this.deps.safeSeekTime(video, queuedTarget));
      this.armSeekedFlush(clipId, video);
      vfPipelineMonitor.record('vf_seek_fast', {
        clipId,
        target: Math.round(queuedTarget * 1000) / 1000,
        coalesced: source,
      });

      this.deps.htmlSeeks.replacePreciseSeekTimer(clipId, setTimeout(() => {
        const target = this.deps.htmlSeeks.getLatestTarget(clipId);
        if (target !== undefined && Math.abs(video.currentTime - target) > 0.01) {
          this.deps.htmlSeeks.setPendingTarget(clipId, target, performance.now());
          video.currentTime = this.deps.safeSeekTime(video, target);
          this.armSeekedFlush(clipId, video);
          vfPipelineMonitor.record('vf_seek_precise', {
            clipId,
            target: Math.round(target * 1000) / 1000,
            deferred: 'true',
            coalesced: source,
          });
          this.registerRVFC(clipId, video);
        }
      }, 90));
    } else {
      video.currentTime = this.deps.safeSeekTime(video, queuedTarget);
      this.armSeekedFlush(clipId, video);
      vfPipelineMonitor.record('vf_seek_precise', {
        clipId,
        target: Math.round(queuedTarget * 1000) / 1000,
        coalesced: source,
      });
      this.registerRVFC(clipId, video);
    }

    renderHostPort.requestNewFrameRender();
  }

  private armSeekedFlush(clipId: string, video: HTMLVideoElement): void {
    if (this.deps.htmlSeeks.hasSeekedFlushArmed(clipId)) {
      return;
    }

    this.deps.htmlSeeks.armSeekedFlush(clipId);
    video.addEventListener('seeked', () => {
      this.deps.htmlSeeks.clearSeekedFlush(clipId);
      const presentedTime = video.currentTime;
      renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
      renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId);
      renderHostPort.cacheFrameAtTime(video, presentedTime);
      renderHostPort.requestNewFrameRender();

      const timelineState = useTimelineStore.getState();
      const isDragging = timelineState.isDraggingPlayhead || timelineState.clipDragPreview != null;
      if (isDragging && this.deps.htmlSeeks.getQueuedTarget(clipId) !== undefined) {
        const flush = () => this.flushQueuedSeekTarget(clipId, video, 'seeked');
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(flush);
        } else {
          setTimeout(flush, 16);
        }
        return;
      }

      this.flushQueuedSeekTarget(clipId, video, 'seeked');
    }, { once: true });
  }

  private registerRVFC(clipId: string, video: HTMLVideoElement): void {
    if (hasVideoFrameCallback(video)) {
      const prevHandle = this.deps.htmlSeeks.getRvfcHandle(clipId);
      if (prevHandle !== undefined) {
        video.cancelVideoFrameCallback(prevHandle);
      }
      this.deps.htmlSeeks.setRvfcHandle(clipId, video.requestVideoFrameCallback((_now, metadata) => {
        const metadataTime = metadata?.mediaTime;
        const presentedTime =
          typeof metadataTime === 'number' && Number.isFinite(metadataTime)
            ? metadataTime
            : video.currentTime;
        this.deps.htmlSeeks.deleteRvfcHandle(clipId);
        this.deps.htmlSeeks.clearPendingTarget(clipId);
        renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
        renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId);
        renderHostPort.cacheFrameAtTime(video, presentedTime);
        scrubSettleState.resolve(clipId);
        vfPipelineMonitor.record('vf_seek_done', { clipId });
        this.flushQueuedSeekTarget(clipId, video, 'rvfc');
        renderHostPort.requestNewFrameRender();
      }));
    }
  }
}
