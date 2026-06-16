import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import type { VideoSyncHtmlSeekState } from './videoSyncHtmlSeekState';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

export type VideoSyncRecoveryCoordinatorDeps = {
  warmups: VideoSyncWarmupState;
  htmlSeeks: VideoSyncHtmlSeekState;
  beginOrQueueSettleSeek: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    detail?: Record<string, string>,
    reason?: 'manual-seek' | 'scrub-stop' | 'playback-stop'
  ) => void;
  startTargetedWarmup: (
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    options?: { proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean }
  ) => void;
  recoverClipPlaybackState: (clipId: string, video: HTMLVideoElement, targetTime: number) => void;
};

export class VideoSyncRecoveryCoordinator {
  private static readonly SCRUB_SETTLE_TIMEOUT_MS = 220;
  private static readonly SCRUB_SETTLE_WARMUP_MS = 350;
  private static readonly SCRUB_DRAG_DISPLAYED_DRIFT_RECOVERY_THRESHOLD = 0.9;
  private static readonly SCRUB_DRAG_DISPLAYED_DRIFT_TARGET_EPSILON = 0.08;
  private static readonly SCRUB_DRAG_DISPLAYED_DRIFT_RECOVERY_COOLDOWN_MS = 180;
  private static readonly SCRUB_DRAG_PENDING_SEEK_RECOVERY_THRESHOLD_MS = 180;
  private static readonly SCRUB_DRAG_PENDING_SEEK_TARGET_DRIFT_THRESHOLD = 0.45;
  private static readonly SCRUB_DRAG_PENDING_SEEK_RECOVERY_COOLDOWN_MS = 260;

  private readonly deps: VideoSyncRecoveryCoordinatorDeps;
  private lastDisplayedDriftRecoveryAt: Record<string, number> = {};
  private lastPendingSeekRecoveryAt: Record<string, number> = {};

  constructor(deps: VideoSyncRecoveryCoordinatorDeps) {
    this.deps = deps;
  }

  reset(): void {
    this.lastDisplayedDriftRecoveryAt = {};
    this.lastPendingSeekRecoveryAt = {};
  }

  clearClip(clipId: string): void {
    delete this.lastDisplayedDriftRecoveryAt[clipId];
    delete this.lastPendingSeekRecoveryAt[clipId];
  }

  maybeRecoverScrubSettle(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number
  ): void {
    const settle = scrubSettleState.get(clipId);
    if (!settle) {
      return;
    }

    if (Math.abs(settle.targetTime - targetTime) > 0.05) {
      scrubSettleState.begin(clipId, targetTime, VideoSyncRecoveryCoordinator.SCRUB_SETTLE_TIMEOUT_MS);
      return;
    }

    const lastPresentedTime = renderHostPort.getLastPresentedVideoTime(video);
    if (typeof lastPresentedTime === 'number' && Math.abs(lastPresentedTime - targetTime) <= 0.12) {
      scrubSettleState.resolve(clipId);
      return;
    }

    if (video.seeking || !scrubSettleState.isDue(clipId)) {
      return;
    }

    if (settle.stage === 'settle') {
      this.deps.beginOrQueueSettleSeek(clipId, video, targetTime, { retry: 'true' });
      renderHostPort.requestNewFrameRender();
      scrubSettleState.markRetry(clipId, targetTime, VideoSyncRecoveryCoordinator.SCRUB_SETTLE_TIMEOUT_MS);
      return;
    }

    if (settle.stage === 'retry') {
      vfPipelineMonitor.record('vf_settle_seek', {
        clipId,
        target: Math.round(targetTime * 1000) / 1000,
        recovery: 'warmup',
      });
      this.deps.startTargetedWarmup(clipId, video, targetTime, {
        proactive: false,
        requestRender: true,
      });
      scrubSettleState.markWarmup(clipId, targetTime, VideoSyncRecoveryCoordinator.SCRUB_SETTLE_WARMUP_MS);
      return;
    }

    if (settle.stage === 'warmup' && video.readyState >= 2 && !video.seeking) {
      scrubSettleState.resolve(clipId);
    }
  }

  maybeRecoverDraggingDisplayedDrift(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number
  ): void {
    if (video.seeking || this.deps.warmups.isWarming(video)) {
      return;
    }

    const lastPresentedTime = renderHostPort.getLastPresentedVideoTime(video);
    if (typeof lastPresentedTime !== 'number' || !Number.isFinite(lastPresentedTime)) {
      return;
    }

    const presentedDrift = Math.abs(lastPresentedTime - targetTime);
    if (presentedDrift <= VideoSyncRecoveryCoordinator.SCRUB_DRAG_DISPLAYED_DRIFT_RECOVERY_THRESHOLD) {
      return;
    }

    const currentTimeDrift = Math.abs(video.currentTime - targetTime);
    if (currentTimeDrift > VideoSyncRecoveryCoordinator.SCRUB_DRAG_DISPLAYED_DRIFT_TARGET_EPSILON) {
      return;
    }

    const lastRecoveryAt = this.lastDisplayedDriftRecoveryAt[clipId] ?? 0;
    if (now - lastRecoveryAt < VideoSyncRecoveryCoordinator.SCRUB_DRAG_DISPLAYED_DRIFT_RECOVERY_COOLDOWN_MS) {
      return;
    }

    this.lastDisplayedDriftRecoveryAt[clipId] = now;
    vfPipelineMonitor.record('vf_settle_seek', {
      clipId,
      target: Math.round(targetTime * 1000) / 1000,
      recovery: 'displayed-drift',
      driftMs: Math.round(presentedDrift * 1000),
    });
    this.deps.recoverClipPlaybackState(clipId, video, targetTime);
  }

  maybeRecoverDraggingPendingSeek(
    clipId: string,
    video: HTMLVideoElement,
    targetTime: number,
    now: number
  ): boolean {
    if (!video.seeking || this.deps.warmups.isWarming(video) || video.readyState >= 2) {
      return false;
    }

    const pendingStartedAt = this.deps.htmlSeeks.getPendingStartedAt(clipId);
    if (pendingStartedAt === undefined) {
      return false;
    }

    const pendingAge = now - pendingStartedAt;
    if (pendingAge < VideoSyncRecoveryCoordinator.SCRUB_DRAG_PENDING_SEEK_RECOVERY_THRESHOLD_MS) {
      return false;
    }

    const currentTimeDrift = Math.abs(video.currentTime - targetTime);
    if (currentTimeDrift < VideoSyncRecoveryCoordinator.SCRUB_DRAG_PENDING_SEEK_TARGET_DRIFT_THRESHOLD) {
      return false;
    }

    const lastRecoveryAt = this.lastPendingSeekRecoveryAt[clipId] ?? 0;
    if (now - lastRecoveryAt < VideoSyncRecoveryCoordinator.SCRUB_DRAG_PENDING_SEEK_RECOVERY_COOLDOWN_MS) {
      return false;
    }

    this.lastPendingSeekRecoveryAt[clipId] = now;
    vfPipelineMonitor.record('vf_settle_seek', {
      clipId,
      target: Math.round(targetTime * 1000) / 1000,
      recovery: 'pending-seek-hang',
      pendingMs: Math.round(pendingAge),
      driftMs: Math.round(currentTimeDrift * 1000),
    });
    this.deps.recoverClipPlaybackState(clipId, video, targetTime);
    return true;
  }
}
