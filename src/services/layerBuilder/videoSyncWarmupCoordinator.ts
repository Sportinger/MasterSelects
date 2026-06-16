import type { TimelineClip } from '../../types';
import { flags } from '../../engine/featureFlags';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import type { FrameContext } from './types';
import {
  getClipSampleTimeNearPlayhead,
  getClipStartTime,
  getWarmupClipTime,
  isVisibleVideoTrackClip,
} from './videoSyncTimelineQueries';
import {
  getVisibleVideoTrackPlaybackClipsAtTime,
  getVisibleVideoTrackTransitionClipsInWindow,
} from './videoSyncTransitionQueries';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
};

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

export type VideoSyncWarmupCoordinatorDeps = {
  warmups: VideoSyncWarmupState;
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  getClipRuntimeProvider: (clip: TimelineClip) => unknown;
  getHandoffVideoElement: (clipId: string) => HTMLVideoElement | null;
  isVideoGpuReady: (video: HTMLVideoElement) => boolean;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
  clearHtmlSeekState: (clipId: string, video?: HTMLVideoElement) => void;
  prewarmUpcomingWebCodecsClip: (ctx: FrameContext, clip: TimelineClip, clipTime: number) => void;
  usesFullWebCodecsPreview: (clip: TimelineClip) => boolean;
  startTargetedWarmup: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean }
  ) => void;
  clearWarmupState: (video: HTMLVideoElement) => void;
};

export class VideoSyncWarmupCoordinator {
  private static readonly PAUSED_JUMP_PRELOAD_THRESHOLD_SECONDS = 0.35;
  private static readonly PAUSED_JUMP_PRELOAD_LOOKBEHIND = 0.35;
  private static readonly PAUSED_JUMP_PRELOAD_LOOKAHEAD = 1.5;
  private static readonly PAUSED_JUMP_PRELOAD_MAX_CLIPS = 3;
  private static readonly PAUSED_JUMP_PRELOAD_ACTIVE_TARGET_EPSILON = 0.05;
  private static readonly LOOKAHEAD_TIME = 1.5;
  private static readonly SCRUB_WARMUP_LOOKAHEAD = 0.9;
  private static readonly SCRUB_WARMUP_LOOKBEHIND = 0.25;
  private static readonly WARMUP_WATCHDOG_MS = 900;
  private static readonly WARMUP_TIMEOUT_TARGET_EPSILON = 0.18;
  private static readonly WARMUP_RETARGET_THRESHOLD_SECONDS = 0.2;
  private static readonly WARMUP_RETARGET_COOLDOWN_MS = 120;
  private static readonly UPCOMING_PREPLAY_LOOKAHEAD_SECONDS = 0.25;

  private readonly deps: VideoSyncWarmupCoordinatorDeps;
  private lastWarmupRetargetAt: Record<string, number> = {};
  private lastPausedJumpPreloadPosition = Number.NaN;
  private lastPausedJumpPreloadActiveKey = '';

  constructor(deps: VideoSyncWarmupCoordinatorDeps) {
    this.deps = deps;
  }

  reset(): void {
    this.lastWarmupRetargetAt = {};
    this.lastPausedJumpPreloadPosition = Number.NaN;
    this.lastPausedJumpPreloadActiveKey = '';
  }

  resetPausedJumpPreload(): void {
    this.lastPausedJumpPreloadPosition = Number.NaN;
    this.lastPausedJumpPreloadActiveKey = '';
  }

  clearClipRetargetState(clipId: string): void {
    delete this.lastWarmupRetargetAt[clipId];
  }

  positionWarmedUpcomingVideo(
    ctx: FrameContext,
    clip: TimelineClip,
    video: HTMLVideoElement,
    targetTime: number
  ): void {
    if (this.isVideoElementActiveAtPlayhead(ctx, video)) return;
    if (!video.paused || video.seeking) return;

    const safeTargetTime = this.deps.safeSeekTime(video, targetTime);
    if (video.preload !== 'auto') {
      video.preload = 'auto';
    }

    const drift = Math.abs(video.currentTime - safeTargetTime);
    if (drift > 0.08) {
      try {
        video.currentTime = safeTargetTime;
        vfPipelineMonitor.record('vf_settle_seek', {
          clipId: clip.id,
          target: Math.round(safeTargetTime * 1000) / 1000,
          recovery: 'warmup-preseek',
          driftMs: Math.round(drift * 1000),
        });
      } catch {
        return;
      }
    }

    if (video.readyState >= 2 && !video.seeking) {
      renderHostPort.ensureVideoFrameCached(video, clip.id);
      renderHostPort.cacheFrameAtTime(video, safeTargetTime);
    }
  }

  pruneUpcomingPreplays(ctx: FrameContext, isInteractivePreview: boolean): void {
    for (const [video, state] of this.deps.warmups.listUpcomingPreplays()) {
      const clip = ctx.clips.find((candidate) => candidate.id === state.clipId);
      const lead = clip ? clip.startTime - ctx.playheadPosition : Number.POSITIVE_INFINITY;
      const isActive = !!clip &&
        clip.startTime <= ctx.playheadPosition &&
        clip.startTime + clip.duration > ctx.playheadPosition;
      const shouldKeep =
        ctx.isPlaying &&
        !isInteractivePreview &&
        !!clip &&
        isVisibleVideoTrackClip(ctx, clip) &&
        (isActive || (lead > 0 && lead <= VideoSyncWarmupCoordinator.UPCOMING_PREPLAY_LOOKAHEAD_SECONDS + 0.05));

      if (!shouldKeep) {
        if (!video.paused) {
          video.pause();
        }
        this.deps.warmups.deleteUpcomingPreplay(video);
      } else if (isActive) {
        this.deps.warmups.deleteUpcomingPreplay(video);
      }
    }
  }

  maybeStartUpcomingPreplay(
    ctx: FrameContext,
    clip: TimelineClip,
    video: HTMLVideoElement,
    clipStartSourceTime: number
  ): void {
    if (!ctx.isPlaying || ctx.isDraggingPlayhead || ctx.hasClipDragPreview) return;
    if (ctx.playbackSpeed !== 1 || clip.reversed || ctx.hasKeyframes(clip.id, 'speed')) return;
    if (this.deps.warmups.hasUpcomingPreplay(video)) return;
    if (this.deps.warmups.isWarming(video) || video.seeking || !video.paused) return;
    if (!this.deps.isVideoGpuReady(video) || video.readyState < 2) return;
    if (this.isVideoElementActiveAtPlayhead(ctx, video)) return;

    const leadSeconds = clip.startTime - ctx.playheadPosition;
    if (leadSeconds <= 0 || leadSeconds > VideoSyncWarmupCoordinator.UPCOMING_PREPLAY_LOOKAHEAD_SECONDS) {
      return;
    }

    const initialSpeed = Math.abs(ctx.getInterpolatedSpeed(clip.id, 0) || 1);
    if (!Number.isFinite(initialSpeed) || initialSpeed <= 0 || Math.abs(initialSpeed - 1) > 0.01) {
      return;
    }

    const preplayTime = clipStartSourceTime - leadSeconds;
    const clipFloor = (clip.inPoint ?? 0) + 0.01;
    if (preplayTime < clipFloor) {
      return;
    }

    const safePreplayTime = this.deps.safeSeekTime(video, preplayTime);
    if (Math.abs(video.currentTime - safePreplayTime) > 0.035) {
      try {
        video.currentTime = safePreplayTime;
      } catch {
        return;
      }
    }

    video.muted = true;
    this.deps.warmups.setUpcomingPreplay(video, { clipId: clip.id, startTime: clip.startTime });
    video.play()
      .then(() => {
        vfPipelineMonitor.record('vf_play', {
          clipId: clip.id,
          preplay: 'true',
          leadMs: Math.round(leadSeconds * 1000),
        });
      })
      .catch(() => {
        this.deps.warmups.deleteUpcomingPreplay(video);
      });
  }

  preloadPausedJumpNeighborhood(ctx: FrameContext): void {
    if (ctx.isPlaying || ctx.isDraggingPlayhead) {
      return;
    }

    const activeClipKey = ctx.clipsAtTime
      .map((clip) => clip.id)
      .sort()
      .join('|');
    const movedFar =
      !Number.isFinite(this.lastPausedJumpPreloadPosition) ||
      Math.abs(ctx.playheadPosition - this.lastPausedJumpPreloadPosition) >=
        VideoSyncWarmupCoordinator.PAUSED_JUMP_PRELOAD_THRESHOLD_SECONDS;
    const activeChanged = activeClipKey !== this.lastPausedJumpPreloadActiveKey;

    if (!movedFar && !activeChanged) {
      return;
    }

    this.lastPausedJumpPreloadPosition = ctx.playheadPosition;
    this.lastPausedJumpPreloadActiveKey = activeClipKey;

    const activeClipIds = new Set(ctx.clipsAtTime.map((clip) => clip.id));
    const windowStart = Math.max(
      0,
      ctx.playheadPosition - VideoSyncWarmupCoordinator.PAUSED_JUMP_PRELOAD_LOOKBEHIND
    );
    const windowEnd = ctx.playheadPosition + VideoSyncWarmupCoordinator.PAUSED_JUMP_PRELOAD_LOOKAHEAD;

    const candidateClips = ctx.clips
      .filter((clip) => {
        if (!this.deps.getClipHtmlVideoElement(clip) && !this.deps.getClipRuntimeProvider(clip)) {
          return false;
        }
        if (activeClipIds.has(clip.id)) {
          return true;
        }
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;
        return clipEnd > windowStart && clipStart < windowEnd;
      })
      .sort((a, b) => {
        const aActive = activeClipIds.has(a.id) ? 0 : 1;
        const bActive = activeClipIds.has(b.id) ? 0 : 1;
        if (aActive !== bActive) {
          return aActive - bActive;
        }
        const aDistance = Math.abs(
          Math.max(a.startTime - ctx.playheadPosition, ctx.playheadPosition - (a.startTime + a.duration), 0)
        );
        const bDistance = Math.abs(
          Math.max(b.startTime - ctx.playheadPosition, ctx.playheadPosition - (b.startTime + b.duration), 0)
        );
        return aDistance - bDistance;
      })
      .slice(0, VideoSyncWarmupCoordinator.PAUSED_JUMP_PRELOAD_MAX_CLIPS);

    for (const clip of candidateClips) {
      const targetTime = activeClipIds.has(clip.id)
        ? getClipSampleTimeNearPlayhead(ctx, clip)
        : getWarmupClipTime({ ...ctx, isDraggingPlayhead: true }, clip);

      if (flags.useFullWebCodecsPlayback) {
        this.deps.prewarmUpcomingWebCodecsClip(ctx, clip, targetTime);
      }

      if (this.deps.usesFullWebCodecsPreview(clip)) {
        continue;
      }

      const video = this.deps.getClipHtmlVideoElement(clip);
      if (!video) {
        continue;
      }

      if (!video.src && !video.currentSrc) {
        continue;
      }

      if (video.preload !== 'auto') {
        video.preload = 'auto';
      }

      const isActive = activeClipIds.has(clip.id);
      const targetDrift = Math.abs(video.currentTime - targetTime);
      const shouldWarmTargetFrame =
        isActive &&
        (targetDrift > VideoSyncWarmupCoordinator.PAUSED_JUMP_PRELOAD_ACTIVE_TARGET_EPSILON ||
          video.readyState < 2 ||
          video.seeking);

      if (
        !this.deps.warmups.isWarming(video) &&
        (shouldWarmTargetFrame || !this.deps.isVideoGpuReady(video))
      ) {
        this.deps.startTargetedWarmup(clip.id, video, targetTime, {
          proactive: true,
          requestRender: isActive,
        });
        continue;
      }

      if (isActive && !video.seeking && video.readyState >= 2) {
        renderHostPort.markVideoFramePresented(video, targetTime, clip.id);
        if (!renderHostPort.captureVideoFrameAtTime(video, targetTime, clip.id)) {
          renderHostPort.ensureVideoFrameCached(video, clip.id);
        }
        renderHostPort.cacheFrameAtTime(video, targetTime);
      }
    }
  }

  maybeRetargetActiveWarmup(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number,
    options?: { isPlaying?: boolean; isDragging?: boolean; requestRender?: boolean }
  ): void {
    const warmupClipId = this.deps.warmups.getClipId(video);
    const warmupTargetTime = this.deps.warmups.getTargetTime(video);
    if (
      warmupClipId !== clipId ||
      typeof warmupTargetTime !== 'number' ||
      !Number.isFinite(warmupTargetTime)
    ) {
      return;
    }

    const isDragging = options?.isDragging === true;
    const isPlaying = options?.isPlaying === true;
    if (isPlaying && !isDragging) {
      return;
    }

    const targetDrift = Math.abs(warmupTargetTime - targetTime);
    if (targetDrift < VideoSyncWarmupCoordinator.WARMUP_RETARGET_THRESHOLD_SECONDS) {
      return;
    }

    const lastRetargetAt = this.lastWarmupRetargetAt[clipId] ?? 0;
    if (now - lastRetargetAt < VideoSyncWarmupCoordinator.WARMUP_RETARGET_COOLDOWN_MS) {
      return;
    }

    this.lastWarmupRetargetAt[clipId] = now;
    vfPipelineMonitor.record('vf_settle_seek', {
      clipId,
      target: Math.round(targetTime * 1000) / 1000,
      recovery: 'warmup-retarget',
      driftMs: Math.round(targetDrift * 1000),
    });
    this.deps.clearWarmupState(video);
    this.deps.startTargetedWarmup(clipId, video, targetTime, {
      proactive: false,
      requestRender: options?.requestRender !== false,
      resumeAfterWarmup: isPlaying,
    });
  }

  startTargetedWarmup(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean }
  ): void {
    const safeTargetTime = this.deps.safeSeekTime(video, targetTime);
    const proactive = options?.proactive === true;
    const shouldRequestRender = options?.requestRender !== false;
    const resumeAfterWarmup = options?.resumeAfterWarmup === true;

    this.deps.warmups.clearWatchdog(video);
    this.deps.clearHtmlSeekState(clipId, video);
    const attemptId = this.deps.warmups.beginAttempt(video, clipId, safeTargetTime);
    video.muted = true;

    if (video.preload !== 'auto') {
      video.preload = 'auto';
    }

    try {
      if (Math.abs(video.currentTime - safeTargetTime) > 0.01) {
        video.currentTime = safeTargetTime;
      }
    } catch {
      // Ignore if metadata is not fully ready for seeking yet.
    }

    const abortWarmup = (reason: 'timeout' | 'play-failed'): void => {
      if (!this.deps.warmups.isAttemptCurrent(video, attemptId)) {
        return;
      }

      this.deps.warmups.clearWatchdog(video);
      this.deps.warmups.clearActiveWarmup(video);
      this.deps.warmups.setRetryCooldown(video, performance.now());
      delete this.lastWarmupRetargetAt[clipId];
      if (!resumeAfterWarmup) {
        video.pause?.();
      }
      vfPipelineMonitor.record('vf_settle_seek', {
        clipId,
        target: Math.round(safeTargetTime * 1000) / 1000,
        recovery: `warmup-${reason}`,
      });
      if (shouldRequestRender) {
        renderHostPort.requestRender();
      }
    };

    const finishWarmup = (fallback = false) => {
      if (!this.deps.warmups.isAttemptCurrent(video, attemptId)) {
        return;
      }

      this.deps.warmups.clearWatchdog(video);
      const presentedTime = video.currentTime;
      renderHostPort.markVideoFramePresented(video, presentedTime, clipId);
      if (!renderHostPort.captureVideoFrameAtTime(video, presentedTime, clipId)) {
        renderHostPort.ensureVideoFrameCached(video, clipId);
      }
      renderHostPort.cacheFrameAtTime(video, safeTargetTime);
      renderHostPort.markVideoGpuReady(video);
      scrubSettleState.resolve(clipId);
      this.deps.warmups.completeAttempt(video);
      delete this.lastWarmupRetargetAt[clipId];
      vfPipelineMonitor.record('vf_gpu_ready', {
        clipId,
        ...(proactive ? { proactive: 'true' } : {}),
        ...(fallback ? { fallback: 'true' } : {}),
      });
      if (resumeAfterWarmup) {
        video.play().catch(() => {});
      } else {
        video.pause?.();
      }
      if (shouldRequestRender) {
        renderHostPort.requestRender();
      }
    };

    this.deps.warmups.setWatchdog(video, setTimeout(() => {
      const closeToTarget =
        Math.abs(video.currentTime - safeTargetTime) <= VideoSyncWarmupCoordinator.WARMUP_TIMEOUT_TARGET_EPSILON;
      if (video.readyState >= 2 && closeToTarget) {
        finishWarmup(true);
        return;
      }
      abortWarmup('timeout');
    }, VideoSyncWarmupCoordinator.WARMUP_WATCHDOG_MS));

    video.play().then(() => {
      if (!this.deps.warmups.isAttemptCurrent(video, attemptId)) {
        return;
      }
      if (hasVideoFrameCallback(video)) {
        video.requestVideoFrameCallback(() => {
          finishWarmup(false);
        });
      } else {
        setTimeout(() => {
          finishWarmup(true);
        }, 100);
      }
    }).catch(() => {
      abortWarmup('play-failed');
    });
  }

  clearWarmupState(video: HTMLVideoElement): void {
    const clipId = this.deps.warmups.getClipId(video);
    if (clipId) {
      this.deps.clearHtmlSeekState(clipId, video);
      delete this.lastWarmupRetargetAt[clipId];
    }
    this.deps.warmups.clearWatchdog(video);
    this.deps.warmups.clearActiveWarmup(video);
    this.deps.warmups.setRetryCooldown(video, performance.now());
    video.pause?.();
  }

  warmupUpcomingClips(ctx: FrameContext): void {
    const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
    const windowStart = isInteractivePreview
      ? Math.max(0, ctx.playheadPosition - VideoSyncWarmupCoordinator.SCRUB_WARMUP_LOOKBEHIND)
      : ctx.playheadPosition;
    const windowEnd = ctx.playheadPosition + (
      isInteractivePreview
        ? VideoSyncWarmupCoordinator.SCRUB_WARMUP_LOOKAHEAD
        : VideoSyncWarmupCoordinator.LOOKAHEAD_TIME
    );

    for (const clip of ctx.clips) {
      if (!isVisibleVideoTrackClip(ctx, clip)) continue;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      const clipTime = isInteractivePreview
        ? getClipSampleTimeNearPlayhead(ctx, clip)
        : getWarmupClipTime(ctx, clip);
      const isCurrentlyActive = clipStart <= ctx.playheadPosition && clipEnd > ctx.playheadPosition;

      if (isInteractivePreview) {
        if (isCurrentlyActive || clipEnd <= windowStart || clipStart > windowEnd) continue;
      } else {
        if (clipStart <= ctx.playheadPosition || clipStart > windowEnd) continue;
      }

      if (flags.useFullWebCodecsPlayback) {
        this.deps.prewarmUpcomingWebCodecsClip(ctx, clip, clipTime);
      }

      if (this.deps.usesFullWebCodecsPreview(clip)) {
        continue;
      }

      const video = this.deps.getClipHtmlVideoElement(clip);
      if (!video) continue;

      if (this.deps.isVideoGpuReady(video)) {
        this.positionWarmedUpcomingVideo(ctx, clip, video, clipTime);
        this.maybeStartUpcomingPreplay(ctx, clip, video, clipTime);
        continue;
      }
      if (this.deps.warmups.isWarming(video)) continue;

      if (!video.src && !video.currentSrc) continue;

      const warmupCooldown = this.deps.warmups.getRetryCooldown(video);
      if (warmupCooldown && performance.now() - warmupCooldown < 2000) continue;

      this.deps.startTargetedWarmup(clip.id, video, clipTime, {
        proactive: true,
        requestRender: false,
      });
    }

    for (const clip of getVisibleVideoTrackTransitionClipsInWindow(ctx, windowStart, windowEnd)) {
      const video = this.deps.getClipHtmlVideoElement(clip);
      if (flags.useFullWebCodecsPlayback) {
        const transitionTime = getClipSampleTimeNearPlayhead({ ...ctx, isDraggingPlayhead: true }, clip);
        this.deps.prewarmUpcomingWebCodecsClip(ctx, clip, transitionTime);
      }

      if (!video || this.deps.usesFullWebCodecsPreview(clip)) continue;
      if (this.deps.warmups.isWarming(video)) continue;
      if (!video.src && !video.currentSrc) continue;

      const targetTime = getClipSampleTimeNearPlayhead({ ...ctx, isDraggingPlayhead: true }, clip);
      if (this.deps.isVideoGpuReady(video)) {
        this.positionWarmedUpcomingVideo(ctx, clip, video, targetTime);
        continue;
      }

      const warmupCooldown = this.deps.warmups.getRetryCooldown(video);
      if (warmupCooldown && performance.now() - warmupCooldown < 2000) continue;

      this.deps.startTargetedWarmup(clip.id, video, targetTime, {
        proactive: true,
        requestRender: false,
      });
    }
  }

  preBufferUpcomingVideoAudio(ctx: FrameContext): void {
    if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

    const lookaheadEnd = ctx.playheadPosition + VideoSyncWarmupCoordinator.LOOKAHEAD_TIME;

    for (const clip of ctx.clips) {
      if (!isVisibleVideoTrackClip(ctx, clip)) continue;

      const video = this.deps.getClipHtmlVideoElement(clip);
      if (!video) continue;
      const clipStart = clip.startTime;
      const targetTime = getClipStartTime(ctx, clip);

      if (clipStart <= ctx.playheadPosition || clipStart > lookaheadEnd) continue;

      if (this.deps.warmups.isWarming(video)) continue;
      if (this.isVideoElementActiveAtPlayhead(ctx, video)) continue;

      if (video.preload !== 'auto') {
        video.preload = 'auto';
      }

      if (Math.abs(video.currentTime - targetTime) > 0.5) {
        video.currentTime = this.deps.safeSeekTime(video, targetTime);
      }
    }
  }

  preBufferUpcomingNestedCompVideos(ctx: FrameContext): void {
    if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

    const lookaheadEnd = ctx.playheadPosition + VideoSyncWarmupCoordinator.LOOKAHEAD_TIME;

    for (const compClip of ctx.clips) {
      if (!isVisibleVideoTrackClip(ctx, compClip)) continue;

      const clipStart = compClip.startTime;
      if (
        !compClip.isComposition ||
        !compClip.nestedClips ||
        compClip.nestedClips.length === 0 ||
        clipStart <= ctx.playheadPosition ||
        clipStart > lookaheadEnd
      ) {
        continue;
      }

      const compStartTime = compClip.inPoint;
      for (const nestedClip of compClip.nestedClips) {
        const video = this.deps.getClipHtmlVideoElement(nestedClip);
        if (!video) continue;

        const nestedClipEnd = nestedClip.startTime + nestedClip.duration;
        if (compStartTime < nestedClip.startTime || compStartTime >= nestedClipEnd) {
          continue;
        }

        const nestedLocalTime = compStartTime - nestedClip.startTime;
        const targetTime = nestedClip.reversed
          ? nestedClip.outPoint - nestedLocalTime
          : nestedLocalTime + nestedClip.inPoint;

        if (this.deps.warmups.isWarming(video) || video.seeking) {
          continue;
        }

        if (video.preload !== 'auto') {
          video.preload = 'auto';
        }

        if (Math.abs(video.currentTime - targetTime) > 0.1) {
          video.currentTime = this.deps.safeSeekTime(video, targetTime);
        }
      }
    }
  }

  private isVideoElementActiveAtPlayhead(ctx: FrameContext, video: HTMLVideoElement): boolean {
    return getVisibleVideoTrackPlaybackClipsAtTime(ctx).some((activeClip) =>
      this.deps.getClipHtmlVideoElement(activeClip) === video ||
      this.deps.getHandoffVideoElement(activeClip.id) === video
    );
  }
}
