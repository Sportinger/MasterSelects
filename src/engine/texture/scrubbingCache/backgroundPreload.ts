import { Logger } from '../../../services/logger';
import {
  canRetainBackgroundPreloadVideo,
  releaseBackgroundPreloadVideo,
  reportBackgroundPreloadVideo,
} from './backgroundResources';
import type { BackgroundPreloadSession } from './backgroundSession';
import {
  cacheBackgroundVideoFrame,
  getFiniteDuration,
  seekBackgroundVideo,
  yieldBackgroundPreload,
} from './backgroundVideoOps';
import { frameIndexForTime, SCRUB_CACHE_FPS } from './cacheKeys';
import { ScrubTextureCache } from './scrubTextureCache';

const log = Logger.create('ScrubbingCache');

export interface BackgroundScrubCacheStats {
  activeSessions: number;
  queuedFrames: number;
  activePreloads: number;
  filledFrames: number;
  skippedFrames: number;
  failedFrames: number;
  lastFillLatencyMs: number;
}

export class BackgroundPreloadController {
  private readonly scrubCache: ScrubTextureCache;
  private readonly onFrameCached?: () => void;
  private sessions: Map<string, BackgroundPreloadSession> = new Map();
  private filled = 0;
  private skipped = 0;
  private failed = 0;
  private lastFillLatencyMs = 0;
  private lastRenderRequestAt = 0;
  private activeSession: BackgroundPreloadSession | null = null;
  private paused = false;

  private readonly scrubAheadFrames = 48;
  private readonly scrubBehindFrames = 24;
  private readonly idleAheadFrames = 24;
  private readonly idleBehindFrames = 12;
  private readonly maxQueueFrames = 72;
  private readonly staleDistanceFrames = 180;
  private readonly jumpResetFrames = 180;
  private readonly rescheduleIntervalMs = 80;
  private readonly seekTimeoutMs = 900;
  private readonly metadataTimeoutMs = 1200;
  private readonly renderRequestIntervalMs = 33;
  private readonly maxSessions = 4;

  constructor(
    scrubCache: ScrubTextureCache,
    onFrameCached?: () => void
  ) {
    this.scrubCache = scrubCache;
    this.onFrameCached = onFrameCached;
  }

  preloadAroundTime(
    video: HTMLVideoElement,
    targetTime: number,
    options: { isDragging?: boolean; isPlaying?: boolean } = {}
  ): void {
    if (typeof document === 'undefined' || !video.src || !Number.isFinite(targetTime) || targetTime < 0) {
      return;
    }

    if (options.isPlaying) {
      this.paused = true;
      this.clearQueues();
      return;
    }

    this.paused = false;

    const targetFrame = frameIndexForTime(targetTime);
    const now = performance.now();
    const session = this.getOrCreateSession(video);
    if (!session) return;

    const duration = getFiniteDuration(video.duration) ?? getFiniteDuration(session.video.duration);
    if (duration !== undefined) {
      session.duration = duration;
    }

    if (session.lastRequestedFrame === targetFrame && now - session.lastScheduleAt < this.rescheduleIntervalMs) {
      return;
    }

    const previousFrame = session.lastRequestedFrame;
    if (previousFrame >= 0) {
      const delta = targetFrame - previousFrame;
      if (delta !== 0 && Math.abs(delta) < this.jumpResetFrames) {
        session.direction = delta > 0 ? 1 : -1;
      } else if (Math.abs(delta) >= this.jumpResetFrames) {
        this.resetQueue(session);
        session.direction = delta > 0 ? 1 : -1;
      }
    }

    session.lastRequestedFrame = targetFrame;
    session.lastScheduleAt = now;
    this.pruneQueue(session, targetFrame);

    const ahead = options.isDragging ? this.scrubAheadFrames : this.idleAheadFrames;
    const behind = options.isDragging ? this.scrubBehindFrames : this.idleBehindFrames;

    this.enqueueFrame(session, targetFrame, true);
    if (session.direction < 0) {
      for (let i = 1; i <= behind; i++) this.enqueueFrame(session, targetFrame - i, i <= 6);
      for (let i = 1; i <= ahead; i++) this.enqueueFrame(session, targetFrame + i, false);
    } else {
      for (let i = 1; i <= ahead; i++) this.enqueueFrame(session, targetFrame + i, i <= 6);
      for (let i = 1; i <= behind; i++) this.enqueueFrame(session, targetFrame - i, false);
    }

    this.trimQueue(session);
    this.processQueue(session);
  }

  clear(videoSrc?: string): void {
    if (videoSrc) {
      const session = this.sessions.get(videoSrc);
      if (session) {
        this.destroySession(session);
        this.sessions.delete(videoSrc);
      }
      return;
    }

    for (const session of this.sessions.values()) {
      this.destroySession(session);
    }
    this.sessions.clear();
  }

  getStats(): BackgroundScrubCacheStats {
    let queuedFrames = 0;
    let activePreloads = 0;
    for (const session of this.sessions.values()) {
      queuedFrames += session.queue.length;
      if (session.processing) {
        activePreloads++;
      }
    }

    return {
      activeSessions: this.sessions.size,
      queuedFrames,
      activePreloads,
      filledFrames: this.filled,
      skippedFrames: this.skipped,
      failedFrames: this.failed,
      lastFillLatencyMs: this.lastFillLatencyMs,
    };
  }

  getOrCreateSession(video: HTMLVideoElement): BackgroundPreloadSession | null {
    const videoSrc = video.currentSrc || video.src;
    if (!videoSrc) return null;
    const existing = this.sessions.get(videoSrc);
    if (existing && !existing.disposed) {
      return existing;
    }

    const admission = canRetainBackgroundPreloadVideo(videoSrc);
    if (!admission.admitted) {
      log.debug('Background scrub preload video skipped by runtime admission', {
        videoSrc,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return null;
    }

    const backgroundVideo = document.createElement('video');
    backgroundVideo.muted = true;
    backgroundVideo.preload = 'auto';
    backgroundVideo.playsInline = true;
    if (video.crossOrigin) {
      backgroundVideo.crossOrigin = video.crossOrigin;
    }
    backgroundVideo.src = video.currentSrc || video.src;
    backgroundVideo.load();
    reportBackgroundPreloadVideo(videoSrc, backgroundVideo);

    const session: BackgroundPreloadSession = {
      videoSrc,
      video: backgroundVideo,
      queue: [],
      queuedFrames: new Set(),
      processing: false,
      disposed: false,
      direction: 0,
      lastRequestedFrame: -1,
      lastScheduleAt: 0,
      duration: getFiniteDuration(video.duration) ?? 0,
    };

    this.sessions.set(videoSrc, session);
    this.pruneSessions(videoSrc);
    return session;
  }

  private pruneSessions(currentVideoSrc: string): void {
    if (this.sessions.size <= this.maxSessions) return;

    const candidates = [...this.sessions.entries()]
      .filter(([videoSrc, session]) =>
        videoSrc !== currentVideoSrc &&
        session !== this.activeSession &&
        !session.processing
      )
      .sort((a, b) => a[1].lastScheduleAt - b[1].lastScheduleAt);

    for (const [videoSrc, session] of candidates) {
      if (this.sessions.size <= this.maxSessions) break;
      this.destroySession(session);
      this.sessions.delete(videoSrc);
    }
  }

  private enqueueFrame(session: BackgroundPreloadSession, frameIndex: number, priority: boolean): void {
    if (frameIndex < 0) return;
    if (session.duration > 0 && frameIndex / SCRUB_CACHE_FPS > session.duration) return;
    if (this.scrubCache.hasFrame(session.videoSrc, frameIndex)) {
      this.skipped++;
      return;
    }
    if (session.queuedFrames.has(frameIndex)) return;

    session.queuedFrames.add(frameIndex);
    if (priority) {
      session.queue.unshift(frameIndex);
    } else {
      session.queue.push(frameIndex);
    }
  }

  private pruneQueue(session: BackgroundPreloadSession, centerFrame: number): void {
    if (session.queue.length === 0) return;
    session.queue = session.queue.filter((frameIndex) => {
      const keep = Math.abs(frameIndex - centerFrame) <= this.staleDistanceFrames;
      if (!keep) {
        session.queuedFrames.delete(frameIndex);
      }
      return keep;
    });
  }

  private trimQueue(session: BackgroundPreloadSession): void {
    while (session.queue.length > this.maxQueueFrames) {
      const frameIndex = session.queue.pop();
      if (frameIndex !== undefined) {
        session.queuedFrames.delete(frameIndex);
      }
    }
  }

  private resetQueue(session: BackgroundPreloadSession): void {
    session.queue = [];
    session.queuedFrames.clear();
  }

  private clearQueues(): void {
    for (const session of this.sessions.values()) {
      this.resetQueue(session);
    }
  }

  private processQueue(session: BackgroundPreloadSession): void {
    if (session.processing || session.disposed || this.paused) return;
    if (this.activeSession && this.activeSession !== session) return;
    this.activeSession = session;
    session.processing = true;
    void this.processQueueAsync(session);
  }

  private async processQueueAsync(session: BackgroundPreloadSession): Promise<void> {
    try {
      while (!session.disposed && !this.paused && session.queue.length > 0) {
        const frameIndex = session.queue.shift();
        if (frameIndex === undefined) break;
        session.queuedFrames.delete(frameIndex);

        if (session.lastRequestedFrame >= 0 && Math.abs(frameIndex - session.lastRequestedFrame) > this.staleDistanceFrames) {
          this.skipped++;
          continue;
        }

        if (this.scrubCache.hasFrame(session.videoSrc, frameIndex)) {
          this.skipped++;
          continue;
        }

        const time = frameIndex / SCRUB_CACHE_FPS;
        const startedAt = performance.now();
        const ready = await seekBackgroundVideo(session, time, {
          metadataTimeoutMs: this.metadataTimeoutMs,
          seekTimeoutMs: this.seekTimeoutMs,
        });
        if (this.paused) break;
        if (!ready || session.disposed) {
          this.failed++;
          continue;
        }

        const cached = await cacheBackgroundVideoFrame(session, time, this.scrubCache);
        if (cached) {
          this.filled++;
          this.lastFillLatencyMs = Math.round(performance.now() - startedAt);
          this.requestRenderForFill();
        } else {
          this.failed++;
        }

        await yieldBackgroundPreload();
      }
    } finally {
      session.processing = false;
      if (this.activeSession === session) {
        this.activeSession = null;
      }
      if (!session.disposed && !this.paused && session.queue.length > 0) {
        this.processQueue(session);
      } else {
        this.processNextQueue();
      }
    }
  }

  private processNextQueue(): void {
    if (this.paused || this.activeSession) return;
    for (const session of this.sessions.values()) {
      if (!session.disposed && !session.processing && session.queue.length > 0) {
        this.processQueue(session);
        break;
      }
    }
  }

  private requestRenderForFill(): void {
    if (!this.onFrameCached) return;
    const now = performance.now();
    if (now - this.lastRenderRequestAt < this.renderRequestIntervalMs) return;
    this.lastRenderRequestAt = now;
    this.onFrameCached();
  }

  private destroySession(session: BackgroundPreloadSession): void {
    session.disposed = true;
    session.queue = [];
    session.queuedFrames.clear();
    if (this.activeSession === session) {
      this.activeSession = null;
    }
    try {
      session.video.pause();
      session.video.removeAttribute('src');
      session.video.load();
    } catch {
      // Best-effort cleanup only.
    }
    releaseBackgroundPreloadVideo(session.videoSrc);
  }
}
