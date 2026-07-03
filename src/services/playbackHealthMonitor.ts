// PlaybackHealthMonitor - Detects playback anomalies, logs diagnostics, auto-recovers
//
// Anomaly types:
//   FRAME_STALL      - video.currentTime unchanged for ~1.5s during playback
//   WARMUP_STUCK     - video in warmingUpVideos for > 3s
//   RVFC_ORPHANED    - RVFC handle for clip not in current timeline
//   SEEK_STUCK       - video.seeking === true for > 2s
//   READYSTATE_DROP  - video.readyState < 2 during playback (not seeking)
//   GPU_SURFACE_COLD - playing video not in videoGpuReady
//   RENDER_STALL     - no render for > 3s while playing
//   HIGH_DROP_RATE   - > 10 drops/second from engine stats

import { Logger } from './logger';
import { renderHostPort } from './render/renderHostPort';
import { getClipTimeInfo, layerBuilder } from './layerBuilder';
import { createFrameContext } from './layerBuilder/FrameContext';
import { useTimelineStore } from '../stores/timeline';
import { hasTimelineVisualRenderDemand } from './timeline/timelineVisualDemand';
import {
  CLIP_ESCALATION_COOLDOWN_MS,
  CLIP_ESCALATION_THRESHOLD,
  CLIP_ESCALATION_WINDOW_MS,
  FRAME_STALL_POLLS,
  HIGH_DROP_THRESHOLD,
  PLAYBACK_PURGE_RESUME_DELAY_MS,
  POLL_INTERVAL,
  RENDER_STALL_MS,
  SEEK_STUCK_MS,
  WARMUP_STUCK_MS,
} from './playbackHealth/constants';
import {
  createInitialAnomalyCounts,
  recordAnomalyMetric,
  resetAnomalyCounts,
} from './playbackHealth/anomalyMetrics';
import {
  buildPlaybackHealthSnapshot,
  buildSnapshotVideoState,
  buildVideoSnapshot,
} from './playbackHealth/reports';
import { classifyPreviewFreezeRecovery } from './playbackHealth/previewFreeze';
import { resetWebCodecsProvidersForClip } from './playbackHealth/runtimeReset';
import {
  getVisibleHtmlVideoClipsAtPlayhead,
  shouldMonitorHtmlVideoHealth,
} from './playbackHealth/visibleClips';
import type {
  EngineStats,
} from '../types';
import type {
  AnomalyEvent,
  AnomalyType,
  PlaybackHealthSnapshot,
  PlaybackHealthVideoSnapshot,
  PlaybackPurgeMode,
  PlaybackPurgeOptions,
  PlaybackPurgeResult,
  VideoTimeTracker,
} from './playbackHealth/contracts';

const log = Logger.create('PlaybackHealth');

type VideoSyncManagerLike = ReturnType<typeof layerBuilder.getVideoSyncManager>;
type ClipIdTree = { id: string; nestedClips?: readonly ClipIdTree[] };

function collectClipIds(clips: readonly ClipIdTree[], output = new Set<string>()): Set<string> {
  for (const clip of clips) {
    output.add(clip.id);
    if (clip.nestedClips?.length) {
      collectClipIds(clip.nestedClips, output);
    }
  }
  return output;
}

function getActiveRvfcClipIds(vsm: VideoSyncManagerLike): string[] {
  const candidate = vsm as VideoSyncManagerLike & {
    getActiveRvfcClipIds?: unknown;
  };
  return typeof candidate.getActiveRvfcClipIds === 'function'
    ? candidate.getActiveRvfcClipIds()
    : [];
}

function cancelRvfcHandle(vsm: VideoSyncManagerLike, clipId: string): void {
  const candidate = vsm as VideoSyncManagerLike & {
    cancelRvfcHandle?: unknown;
  };
  if (typeof candidate.cancelRvfcHandle === 'function') {
    candidate.cancelRvfcHandle(clipId);
  }
}

// --- Service ---

export class PlaybackHealthMonitor {
  private intervalId: number | null = null;
  private startTime = 0;

  // Per-video tracking
  private videoTimeTracker = new Map<string, VideoTimeTracker>();
  private warmupStartTimes = new WeakMap<HTMLVideoElement, number>();
  private seekStartTimes = new Map<string, number>();
  private clipEscalationEvents = new Map<string, number[]>();
  private clipEscalationCooldowns = new Map<string, number>();

  // Anomaly log (ring buffer)
  private anomalyLog: AnomalyEvent[] = [];
  private anomalyCounts = createInitialAnomalyCounts();
  private lastAnomalyTime: Partial<Record<AnomalyType, number>> = {};
  private lastPlaybackPurgeAt = 0;

  start(): void {
    if (this.intervalId !== null) return;
    this.startTime = performance.now();
    this.intervalId = -1; // sentinel to indicate "started"
    this.scheduleNextCheck();
    this.exposeConsoleAPI();
    log.info('Health monitor started');
  }

  stop(): void {
    if (this.intervalId !== null && this.intervalId !== -1) {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(this.intervalId);
      } else {
        clearTimeout(this.intervalId);
      }
    }
    this.intervalId = null;
    log.info('Health monitor stopped');
  }

  private scheduleNextCheck(): void {
    if (typeof requestIdleCallback !== 'undefined') {
      this.intervalId = requestIdleCallback(() => {
        this.checkHealth();
        if (this.intervalId !== null) {
          this.scheduleNextCheck();
        }
      }, { timeout: POLL_INTERVAL }) as unknown as number;
    } else {
      this.intervalId = setTimeout(() => {
        this.checkHealth();
        if (this.intervalId !== null) {
          this.scheduleNextCheck();
        }
      }, POLL_INTERVAL) as unknown as number;
    }
  }

  // --- Main check loop ---

  private checkHealth(): void {
    const { clipDragPreview } = useTimelineStore.getState();
    const ctx = createFrameContext();
    const { isPlaying, isDraggingPlayhead, clips, tracks, playheadPosition } = ctx;
    const now = performance.now();
    const hasVisualRenderDemand = hasTimelineVisualRenderDemand({
      clips,
      tracks,
      playheadPosition,
      clipDragPreview,
    });

    // Gather visible video clips at the effective playhead.
    const videoClips = getVisibleHtmlVideoClipsAtPlayhead(ctx);
    const htmlHealthVideoClips =
      renderHostPort.getTelemetry().mode === 'worker-gpu-only'
        ? []
        : videoClips.filter(shouldMonitorHtmlVideoHealth);

    const vsm = layerBuilder.getVideoSyncManager();

    // 1. FRAME_STALL
    if (isPlaying) {
      for (const clip of htmlHealthVideoClips) {
        const video = clip.source!.videoElement!;
        const tracker = this.videoTimeTracker.get(clip.id);
        if (tracker) {
          if (Math.abs(video.currentTime - tracker.lastTime) < 0.001) {
            tracker.staleCount++;
            if (tracker.staleCount >= FRAME_STALL_POLLS) {
              if (this.recordAnomaly('FRAME_STALL', clip.id, `currentTime stuck at ${video.currentTime.toFixed(3)}`)) {
                this.recoverFrameStall(video);
                this.maybeEscalateClipRecovery(clip, 'FRAME_STALL');
              }
              tracker.staleCount = 0;
            }
          } else {
            tracker.lastTime = video.currentTime;
            tracker.staleCount = 0;
          }
        } else {
          this.videoTimeTracker.set(clip.id, { lastTime: video.currentTime, staleCount: 0 });
        }
      }
    }

    // 2. WARMUP_STUCK
    for (const clip of videoClips) {
      const video = clip.source!.videoElement!;
      if (vsm.isVideoWarmingUp(video)) {
        const warmupStart = this.warmupStartTimes.get(video);
        if (warmupStart) {
          if (now - warmupStart > WARMUP_STUCK_MS) {
            if (this.recordAnomaly('WARMUP_STUCK', clip.id, `warmup for ${((now - warmupStart) / 1000).toFixed(1)}s`)) {
              vsm.clearWarmupState(video);
            }
            this.warmupStartTimes.delete(video);
          }
        } else {
          this.warmupStartTimes.set(video, now);
        }
      } else {
        this.warmupStartTimes.delete(video);
      }
    }

    // 3. RVFC_ORPHANED
    const activeRvfcClipIds = getActiveRvfcClipIds(vsm);
    const currentClipIds = collectClipIds(clips);
    for (const clipId of activeRvfcClipIds) {
      if (!currentClipIds.has(clipId)) {
        if (this.recordAnomaly('RVFC_ORPHANED', clipId, 'RVFC handle for clip not in timeline')) {
          cancelRvfcHandle(vsm, clipId);
        }
      }
    }

    // 4. SEEK_STUCK
    for (const clip of htmlHealthVideoClips) {
      const video = clip.source!.videoElement!;
      if (video.seeking) {
        const seekStart = this.seekStartTimes.get(clip.id);
        if (seekStart) {
          if (now - seekStart > SEEK_STUCK_MS) {
            if (this.recordAnomaly('SEEK_STUCK', clip.id, `seeking for ${((now - seekStart) / 1000).toFixed(1)}s`)) {
              this.recoverSeekStuck(video);
              this.maybeEscalateClipRecovery(clip, 'SEEK_STUCK');
            }
            this.seekStartTimes.delete(clip.id);
          }
        } else {
          this.seekStartTimes.set(clip.id, now);
        }
      } else {
        this.seekStartTimes.delete(clip.id);
      }
    }

    // 5. READYSTATE_DROP
    if (isPlaying) {
      for (const clip of htmlHealthVideoClips) {
        const video = clip.source!.videoElement!;
        if (video.readyState < 2 && !video.seeking) {
          this.recordAnomaly('READYSTATE_DROP', clip.id, `readyState=${video.readyState}`);
        }
      }
    }

    // 6. GPU_SURFACE_COLD
    if (isPlaying) {
      const lc = renderHostPort.getLayerCollector();
      if (lc) {
        for (const clip of htmlHealthVideoClips) {
          const video = clip.source!.videoElement!;
          // Skip if video is currently warming up — warmup will handle GPU readiness
          if (vsm.isVideoWarmingUp(video)) continue;
          if (!video.paused && !lc.isVideoGpuReady(video)) {
            if (this.recordAnomaly('GPU_SURFACE_COLD', clip.id, 'playing video not GPU-ready')) {
              lc.resetVideoGpuReady(video);
            }
          }
        }
      }
    }

    // 7. RENDER_STALL
    if (isPlaying && hasVisualRenderDemand) {
      const rl = renderHostPort.getRenderLoop();
      if (rl) {
        const lastRender = rl.getLastSuccessfulRenderTime();
        if (lastRender > 0 && now - lastRender > RENDER_STALL_MS) {
          if (this.recordAnomaly('RENDER_STALL', undefined, `no render for ${((now - lastRender) / 1000).toFixed(1)}s`)) {
            renderHostPort.requestRender();
          }
        }
      }
    }

    // 8. HIGH_DROP_RATE
    const stats = renderHostPort.getStats();
    const hasActivePlaybackDemand = isPlaying || isDraggingPlayhead || clipDragPreview != null;
    if (
      hasVisualRenderDemand &&
      hasActivePlaybackDemand &&
      stats.drops &&
      stats.drops.lastSecond > HIGH_DROP_THRESHOLD
    ) {
      this.recordAnomaly('HIGH_DROP_RATE', undefined, `${stats.drops.lastSecond} drops/sec`);
    }

    this.maybeRecoverPreviewFreeze(now, isPlaying, stats.decoder);

    // Cleanup stale tracker entries for clips no longer in timeline
    const currentClipIdSet = collectClipIds(clips);
    const htmlHealthClipIdSet = new Set(htmlHealthVideoClips.map((c) => c.id));
    for (const id of this.videoTimeTracker.keys()) {
      if (!currentClipIdSet.has(id) || !htmlHealthClipIdSet.has(id)) this.videoTimeTracker.delete(id);
    }
    for (const id of this.seekStartTimes.keys()) {
      if (!currentClipIdSet.has(id) || !htmlHealthClipIdSet.has(id)) this.seekStartTimes.delete(id);
    }
    for (const id of this.clipEscalationEvents.keys()) {
      if (!currentClipIdSet.has(id) || !htmlHealthClipIdSet.has(id)) this.clipEscalationEvents.delete(id);
    }
    for (const id of this.clipEscalationCooldowns.keys()) {
      if (!currentClipIdSet.has(id)) this.clipEscalationCooldowns.delete(id);
    }
  }

  // --- Anomaly recording with cooldown ---

  private maybeRecoverPreviewFreeze(
    now: number,
    isPlaying: boolean,
    decoder: EngineStats['decoder']
  ): void {
    const recovery = classifyPreviewFreezeRecovery({
      decoder,
      now,
      isPlaying,
      lastPlaybackPurgeAt: this.lastPlaybackPurgeAt,
      healthVideos: this.videos(),
      healthAnomalies: this.anomalyLog,
    });
    if (!recovery) return;

    if (this.recordAnomaly('PREVIEW_FREEZE', recovery.clipId, recovery.detail)) {
      this.lastPlaybackPurgeAt = now;
      this.purgePlaybackPath({
        reason: 'auto-preview-freeze',
        mode: 'targeted',
        resumePlayback: true,
      });
    }
  }

  private recordAnomaly(type: AnomalyType, clipId?: string, detail?: string): boolean {
    const now = performance.now();
    const event = recordAnomalyMetric({
      anomalyLog: this.anomalyLog,
      anomalyCounts: this.anomalyCounts,
      lastAnomalyTime: this.lastAnomalyTime,
    }, type, now, clipId, detail);
    if (!event) {
      return false;
    }

    log.warn(
      `[${type}]${clipId ? ` clip=${clipId}` : ''} ${detail || ''}`
    );
    return true;
  }

  // --- Recovery methods ---

  private recoverFrameStall(video: HTMLVideoElement): void {
    const time = video.currentTime;
    const dur = video.duration;
    // EOF stall: seeking past end is futile — clamp back
    if (isFinite(dur) && time >= dur - 0.002) {
      video.currentTime = dur - 0.001;
      renderHostPort.requestRender();
      return;
    }

    const { isPlaying } = useTimelineStore.getState();
    if (isPlaying) {
      // During playback: just nudge time to unstick decoder.
      // Do NOT pause — that races with AudioSyncHandler and causes
      // "play() interrupted by pause()" errors.
      video.currentTime = time + 0.001;
      renderHostPort.requestRender();
    } else {
      // When paused: play/pause cycle to force GPU decode
      video.play().then(() => {
        video.pause();
        video.currentTime = time;
        renderHostPort.requestRender();
      }).catch(() => {
        video.currentTime = time + 0.001;
        renderHostPort.requestRender();
      });
    }
  }

  private recoverSeekStuck(video: HTMLVideoElement): void {
    const time = video.currentTime;
    video.currentTime = time;
    renderHostPort.requestRender();
  }

  private maybeEscalateClipRecovery(
    clip: { id: string; source?: { videoElement?: HTMLVideoElement } | null },
    reason: 'FRAME_STALL' | 'SEEK_STUCK'
  ): void {
    const video = clip.source?.videoElement;
    if (!video) return;

    const now = performance.now();
    const cooldownUntil = this.clipEscalationCooldowns.get(clip.id) ?? 0;
    const recentEvents = (this.clipEscalationEvents.get(clip.id) ?? [])
      .filter((timestamp) => now - timestamp <= CLIP_ESCALATION_WINDOW_MS);
    recentEvents.push(now);
    this.clipEscalationEvents.set(clip.id, recentEvents);

    if (recentEvents.length < CLIP_ESCALATION_THRESHOLD || now < cooldownUntil) {
      return;
    }

    this.clipEscalationCooldowns.set(clip.id, now + CLIP_ESCALATION_COOLDOWN_MS);
    this.clipEscalationEvents.set(clip.id, []);
    this.escalateClipRecovery(clip.id, video, reason);
  }

  private escalateClipRecovery(
    clipId: string,
    video: HTMLVideoElement,
    reason: 'FRAME_STALL' | 'SEEK_STUCK'
  ): void {
    const vsm = layerBuilder.getVideoSyncManager();
    const lc = renderHostPort.getLayerCollector();
    const ctx = createFrameContext();
    const clip = ctx.clips.find((entry) => entry.id === clipId);
    if (!clip) return;

    const timeInfo = getClipTimeInfo(ctx, clip);
    const targetTime = timeInfo.clipTime;
    const resumePlayback = ctx.isPlaying;

    this.videoTimeTracker.delete(clipId);
    this.seekStartTimes.delete(clipId);
    this.warmupStartTimes.delete(video);

    lc?.resetVideoGpuReady(video);

    log.warn(
      `[CLIP_RECOVERY] clip=${clipId} escalating after repeated ${reason} at ${targetTime.toFixed(3)}`
    );

    vsm.recoverClipPlaybackState(clipId, video, targetTime, { resumePlayback });
  }

  private safePurgeSeekTime(video: HTMLVideoElement, targetTime: number): number {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      return Math.max(0, targetTime);
    }
    return Math.max(0, Math.min(targetTime, duration - 0.001));
  }

  purgePlaybackPath(options: PlaybackPurgeOptions = {}): PlaybackPurgeResult {
    const reason = options.reason ?? 'manual';
    const mode = options.mode ?? 'targeted';
    const state = useTimelineStore.getState();
    const wasPlaying = state.isPlaying;
    const previousSpeed = state.playbackSpeed;
    const playheadPosition = state.playheadPosition;
    const resumePlayback = options.resumePlayback ?? wasPlaying;

    state.setDraggingPlayhead(false);
    if (wasPlaying) {
      state.pause();
      useTimelineStore.getState().setPlaybackSpeed(previousSpeed);
    }

    const ctx = createFrameContext();
    const vsm = layerBuilder.getVideoSyncManager();
    const lc = renderHostPort.getLayerCollector();
    const clipsAtPlayhead = getVisibleHtmlVideoClipsAtPlayhead(ctx).filter(
      (clip) => clip.source?.videoElement || clip.source?.webCodecsPlayer
    );

    this.videoTimeTracker.clear();
    this.warmupStartTimes = new WeakMap();
    this.seekStartTimes.clear();
    this.clipEscalationEvents.clear();
    this.clipEscalationCooldowns.clear();
    vsm.reset();
    renderHostPort.clearVideoCache();
    if (mode === 'full') {
      renderHostPort.clearScrubbingCache();
      renderHostPort.clearCompositeCache();
    }

    const purgedClips: PlaybackPurgeResult['clips'] = [];
    for (const clip of clipsAtPlayhead) {
      const targetTime = getClipTimeInfo(ctx, clip).clipTime;
      const video = clip.source?.videoElement;
      const webCodecsProvidersReset = resetWebCodecsProvidersForClip(
        ctx,
        clip,
        targetTime,
        (error) => log.warn('Failed to reset WebCodecs provider during playback purge', error)
      );

      if (video) {
        const safeTargetTime = this.safePurgeSeekTime(video, targetTime);
        try {
          video.pause();
          video.muted = true;
          if ((video.src || video.currentSrc) && Math.abs(video.currentTime - safeTargetTime) > 0.01) {
            video.currentTime = safeTargetTime;
          }
        } catch (error) {
          log.warn('Failed to retarget video element during playback purge', error);
        }

        lc?.resetVideoGpuReady(video);
        const videoSrc = video.currentSrc || video.src;
        if (videoSrc) {
          renderHostPort.clearScrubbingCache(videoSrc);
        }
        vsm.resetClipRecoveryState(clip.id, video);
        vsm.recoverClipPlaybackState(clip.id, video, safeTargetTime, { resumePlayback: false });
      }

      purgedClips.push({
        clipId: clip.id,
        targetTime,
        hadVideoElement: !!video,
        webCodecsProvidersReset,
      });
    }

    renderHostPort.requestNewFrameRender();
    log.warn(`[PLAYBACK_PURGE] reason=${reason} mode=${mode} clips=${purgedClips.length}`);

    if (resumePlayback) {
      window.setTimeout(() => {
        const liveState = useTimelineStore.getState();
        liveState.setPlaybackSpeed(previousSpeed);
        void liveState.play().catch((error) => {
          log.warn('Failed to resume playback after purge', error);
        });
        renderHostPort.requestNewFrameRender();
      }, PLAYBACK_PURGE_RESUME_DELAY_MS);
    }

    return {
      reason,
      mode,
      playheadPosition,
      wasPlaying,
      resumeScheduled: resumePlayback,
      clips: purgedClips,
    };
  }

  softReset(): void {
    const ctx = createFrameContext();
    const vsm = layerBuilder.getVideoSyncManager();
    const lc = renderHostPort.getLayerCollector();

    const videoClips = getVisibleHtmlVideoClipsAtPlayhead(ctx);

    // Force decode all
    for (const clip of videoClips) {
      const video = clip.source!.videoElement!;
      vsm.clearWarmupState(video);
      if (lc) lc.resetVideoGpuReady(video);
    }

    // Clear orphaned RVFC handles
    const rvfcIds = getActiveRvfcClipIds(vsm);
    const currentIds = new Set(ctx.clips.map((c) => c.id));
    for (const id of rvfcIds) {
      if (!currentIds.has(id)) cancelRvfcHandle(vsm, id);
    }

    renderHostPort.requestRender();
    log.info('Soft reset completed');
  }

  forceDecodeAll(): void {
    const ctx = createFrameContext();
    const lc = renderHostPort.getLayerCollector();

    const videoClips = getVisibleHtmlVideoClipsAtPlayhead(ctx);

    for (const clip of videoClips) {
      const video = clip.source!.videoElement!;
      if (lc) lc.resetVideoGpuReady(video);
    }

    renderHostPort.requestRender();
    log.info('Force decode all completed');
  }

  clearWarmups(): void {
    const ctx = createFrameContext();
    const vsm = layerBuilder.getVideoSyncManager();

    const videoClips = getVisibleHtmlVideoClipsAtPlayhead(ctx);

    for (const clip of videoClips) {
      vsm.clearWarmupState(clip.source!.videoElement!);
    }

    // WeakMap doesn't support clear() — entries GC naturally when video elements are removed
    this.warmupStartTimes = new WeakMap();
    log.info('Warmups cleared');
  }

  clearOrphans(): void {
    const { clips } = useTimelineStore.getState();
    const vsm = layerBuilder.getVideoSyncManager();
    const currentIds = new Set(clips.map((c) => c.id));

    for (const id of getActiveRvfcClipIds(vsm)) {
      if (!currentIds.has(id)) cancelRvfcHandle(vsm, id);
    }

    log.info('Orphaned handles cleared');
  }

  reset(): void {
    this.videoTimeTracker.clear();
    this.warmupStartTimes = new WeakMap();
    this.seekStartTimes.clear();
    this.clipEscalationEvents.clear();
    this.clipEscalationCooldowns.clear();
    this.anomalyLog.length = 0;
    resetAnomalyCounts(this.anomalyCounts);
    this.lastAnomalyTime = {};
    this.lastPlaybackPurgeAt = 0;
    log.info('Health monitor reset');
  }

  // --- Console API ---

  snapshot(): PlaybackHealthSnapshot {
    const { isPlaying } = useTimelineStore.getState();
    const ctx = createFrameContext();
    const videoClips = getVisibleHtmlVideoClipsAtPlayhead(ctx);

    return buildPlaybackHealthSnapshot({
      isPlaying,
      startTime: this.startTime,
      now: performance.now(),
      anomalyCounts: this.anomalyCounts,
      videoStates: videoClips.map((c) => {
        const v = c.source!.videoElement!;
        return buildSnapshotVideoState(c.id, v);
      }),
    });
  }

  anomalies(filterType?: AnomalyType): AnomalyEvent[] {
    if (filterType) return this.anomalyLog.filter((e) => e.type === filterType);
    return [...this.anomalyLog];
  }

  videos(): PlaybackHealthVideoSnapshot[] {
    const ctx = createFrameContext();
    const vsm = layerBuilder.getVideoSyncManager();
    const lc = renderHostPort.getLayerCollector();

    return getVisibleHtmlVideoClipsAtPlayhead(ctx)
      .map((c) => {
        const v = c.source!.videoElement!;
        return buildVideoSnapshot({
          clipId: c.id,
          video: v,
          warmingUp: vsm.isVideoWarmingUp(v),
          gpuReady: lc?.isVideoGpuReady(v) ?? false,
        });
      });
  }

  private exposeConsoleAPI(): void {
    (window as Window & {
      __PLAYBACK_HEALTH__?: {
        snapshot: () => ReturnType<PlaybackHealthMonitor['snapshot']>;
        anomalies: (type?: AnomalyType) => ReturnType<PlaybackHealthMonitor['anomalies']>;
        videos: () => ReturnType<PlaybackHealthMonitor['videos']>;
        recover: {
          softReset: () => void;
          purgePlaybackPath: (mode?: PlaybackPurgeMode) => PlaybackPurgeResult;
          forceDecodeAll: () => void;
          clearWarmups: () => void;
          clearOrphans: () => void;
        };
        purgePlaybackPath: (mode?: PlaybackPurgeMode) => PlaybackPurgeResult;
        reset: () => void;
      };
    }).__PLAYBACK_HEALTH__ = {
      snapshot: () => this.snapshot(),
      anomalies: (type?: AnomalyType) => this.anomalies(type),
      videos: () => this.videos(),
      recover: {
        softReset: () => this.softReset(),
        purgePlaybackPath: (mode?: PlaybackPurgeMode) => this.purgePlaybackPath({ reason: 'console', mode }),
        forceDecodeAll: () => this.forceDecodeAll(),
        clearWarmups: () => this.clearWarmups(),
        clearOrphans: () => this.clearOrphans(),
      },
      purgePlaybackPath: (mode?: PlaybackPurgeMode) => this.purgePlaybackPath({ reason: 'console', mode }),
      reset: () => this.reset(),
    };
  }
}

// --- HMR Singleton ---

const hot = typeof import.meta !== 'undefined'
  ? (import.meta as { hot?: { data?: Record<string, unknown> } }).hot
  : undefined;
const hotData = hot ? (hot.data ??= {}) : undefined;

let instance: PlaybackHealthMonitor;
if (hotData?.healthMonitor) {
  instance = hotData.healthMonitor as PlaybackHealthMonitor;
} else {
  instance = new PlaybackHealthMonitor();
  if (hotData) hotData.healthMonitor = instance;
}

export const playbackHealthMonitor = instance;
