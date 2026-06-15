import type { TimelineClip } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import { useTimelineStore } from '../../stores/timeline';
import { playheadState } from './PlayheadState';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import type { FrameContext } from './types';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import { syncReverseOrNonstandardPlayback } from './videoSyncHtmlReversePlayback';
import { syncHtmlTransitionSourceHold } from './videoSyncHtmlTransitionHold';
import type { VideoSyncHtmlSeekState } from './videoSyncHtmlSeekState';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

type PitchPreservingVideo = HTMLVideoElement & {
  preservesPitch: boolean;
};

type HandoffTrackState = {
  videoElement: HTMLVideoElement;
};

export type VideoSyncHtmlClipCoordinatorDeps = {
  warmups: VideoSyncWarmupState;
  htmlSeeks: VideoSyncHtmlSeekState;
  clipWasPlaying: Set<string>;
  clipWasDragging: Set<string>;
  getHandoffVideoElement: (clipId: string) => HTMLVideoElement | null;
  getHandoffTrackState: (trackId: string) => HandoffTrackState | undefined;
  setHandoff: (clipId: string, video: HTMLVideoElement) => void;
  deleteHandoff: (clipId: string, video: HTMLVideoElement) => void;
  muteLinkedVideoSourceAudio: (ctx: FrameContext, clip: TimelineClip, video: HTMLVideoElement | null | undefined) => void;
  isVideoGpuReady: (video: HTMLVideoElement) => boolean;
  clearWarmupState: (video: HTMLVideoElement) => void;
  maybeRetargetActiveWarmup: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number,
    options?: { isPlaying?: boolean; isDragging?: boolean; requestRender?: boolean }
  ) => void;
  startTargetedWarmup: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean }
  ) => void;
  isForceDecodeInProgress: (clipId: string) => boolean;
  forceColdScrubFrame: (clipId: string, video: HTMLVideoElement) => void;
  forceVideoFrameDecode: (clipId: string, video: HTMLVideoElement) => void;
  beginOrQueueSettleSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ) => void;
  throttledSeek: (clipId: string, video: HTMLVideoElement, time: number, ctx: FrameContext) => void;
  maybeRecoverScrubSettle: (clipId: string, video: HTMLVideoElement, targetTime: number) => void;
  maybeRecoverDraggingPendingSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number
  ) => boolean;
  maybeRecoverDraggingDisplayedDrift: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number
  ) => void;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
};

export class VideoSyncHtmlClipCoordinator {
  private static readonly PAUSED_PRECISE_SEEK_THRESHOLD = 0.015;
  private static readonly PLAYBACK_STOP_SNAP_MAX_DELTA = 0.5;

  private readonly deps: VideoSyncHtmlClipCoordinatorDeps;

  constructor(deps: VideoSyncHtmlClipCoordinatorDeps) {
    this.deps = deps;
  }

  syncHtmlClipVideo(clip: TimelineClip, ctx: FrameContext, clipVideoElement: HTMLVideoElement): void {
    const handoffVideo = this.deps.getHandoffVideoElement(clip.id);
    const settle = scrubSettleState.get(clip.id);
    const useHandoffVideo = !!handoffVideo && (
      ctx.isPlaying ||
      (settle?.reason === 'playback-stop' && scrubSettleState.isPending(clip.id))
    );
    const video = useHandoffVideo ? handoffVideo : clipVideoElement;
    this.deps.warmups.deleteUpcomingPreplay(video);
    this.deps.muteLinkedVideoSourceAudio(ctx, clip, video);
    const timeInfo = getClipTimeInfo(ctx, clip);
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
    const mediaFile = getMediaFileForClip(ctx, clip);

    const useProxy = ctx.proxyEnabled && mediaFile?.proxyFps &&
      !ctx.isPlaying &&
      isInteractivePreview &&
      (mediaFile.proxyStatus === 'ready' || mediaFile.proxyStatus === 'generating');

    if (useProxy) {
      if (!video.paused) video.pause();
      if (!video.muted) video.muted = true;
      scrubSettleState.resolve(clip.id);
      return;
    }

    if (this.deps.warmups.isWarming(video)) {
      if (isInteractivePreview) {
        this.deps.clearWarmupState(video);
      } else {
        this.deps.maybeRetargetActiveWarmup(clip.id, video, timeInfo.clipTime, ctx.now, {
          isPlaying: ctx.isPlaying,
          isDragging: isInteractivePreview,
          requestRender: true,
        });
        return;
      }
    }

    const hasSrc = !!(video.src || video.currentSrc);
    const warmupCooldown = this.deps.warmups.getRetryCooldown(video);
    const cooldownOk = !warmupCooldown || performance.now() - warmupCooldown > 2000;
    if (!isInteractivePreview && !ctx.isPlaying && !video.seeking && hasSrc && cooldownOk &&
        !this.deps.isVideoGpuReady(video) && !this.deps.warmups.isWarming(video)) {
      vfPipelineMonitor.record('vf_gpu_cold', { clipId: clip.id });
      this.deps.startTargetedWarmup(clip.id, video, timeInfo.clipTime, {
        proactive: false,
        requestRender: true,
      });
      return;
    }

    if (isInteractivePreview && hasSrc && cooldownOk &&
        (video.played?.length ?? 0) === 0 &&
        !this.deps.isVideoGpuReady(video) &&
        !this.deps.warmups.isWarming(video) &&
        !this.deps.isForceDecodeInProgress(clip.id)) {
      this.deps.warmups.setRetryCooldown(video, performance.now());
      this.deps.forceColdScrubFrame(clip.id, video);
    }

    const timeDiff = Math.abs(video.currentTime - timeInfo.clipTime);

    if (!video.seeking && video.readyState >= 2) {
      engine.ensureVideoFrameCached(video, clip.id);
    }

    if (ctx.isPlaying || isInteractivePreview) {
      scrubSettleState.resolve(clip.id);
    }

    const isReversePlayback = clip.reversed || ctx.playbackSpeed < 0 || timeInfo.speed < 0;
    const clipAbsSpeed = timeInfo.absSpeed;
    const needsClipSpeedAdjust = clipAbsSpeed > 0.01 && Math.abs(clipAbsSpeed - 1) > 0.01;
    const hasSpeedKeyframes = ctx.hasKeyframes(clip.id, 'speed');

    if (clip.transitionSourceHold === true) {
      syncHtmlTransitionSourceHold({
        clip,
        video,
        clipTime: timeInfo.clipTime,
        timeDiff,
        isInteractivePreview,
        deps: this.deps,
      });
      return;
    }

    if (isReversePlayback) {
      syncReverseOrNonstandardPlayback({
        clip,
        ctx,
        video,
        clipTime: timeInfo.clipTime,
        timeDiff,
        isInteractivePreview,
        seekThreshold: isInteractivePreview ? 0.04 : 0.02,
        deps: this.deps,
      });
      return;
    }

    if (ctx.playbackSpeed !== 1) {
      syncReverseOrNonstandardPlayback({
        clip,
        ctx,
        video,
        clipTime: timeInfo.clipTime,
        timeDiff,
        isInteractivePreview,
        seekThreshold: isInteractivePreview ? 0.04 : 0.03,
        clearPlayingState: true,
        deps: this.deps,
      });
      return;
    }

    this.syncNormalForwardPlayback({
      clip,
      ctx,
      video,
      clipVideoElement,
      timeInfo,
      timeDiff,
      needsClipSpeedAdjust,
      hasSpeedKeyframes,
      clipAbsSpeed,
      isInteractivePreview,
      handoffVideo,
    });
  }

  private syncNormalForwardPlayback(params: {
    clip: TimelineClip;
    ctx: FrameContext;
    video: HTMLVideoElement;
    clipVideoElement: HTMLVideoElement;
    timeInfo: ReturnType<typeof getClipTimeInfo>;
    timeDiff: number;
    needsClipSpeedAdjust: boolean;
    hasSpeedKeyframes: boolean;
    clipAbsSpeed: number;
    isInteractivePreview: boolean;
    handoffVideo: HTMLVideoElement | null;
  }): void {
    const {
      clip,
      ctx,
      video,
      clipVideoElement,
      timeInfo,
      timeDiff,
      needsClipSpeedAdjust,
      hasSpeedKeyframes,
      clipAbsSpeed,
      isInteractivePreview,
      handoffVideo,
    } = params;

    if (needsClipSpeedAdjust || hasSpeedKeyframes) {
      const targetRate = Math.max(0.0625, Math.min(16, clipAbsSpeed));
      if (Math.abs(video.playbackRate - targetRate) > 0.01) {
        video.playbackRate = targetRate;
      }
      const shouldPreservePitch = clip.preservesPitch !== false;
      const pitchVideo = video as PitchPreservingVideo;
      if (pitchVideo.preservesPitch !== shouldPreservePitch) {
        pitchVideo.preservesPitch = shouldPreservePitch;
      }
    } else if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }

    if (ctx.isPlaying) {
      this.syncNormalForwardPlaying(clip, video, timeInfo.clipTime, timeDiff, hasSpeedKeyframes);
      return;
    }

    this.syncNormalForwardPaused({
      clip,
      ctx,
      video,
      clipVideoElement,
      timeInfo,
      timeDiff,
      isInteractivePreview,
      handoffVideo,
    });
  }

  private syncNormalForwardPlaying(
    clip: TimelineClip,
    video: HTMLVideoElement,
    clipTime: number,
    timeDiff: number,
    hasSpeedKeyframes: boolean
  ): void {
    this.deps.clipWasPlaying.add(clip.id);
    if (video.paused) {
      if (timeDiff > 0.05) {
        video.currentTime = this.deps.safeSeekTime(video, clipTime);
      }
      video.play().catch(() => {});
      vfPipelineMonitor.record('vf_play', { clipId: clip.id });
    }
    const driftThreshold = hasSpeedKeyframes ? 1.5 : 0.3;
    if (timeDiff > driftThreshold) {
      vfPipelineMonitor.record('vf_drift', {
        clipId: clip.id,
        driftMs: Math.round(timeDiff * 1000),
        target: Math.round(clipTime * 1000) / 1000,
      });
      video.currentTime = this.deps.safeSeekTime(video, clipTime);
    }
  }

  private syncNormalForwardPaused(params: {
    clip: TimelineClip;
    ctx: FrameContext;
    video: HTMLVideoElement;
    clipVideoElement: HTMLVideoElement;
    timeInfo: ReturnType<typeof getClipTimeInfo>;
    timeDiff: number;
    isInteractivePreview: boolean;
    handoffVideo: HTMLVideoElement | null;
  }): void {
    const { clip, ctx, video, clipVideoElement, timeInfo, timeDiff, isInteractivePreview } = params;
    const justStopped = this.deps.clipWasPlaying.has(clip.id);
    if (justStopped) {
      this.deps.clipWasPlaying.delete(clip.id);
      scrubSettleState.resolve(clip.id);
      const prevTrack = clip.trackId ? this.deps.getHandoffTrackState(clip.trackId) : undefined;
      const actualVideo = (prevTrack && prevTrack.videoElement !== video)
        ? prevTrack.videoElement : video;
      if (!actualVideo.paused) {
        actualVideo.pause();
        vfPipelineMonitor.record('vf_pause', { clipId: clip.id });
      }
      const pauseTargetTime = actualVideo.currentTime;
      engine.markVideoFramePresented(actualVideo, pauseTargetTime, clip.id);
      if (!engine.captureVideoFrameAtTime(actualVideo, pauseTargetTime, clip.id)) {
        engine.ensureVideoFrameCached(actualVideo, clip.id);
      }
      const effectiveSpeed = timeInfo.absSpeed > 0.01 ? timeInfo.absSpeed : 1;
      const videoClipTime = pauseTargetTime;
      const newPlayheadPos = clip.reversed
        ? clip.startTime + (clip.outPoint - videoClipTime) / effectiveSpeed
        : clip.startTime + (videoClipTime - clip.inPoint) / effectiveSpeed;
      const currentPlayhead = playheadState.isUsingInternalPosition
        ? playheadState.position
        : ctx.playheadPosition;
      const videoAdvanced = Math.abs(newPlayheadPos - currentPlayhead) > 0.01;
      const shouldSnapPlayheadToStopFrame =
        Math.abs(newPlayheadPos - currentPlayhead) <= VideoSyncHtmlClipCoordinator.PLAYBACK_STOP_SNAP_MAX_DELTA;
      if (videoAdvanced && shouldSnapPlayheadToStopFrame) {
        playheadState.position = newPlayheadPos;
        useTimelineStore.setState({ playheadPosition: newPlayheadPos });
      }
      const handoffReleased = clipVideoElement !== actualVideo;
      if (handoffReleased) {
        this.deps.setHandoff(clip.id, actualVideo);
        const ownVideoTimeDiff = Math.abs(clipVideoElement.currentTime - pauseTargetTime);
        if (ownVideoTimeDiff > 0.001 || clipVideoElement.readyState < 2) {
          this.deps.beginOrQueueSettleSeek(
            clip.id,
            clipVideoElement,
            pauseTargetTime,
            { handoffRelease: 'true' },
            'playback-stop'
          );
        } else {
          engine.markVideoFramePresented(clipVideoElement, pauseTargetTime, clip.id);
          if (!engine.captureVideoFrameAtTime(clipVideoElement, pauseTargetTime, clip.id)) {
            engine.ensureVideoFrameCached(clipVideoElement, clip.id);
          }
          scrubSettleState.resolve(clip.id);
          this.deps.deleteHandoff(clip.id, actualVideo);
        }
        engine.requestNewFrameRender();
        return;
      }
      engine.requestNewFrameRender();
      return;
    }

    if (!video.paused) {
      video.pause();
    }

    const justStoppedDragging = this.deps.clipWasDragging.has(clip.id) && !isInteractivePreview;
    if (justStoppedDragging) {
      this.deps.clipWasDragging.delete(clip.id);
      this.deps.htmlSeeks.clearPreciseSeekTimer(clip.id);
      if (timeDiff > 0.001) {
        this.deps.beginOrQueueSettleSeek(clip.id, video, timeInfo.clipTime, undefined, 'scrub-stop');
      } else {
        scrubSettleState.resolve(clip.id);
      }
      video.addEventListener('seeked', () => {
        engine.requestNewFrameRender();
      }, { once: true });
    } else {
      const seekThreshold = isInteractivePreview
        ? 0.04
        : VideoSyncHtmlClipCoordinator.PAUSED_PRECISE_SEEK_THRESHOLD;
      if (timeDiff > seekThreshold) {
        this.deps.throttledSeek(clip.id, video, timeInfo.clipTime, ctx);
      } else {
        const recoveredPendingSeek = this.deps.maybeRecoverDraggingPendingSeek(
          clip.id,
          video,
          timeInfo.clipTime,
          ctx.now
        );
        if (recoveredPendingSeek) {
          this.deps.htmlSeeks.setLastSeekAt(clip.id, ctx.now);
        } else if (isInteractivePreview) {
          this.deps.maybeRecoverDraggingDisplayedDrift(
            clip.id,
            video,
            timeInfo.clipTime,
            ctx.now
          );
        }
      }
    }

    if (isInteractivePreview) {
      this.deps.clipWasDragging.add(clip.id);
    }

    if (video.readyState < 2 && !video.seeking) {
      vfPipelineMonitor.record('vf_readystate_drop', {
        clipId: clip.id,
        readyState: video.readyState,
      });
      this.deps.forceVideoFrameDecode(clip.id, video);
    }
    if (!isInteractivePreview) {
      this.deps.maybeRecoverScrubSettle(clip.id, video, timeInfo.clipTime);
    }
  }
}
