// Scrubbing frame cache for instant access during timeline scrubbing
// Also includes RAM preview composite cache for instant playback

import { Logger } from '../../services/logger';
import { vfPipelineMonitor } from '../../services/vfPipelineMonitor';
import {
  canRetainRamPreviewCompositeCache,
  canRetainRamPreviewGpuFrame,
  releaseRamPreviewCompositeCacheResource,
  releaseRamPreviewGpuFrameCacheResources,
  releaseRamPreviewGpuFrameResource,
  reportRamPreviewCompositeCache,
  reportRamPreviewGpuFrame,
  type RamPreviewCompositeCacheReport,
  type RamPreviewGpuFrameReport,
} from '../../services/timeline/ramPreviewRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../services/timeline/timelineRuntimeCoordinator';
import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from '../../services/timeline/runtimeCoordinatorTypes';
import type { GpuFrameCacheEntry } from '../core/types';

const log = Logger.create('ScrubbingCache');

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

type ScrubbingTextureEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  bytes: number;
};

type ScrubDirection = -1 | 0 | 1;

interface BackgroundPreloadSession {
  videoSrc: string;
  video: HTMLVideoElement;
  queue: number[];
  queuedFrames: Set<number>;
  processing: boolean;
  disposed: boolean;
  direction: ScrubDirection;
  lastRequestedFrame: number;
  lastScheduleAt: number;
  duration: number;
}

export interface BackgroundScrubCacheStats {
  activeSessions: number;
  queuedFrames: number;
  activePreloads: number;
  filledFrames: number;
  skippedFrames: number;
  failedFrames: number;
  lastFillLatencyMs: number;
}

export interface ScrubbingCacheStats {
  count: number;
  maxCount: number;
  fillPct: number;
  approxMemoryMB: number;
  evictions: number;
  budgetMode: 'static';
  background: BackgroundScrubCacheStats;
}

export class ScrubbingCache {
  private device: GPUDevice;
  private onBackgroundFrameCached?: () => void;

  // Scrubbing frame cache - pre-decoded frames for instant access
  // Key: "videoSrc:quantizedFrameTime" -> { texture, view }
  // Time is quantized to frame boundaries (1/30s) for better cache hit rate
  // Uses Map insertion order for O(1) LRU operations
  private scrubbingCache: Map<string, ScrubbingTextureEntry> = new Map();
  // Frame count is the soft cap; the 1GB byte cap below is the real ceiling.
  // With resolution-aware downscaling (SCRUB_CACHE_MAX_DIMENSION), a downscaled
  // 1080p frame is ~2MB, so ~480 frames (~16s at 30fps) fit inside 1GB.
  private maxScrubbingCacheFrames = 480;
  private readonly maxScrubbingCacheBytes = 1024 * 1024 * 1024; // Cap scrub textures at 1GB VRAM
  // Scrub-preview frames are stored downscaled so cache coverage (seconds of
  // timeline) is decoupled from source resolution: a 4K source gets the same
  // coverage as 1080p instead of ~4x fewer frames. The longest side is capped
  // here; frames already smaller are stored as-is (never upscaled). The settled
  // live/exact frame still renders at full resolution, so this only softens the
  // image during active scrubbing — the same tradeoff proxy mode makes.
  private readonly SCRUB_CACHE_MAX_DIMENSION = 960;
  private readonly SCRUB_CACHE_FPS = 30; // Quantization granularity for scrubbing cache keys
  private scrubbingCacheBytes = 0;
  private scrubbingCacheEvictions = 0;
  // Keys with an in-flight downscale capture, so per-frame cacheFrameAtTime calls
  // don't spawn duplicate createImageBitmap work for the same frame.
  private pendingScrubCaptures = new Set<string>();
  private backgroundPreloadSessions: Map<string, BackgroundPreloadSession> = new Map();
  private backgroundPreloadFilled = 0;
  private backgroundPreloadSkipped = 0;
  private backgroundPreloadFailed = 0;
  private backgroundLastFillLatencyMs = 0;
  private lastBackgroundRenderRequestAt = 0;
  private activeBackgroundPreloadSession: BackgroundPreloadSession | null = null;
  private backgroundPreloadPaused = false;
  private readonly BACKGROUND_SCRUB_AHEAD_FRAMES = 48;
  private readonly BACKGROUND_SCRUB_BEHIND_FRAMES = 24;
  private readonly BACKGROUND_IDLE_AHEAD_FRAMES = 24;
  private readonly BACKGROUND_IDLE_BEHIND_FRAMES = 12;
  private readonly BACKGROUND_MAX_QUEUE_FRAMES = 72;
  private readonly BACKGROUND_STALE_DISTANCE_FRAMES = 180;
  private readonly BACKGROUND_JUMP_RESET_FRAMES = 180;
  private readonly BACKGROUND_RESCHEDULE_INTERVAL_MS = 80;
  private readonly BACKGROUND_SEEK_TIMEOUT_MS = 900;
  private readonly BACKGROUND_METADATA_TIMEOUT_MS = 1200;
  private readonly BACKGROUND_RENDER_REQUEST_INTERVAL_MS = 33;
  private readonly BACKGROUND_MAX_SESSIONS = 4;

  // Last valid frame cache - keeps last frame visible during seeks
  private lastFrameTextures: Map<HTMLVideoElement, GPUTexture> = new Map();
  private lastFrameViews: Map<HTMLVideoElement, GPUTextureView> = new Map();
  private lastFrameSizes: Map<HTMLVideoElement, { width: number; height: number }> = new Map();
  private lastFrameMediaTimes: Map<HTMLVideoElement, number> = new Map();
  private lastFrameOwners = new WeakMap<HTMLVideoElement, string>();
  private lastCaptureTime: Map<HTMLVideoElement, number> = new Map();
  private lastPresentedFrameTimes = new WeakMap<HTMLVideoElement, number>();
  private lastPresentedFrameOwners = new WeakMap<HTMLVideoElement, string>();
  private lastOwnerMissSignature = new WeakMap<HTMLVideoElement, string>();
  private lastOwnerMissAt = new WeakMap<HTMLVideoElement, number>();

  // RAM Preview cache - fully composited frames for instant playback
  // Key: time (quantized to frame) -> ImageData (CPU-side for memory efficiency)
  // Uses Map insertion order for O(1) LRU operations
  private compositeCache: Map<number, ImageData> = new Map();
  private maxCompositeCacheFrames = 900; // 30 seconds at 30fps
  private maxCompositeCacheBytes = 512 * 1024 * 1024; // 512MB memory limit
  private compositeCacheBytes = 0; // Track actual memory usage

  // GPU texture cache for instant RAM Preview playback (no CPU->GPU upload needed)
  // Limited size to conserve VRAM (~500MB at 1080p for 60 frames)
  // Uses Map insertion order for O(1) LRU operations
  private gpuFrameCache: Map<number, GpuFrameCacheEntry> = new Map();
  private maxGpuCacheFrames = 60; // ~500MB at 1080p

  constructor(device: GPUDevice, onBackgroundFrameCached?: () => void) {
    this.device = device;
    this.onBackgroundFrameCached = onBackgroundFrameCached;
  }

  // === SCRUBBING FRAME CACHE ===

  // Quantize time to nearest frame boundary for consistent cache keys.
  // Two scrub positions within the same frame (e.g. 1.5001s and 1.5009s at 30fps)
  // map to the same key, dramatically improving cache hit rate.
  private quantizeToFrame(time: number): string {
    return (Math.round(time * this.SCRUB_CACHE_FPS) / this.SCRUB_CACHE_FPS).toFixed(3);
  }

  private frameIndexForTime(time: number): number {
    return Math.round(time * this.SCRUB_CACHE_FPS);
  }

  private getScrubbingKey(videoSrc: string, time: number): string {
    return `${videoSrc}:${this.quantizeToFrame(time)}`;
  }

  private getScrubbingKeyForFrame(videoSrc: string, frameIndex: number): string {
    return this.getScrubbingKey(videoSrc, frameIndex / this.SCRUB_CACHE_FPS);
  }

  private getScrubbingKeyTime(key: string): number {
    const index = key.lastIndexOf(':');
    if (index === -1) {
      return 0;
    }
    const parsed = Number(key.slice(index + 1));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private touchScrubbingEntry(
    key: string,
    entry: ScrubbingTextureEntry
  ): { view: GPUTextureView; mediaTime: number } {
    this.scrubbingCache.delete(key);
    this.scrubbingCache.set(key, entry);
    return {
      view: entry.view,
      mediaTime: this.getScrubbingKeyTime(key),
    };
  }

  // Aspect-correct downscale so the longest side is at most
  // SCRUB_CACHE_MAX_DIMENSION. Returns the original size when already within the
  // cap (never upscales). Rounds to even dimensions for clean texture sizing.
  private computeScrubCacheSize(width: number, height: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (longest <= this.SCRUB_CACHE_MAX_DIMENSION || longest <= 0) {
      return { width, height };
    }
    const scale = this.SCRUB_CACHE_MAX_DIMENSION / longest;
    const scaledWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
    const scaledHeight = Math.max(2, Math.round((height * scale) / 2) * 2);
    return { width: scaledWidth, height: scaledHeight };
  }

  private addScrubbingFrameFromSource(
    source: HTMLVideoElement | ImageBitmap,
    videoSrc: string,
    time: number,
    width: number,
    height: number
  ): boolean {
    if (!videoSrc || width <= 0 || height <= 0) return false;

    const key = this.getScrubbingKey(videoSrc, time);
    if (this.scrubbingCache.has(key)) return false;

    const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    try {
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        [width, height]
      );

      const bytes = width * height * 4;
      this.scrubbingCache.set(key, { texture, view: texture.createView(), bytes });
      this.scrubbingCacheBytes += bytes;
      this.evictScrubbingCacheIfNeeded();
      return true;
    } catch {
      texture.destroy();
      return false;
    }
  }

  private evictScrubbingCacheIfNeeded(): void {
    while (
      this.scrubbingCache.size > this.maxScrubbingCacheFrames ||
      this.scrubbingCacheBytes > this.maxScrubbingCacheBytes
    ) {
      const oldestKey = this.scrubbingCache.keys().next().value;
      if (!oldestKey) break;

      const oldest = this.scrubbingCache.get(oldestKey);
      if (oldest) {
        this.scrubbingCacheBytes -= oldest.bytes;
        this.scrubbingCacheEvictions++;
        oldest.texture.destroy();
      }
      this.scrubbingCache.delete(oldestKey);
    }
  }

  // Cache a frame at a specific time for instant scrubbing access.
  // Sources larger than the scrub-cache cap are downscaled (resolution-aware),
  // so several clips scrubbed at once stay within the VRAM budget instead of
  // thrashing. createImageBitmap snapshots the current frame at call time, so the
  // captured frame still matches `time`.
  cacheFrameAtTime(video: HTMLVideoElement, time: number): void {
    if (video.videoWidth === 0 || video.readyState < 2) return;

    const target = this.computeScrubCacheSize(video.videoWidth, video.videoHeight);
    const needsDownscale = target.width !== video.videoWidth || target.height !== video.videoHeight;

    if (!needsDownscale || typeof createImageBitmap !== 'function') {
      // Already within the cap (or no resize support) — fast synchronous copy.
      this.addScrubbingFrameFromSource(video, video.src, time, video.videoWidth, video.videoHeight);
      return;
    }

    const videoSrc = video.src;
    if (!videoSrc) return;
    const key = this.getScrubbingKey(videoSrc, time);
    if (this.scrubbingCache.has(key) || this.pendingScrubCaptures.has(key)) return;

    this.pendingScrubCaptures.add(key);
    void createImageBitmap(video, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'medium',
    })
      .then((bitmap) => {
        this.addScrubbingFrameFromSource(bitmap, videoSrc, time, bitmap.width, bitmap.height);
        bitmap.close();
      })
      .catch(() => { /* frame unavailable — skip */ })
      .finally(() => {
        this.pendingScrubCaptures.delete(key);
      });
  }

  preloadAroundTime(
    video: HTMLVideoElement,
    targetTime: number,
    options: {
      isDragging?: boolean;
      isPlaying?: boolean;
    } = {}
  ): void {
    if (
      typeof document === 'undefined' ||
      !video.src ||
      !Number.isFinite(targetTime) ||
      targetTime < 0
    ) {
      return;
    }

    if (options.isPlaying) {
      this.backgroundPreloadPaused = true;
      this.clearBackgroundQueues();
      return;
    }

    this.backgroundPreloadPaused = false;

    const targetFrame = this.frameIndexForTime(targetTime);
    const now = performance.now();
    const session = this.getOrCreateBackgroundSession(video);
    if (!session) return;

    const duration = this.getFiniteDuration(video.duration) ?? this.getFiniteDuration(session.video.duration);
    if (duration !== undefined) {
      session.duration = duration;
    }

    if (
      session.lastRequestedFrame === targetFrame &&
      now - session.lastScheduleAt < this.BACKGROUND_RESCHEDULE_INTERVAL_MS
    ) {
      return;
    }

    const previousFrame = session.lastRequestedFrame;
    if (previousFrame >= 0) {
      const delta = targetFrame - previousFrame;
      if (delta !== 0 && Math.abs(delta) < this.BACKGROUND_JUMP_RESET_FRAMES) {
        session.direction = delta > 0 ? 1 : -1;
      } else if (Math.abs(delta) >= this.BACKGROUND_JUMP_RESET_FRAMES) {
        this.resetBackgroundQueue(session);
        session.direction = delta > 0 ? 1 : -1;
      }
    }

    session.lastRequestedFrame = targetFrame;
    session.lastScheduleAt = now;
    this.pruneBackgroundQueue(session, targetFrame);

    const ahead = options.isDragging
      ? this.BACKGROUND_SCRUB_AHEAD_FRAMES
      : this.BACKGROUND_IDLE_AHEAD_FRAMES;
    const behind = options.isDragging
      ? this.BACKGROUND_SCRUB_BEHIND_FRAMES
      : this.BACKGROUND_IDLE_BEHIND_FRAMES;

    this.enqueueBackgroundFrame(session, targetFrame, true);

    if (session.direction < 0) {
      for (let i = 1; i <= behind; i++) {
        this.enqueueBackgroundFrame(session, targetFrame - i, i <= 6);
      }
      for (let i = 1; i <= ahead; i++) {
        this.enqueueBackgroundFrame(session, targetFrame + i, false);
      }
    } else {
      for (let i = 1; i <= ahead; i++) {
        this.enqueueBackgroundFrame(session, targetFrame + i, i <= 6);
      }
      for (let i = 1; i <= behind; i++) {
        this.enqueueBackgroundFrame(session, targetFrame - i, false);
      }
    }

    this.trimBackgroundQueue(session);
    this.processBackgroundQueue(session);
  }

  private getFiniteDuration(duration: number): number | undefined {
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }

  private getBackgroundPreloadVideoResourceId(videoSrc: string): string {
    return `scrubbing-cache:background-preload-video:${hashString(videoSrc)}`;
  }

  private getVideoSrcKind(src: string | undefined): 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown' {
    if (!src) return 'unknown';
    if (src.startsWith('blob:')) return 'blob-url';
    if (src.startsWith('file:')) return 'file-path';
    if (/^https?:\/\//i.test(src)) return 'remote-url';
    if (src.startsWith('mediastream:')) return 'media-source';
    return 'project-path';
  }

  private createBackgroundPreloadVideoResource(
    videoSrc: string,
    element?: HTMLVideoElement,
  ): RenderResourceDescriptor {
    const resourceId = this.getBackgroundPreloadVideoResourceId(videoSrc);
    const readyState = element?.readyState ?? 0;
    const networkState = element?.networkState ?? 0;
    const status = element?.error
      ? 'warning'
      : readyState >= HTMLMediaElement.HAVE_METADATA
        ? 'ok'
        : 'unknown';
    return {
      id: resourceId,
      kind: 'html-media',
      policyId: 'background',
      owner: {
        ownerId: `scrubbing-cache:background-preload:${hashString(videoSrc)}`,
        ownerType: 'timeline',
      },
      source: {
        sourceId: videoSrc,
        previewPath: videoSrc,
      },
      mediaElementKind: 'video',
      elementId: resourceId,
      srcKind: this.getVideoSrcKind(videoSrc),
      dimensions: {
        width: element?.videoWidth,
        height: element?.videoHeight,
        durationSeconds: this.getFiniteDuration(element?.duration ?? 0),
      },
      diagnostics: {
        status,
        provider: {
          providerId: resourceId,
          providerKind: 'html-video',
          status,
          isReady: readyState >= HTMLMediaElement.HAVE_METADATA,
          isPlaying: element ? !element.paused : false,
          isSeeking: element?.seeking ?? false,
          currentTimeSeconds: element?.currentTime ?? 0,
          readyState,
          networkState,
          errorCode: element?.error ? String(element.error.code) : undefined,
        },
      },
      label: 'Background scrub preload video',
      tags: ['scrubbing-cache', 'background-preload', 'html-video'],
    };
  }

  private canRetainBackgroundPreloadVideo(videoSrc: string): TimelineRuntimeAdmissionDecision {
    return timelineRuntimeCoordinator.canRetainResource(
      this.createBackgroundPreloadVideoResource(videoSrc)
    );
  }

  private reportBackgroundPreloadVideo(videoSrc: string, element: HTMLVideoElement): void {
    timelineRuntimeCoordinator.retainResource(
      this.createBackgroundPreloadVideoResource(videoSrc, element)
    );
  }

  private releaseBackgroundPreloadVideo(videoSrc: string): void {
    timelineRuntimeCoordinator.releaseResource(this.getBackgroundPreloadVideoResourceId(videoSrc));
  }

  private getOrCreateBackgroundSession(video: HTMLVideoElement): BackgroundPreloadSession | null {
    const videoSrc = video.currentSrc || video.src;
    if (!videoSrc) return null;
    const existing = this.backgroundPreloadSessions.get(videoSrc);
    if (existing && !existing.disposed) {
      return existing;
    }

    const admission = this.canRetainBackgroundPreloadVideo(videoSrc);
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
    this.reportBackgroundPreloadVideo(videoSrc, backgroundVideo);

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
      duration: this.getFiniteDuration(video.duration) ?? 0,
    };

    this.backgroundPreloadSessions.set(videoSrc, session);
    this.pruneBackgroundSessions(videoSrc);
    return session;
  }

  private pruneBackgroundSessions(currentVideoSrc: string): void {
    if (this.backgroundPreloadSessions.size <= this.BACKGROUND_MAX_SESSIONS) {
      return;
    }

    const candidates = [...this.backgroundPreloadSessions.entries()]
      .filter(([videoSrc, session]) =>
        videoSrc !== currentVideoSrc &&
        session !== this.activeBackgroundPreloadSession &&
        !session.processing
      )
      .sort((a, b) => a[1].lastScheduleAt - b[1].lastScheduleAt);

    for (const [videoSrc, session] of candidates) {
      if (this.backgroundPreloadSessions.size <= this.BACKGROUND_MAX_SESSIONS) {
        break;
      }
      this.destroyBackgroundSession(session);
      this.backgroundPreloadSessions.delete(videoSrc);
    }
  }

  private enqueueBackgroundFrame(
    session: BackgroundPreloadSession,
    frameIndex: number,
    priority: boolean
  ): void {
    if (frameIndex < 0) return;
    if (
      session.duration > 0 &&
      frameIndex / this.SCRUB_CACHE_FPS > session.duration
    ) {
      return;
    }
    if (this.scrubbingCache.has(this.getScrubbingKeyForFrame(session.videoSrc, frameIndex))) {
      this.backgroundPreloadSkipped++;
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

  private pruneBackgroundQueue(session: BackgroundPreloadSession, centerFrame: number): void {
    if (session.queue.length === 0) return;

    session.queue = session.queue.filter((frameIndex) => {
      const keep = Math.abs(frameIndex - centerFrame) <= this.BACKGROUND_STALE_DISTANCE_FRAMES;
      if (!keep) {
        session.queuedFrames.delete(frameIndex);
      }
      return keep;
    });
  }

  private trimBackgroundQueue(session: BackgroundPreloadSession): void {
    while (session.queue.length > this.BACKGROUND_MAX_QUEUE_FRAMES) {
      const frameIndex = session.queue.pop();
      if (frameIndex !== undefined) {
        session.queuedFrames.delete(frameIndex);
      }
    }
  }

  private resetBackgroundQueue(session: BackgroundPreloadSession): void {
    session.queue = [];
    session.queuedFrames.clear();
  }

  private clearBackgroundQueues(): void {
    for (const session of this.backgroundPreloadSessions.values()) {
      this.resetBackgroundQueue(session);
    }
  }

  private processBackgroundQueue(session: BackgroundPreloadSession): void {
    if (session.processing || session.disposed || this.backgroundPreloadPaused) return;
    if (
      this.activeBackgroundPreloadSession &&
      this.activeBackgroundPreloadSession !== session
    ) {
      return;
    }
    this.activeBackgroundPreloadSession = session;
    session.processing = true;
    void this.processBackgroundQueueAsync(session);
  }

  private async processBackgroundQueueAsync(session: BackgroundPreloadSession): Promise<void> {
    try {
      while (!session.disposed && !this.backgroundPreloadPaused && session.queue.length > 0) {
        const frameIndex = session.queue.shift();
        if (frameIndex === undefined) break;
        session.queuedFrames.delete(frameIndex);

        if (
          session.lastRequestedFrame >= 0 &&
          Math.abs(frameIndex - session.lastRequestedFrame) > this.BACKGROUND_STALE_DISTANCE_FRAMES
        ) {
          this.backgroundPreloadSkipped++;
          continue;
        }

        if (this.scrubbingCache.has(this.getScrubbingKeyForFrame(session.videoSrc, frameIndex))) {
          this.backgroundPreloadSkipped++;
          continue;
        }

        const time = frameIndex / this.SCRUB_CACHE_FPS;
        const startedAt = performance.now();
        const ready = await this.seekBackgroundVideo(session, time);
        if (this.backgroundPreloadPaused) {
          break;
        }
        if (!ready || session.disposed) {
          this.backgroundPreloadFailed++;
          continue;
        }

        const cached = await this.cacheBackgroundVideoFrame(session, time);
        if (cached) {
          this.backgroundPreloadFilled++;
          this.backgroundLastFillLatencyMs = Math.round(performance.now() - startedAt);
          this.requestRenderForBackgroundFill();
        } else {
          this.backgroundPreloadFailed++;
        }

        await this.yieldBackgroundPreload();
      }
    } finally {
      session.processing = false;
      if (this.activeBackgroundPreloadSession === session) {
        this.activeBackgroundPreloadSession = null;
      }
      if (!session.disposed && !this.backgroundPreloadPaused && session.queue.length > 0) {
        this.processBackgroundQueue(session);
      } else {
        this.processNextBackgroundQueue();
      }
    }
  }

  private processNextBackgroundQueue(): void {
    if (this.backgroundPreloadPaused || this.activeBackgroundPreloadSession) return;

    for (const session of this.backgroundPreloadSessions.values()) {
      if (!session.disposed && !session.processing && session.queue.length > 0) {
        this.processBackgroundQueue(session);
        break;
      }
    }
  }

  private async seekBackgroundVideo(
    session: BackgroundPreloadSession,
    targetTime: number
  ): Promise<boolean> {
    const video = session.video;
    if (video.readyState < 1) {
      const hasMetadata = await this.waitForVideoEvent(
        video,
        ['loadedmetadata', 'loadeddata', 'canplay'],
        this.BACKGROUND_METADATA_TIMEOUT_MS
      );
      if (!hasMetadata && video.readyState < 1) {
        return false;
      }
    }

    const duration = this.getFiniteDuration(video.duration) ?? session.duration;
    const safeTargetTime =
      duration > 0
        ? Math.max(0, Math.min(targetTime, Math.max(0, duration - 0.001)))
        : Math.max(0, targetTime);

    if (Math.abs(video.currentTime - safeTargetTime) > 0.012 || video.readyState < 2) {
      try {
        video.currentTime = safeTargetTime;
      } catch {
        return false;
      }

      const seeked = await this.waitForVideoEvent(
        video,
        ['seeked', 'loadeddata', 'canplay', 'timeupdate'],
        this.BACKGROUND_SEEK_TIMEOUT_MS
      );
      if (!seeked && video.readyState < 2) {
        return false;
      }
    }

    if (video.readyState < 2) {
      await this.waitForVideoEvent(
        video,
        ['loadeddata', 'canplay'],
        this.BACKGROUND_SEEK_TIMEOUT_MS
      );
    }

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return false;
    }

    return Math.abs(video.currentTime - safeTargetTime) <= 0.5;
  }

  private async cacheBackgroundVideoFrame(
    session: BackgroundPreloadSession,
    targetTime: number
  ): Promise<boolean> {
    const video = session.video;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      return false;
    }

    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap | null = null;
      try {
        // Decode and downscale in one step: createImageBitmap's resize options
        // hand the GPU a smaller frame, so a downscaled 4K source costs the same
        // VRAM per scrub frame as 1080p and fits far more of the timeline.
        const target = this.computeScrubCacheSize(video.videoWidth, video.videoHeight);
        bitmap = await createImageBitmap(video, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'medium',
        });
        return this.addScrubbingFrameFromSource(
          bitmap,
          session.videoSrc,
          targetTime,
          bitmap.width,
          bitmap.height
        );
      } catch {
        return false;
      } finally {
        bitmap?.close();
      }
    }

    return this.addScrubbingFrameFromSource(
      video,
      session.videoSrc,
      targetTime,
      video.videoWidth,
      video.videoHeight
    );
  }

  private waitForVideoEvent(
    video: HTMLVideoElement,
    events: string[],
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const cleanup = () => {
        events.forEach((eventName) => video.removeEventListener(eventName, onDone));
        clearTimeout(timeout);
      };
      const finish = (result: boolean) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(result);
      };
      const onDone = () => finish(true);
      events.forEach((eventName) => video.addEventListener(eventName, onDone, { once: true }));
      const timeout = window.setTimeout(() => finish(false), timeoutMs);
    });
  }

  private yieldBackgroundPreload(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  private requestRenderForBackgroundFill(): void {
    if (!this.onBackgroundFrameCached) return;

    const now = performance.now();
    if (now - this.lastBackgroundRenderRequestAt < this.BACKGROUND_RENDER_REQUEST_INTERVAL_MS) {
      return;
    }
    this.lastBackgroundRenderRequestAt = now;
    this.onBackgroundFrameCached();
  }

  private getBackgroundStats(): BackgroundScrubCacheStats {
    let queuedFrames = 0;
    let activePreloads = 0;
    for (const session of this.backgroundPreloadSessions.values()) {
      queuedFrames += session.queue.length;
      if (session.processing) {
        activePreloads++;
      }
    }

    return {
      activeSessions: this.backgroundPreloadSessions.size,
      queuedFrames,
      activePreloads,
      filledFrames: this.backgroundPreloadFilled,
      skippedFrames: this.backgroundPreloadSkipped,
      failedFrames: this.backgroundPreloadFailed,
      lastFillLatencyMs: this.backgroundLastFillLatencyMs,
    };
  }

  // Get cached frame for scrubbing (uses quantized time for better hit rate)
  getCachedFrame(videoSrc: string, time: number): GPUTextureView | null {
    return this.getCachedFrameEntry(videoSrc, time)?.view ?? null;
  }

  getCachedFrameEntry(
    videoSrc: string,
    time: number
  ): { view: GPUTextureView; mediaTime: number } | null {
    const key = this.getScrubbingKey(videoSrc, time);
    const entry = this.scrubbingCache.get(key);
    if (entry) {
      return this.touchScrubbingEntry(key, entry);
    }
    return null;
  }

  // Return the nearest cached frame around the requested media time.
  // This is used during scrubbing to avoid flashing black while the exact
  // seek target is still decoding.
  getNearestCachedFrame(
    videoSrc: string,
    time: number,
    maxDistanceFrames: number = 6
  ): GPUTextureView | null {
    return this.getNearestCachedFrameEntry(videoSrc, time, maxDistanceFrames)?.view ?? null;
  }

  getNearestCachedFrameEntry(
    videoSrc: string,
    time: number,
    maxDistanceFrames: number = 6
  ): { view: GPUTextureView; mediaTime: number } | null {
    const exact = this.getCachedFrameEntry(videoSrc, time);
    if (exact) {
      return exact;
    }

    const baseFrame = this.frameIndexForTime(time);
    for (let distance = 1; distance <= maxDistanceFrames; distance++) {
      const previous = this.scrubbingCache.get(
        this.getScrubbingKey(videoSrc, (baseFrame - distance) / this.SCRUB_CACHE_FPS)
      );
      if (previous) {
        return this.touchScrubbingEntry(
          this.getScrubbingKey(videoSrc, (baseFrame - distance) / this.SCRUB_CACHE_FPS),
          previous
        );
      }

      const next = this.scrubbingCache.get(
        this.getScrubbingKey(videoSrc, (baseFrame + distance) / this.SCRUB_CACHE_FPS)
      );
      if (next) {
        return this.touchScrubbingEntry(
          this.getScrubbingKey(videoSrc, (baseFrame + distance) / this.SCRUB_CACHE_FPS),
          next
        );
      }
    }

    return null;
  }

  getCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    if (!videoSrc) return [];

    const prefix = `${videoSrc}:`;
    const frameIndices = new Set<number>();
    for (const key of this.scrubbingCache.keys()) {
      if (!key.startsWith(prefix)) continue;
      frameIndices.add(this.frameIndexForTime(this.getScrubbingKeyTime(key)));
    }

    if (frameIndices.size === 0) return [];

    const sorted = [...frameIndices].sort((a, b) => a - b);
    const ranges: Array<{ startFrame: number; endFrame: number }> = [
      { startFrame: sorted[0], endFrame: sorted[0] },
    ];

    for (let i = 1; i < sorted.length; i++) {
      const frameIndex = sorted[i];
      const current = ranges[ranges.length - 1];
      if (frameIndex <= current.endFrame + 1) {
        current.endFrame = frameIndex;
      } else {
        ranges.push({ startFrame: frameIndex, endFrame: frameIndex });
      }
    }

    return ranges.map((range) => ({
      start: range.startFrame / this.SCRUB_CACHE_FPS,
      end: (range.endFrame + 1) / this.SCRUB_CACHE_FPS,
    }));
  }

  // Get scrubbing cache stats
  getScrubbingCacheStats(): ScrubbingCacheStats {
    const frameFillPct =
      this.maxScrubbingCacheFrames > 0
        ? (this.scrubbingCache.size / this.maxScrubbingCacheFrames) * 100
        : 0;
    const byteFillPct =
      this.maxScrubbingCacheBytes > 0
        ? (this.scrubbingCacheBytes / this.maxScrubbingCacheBytes) * 100
        : 0;

    return {
      count: this.scrubbingCache.size,
      maxCount: this.maxScrubbingCacheFrames,
      fillPct: Math.round(Math.max(frameFillPct, byteFillPct) * 10) / 10,
      approxMemoryMB: Math.round((this.scrubbingCacheBytes / (1024 * 1024)) * 100) / 100,
      evictions: this.scrubbingCacheEvictions,
      budgetMode: 'static',
      background: this.getBackgroundStats(),
    };
  }

  private destroyBackgroundSession(session: BackgroundPreloadSession): void {
    session.disposed = true;
    session.queue = [];
    session.queuedFrames.clear();
    if (this.activeBackgroundPreloadSession === session) {
      this.activeBackgroundPreloadSession = null;
    }
    try {
      session.video.pause();
      session.video.removeAttribute('src');
      session.video.load();
    } catch {
      // Best-effort cleanup only.
    }
    this.releaseBackgroundPreloadVideo(session.videoSrc);
  }

  private clearBackgroundPreload(videoSrc?: string): void {
    if (videoSrc) {
      const session = this.backgroundPreloadSessions.get(videoSrc);
      if (session) {
        this.destroyBackgroundSession(session);
        this.backgroundPreloadSessions.delete(videoSrc);
      }
      return;
    }

    for (const session of this.backgroundPreloadSessions.values()) {
      this.destroyBackgroundSession(session);
    }
    this.backgroundPreloadSessions.clear();
  }

  // Clear scrubbing cache for a specific video
  clearScrubbingCache(videoSrc?: string): void {
    this.clearBackgroundPreload(videoSrc);

    if (videoSrc) {
      const prefix = `${videoSrc}:`;
      // Clear only frames from this video
      for (const key of [...this.scrubbingCache.keys()]) {
        if (key.startsWith(prefix)) {
          const entry = this.scrubbingCache.get(key);
          if (entry) {
            this.scrubbingCacheBytes -= entry.bytes;
            entry.texture.destroy();
          }
          this.scrubbingCache.delete(key);
        }
      }
    } else {
      // Clear all - destroy every texture
      for (const entry of this.scrubbingCache.values()) {
        entry.texture.destroy();
      }
      this.scrubbingCache.clear();
      this.scrubbingCacheBytes = 0;
    }
  }

  // === LAST FRAME CACHE ===

  // Capture current video frame to a persistent GPU texture (for last-frame cache)
  captureVideoFrame(video: HTMLVideoElement, ownerId?: string): boolean {
    if (video.videoWidth === 0 || video.videoHeight === 0) return false;

    const width = video.videoWidth;
    const height = video.videoHeight;

    // Reuse the existing texture when dimensions match so we never replace
    // a known-good frame with an uninitialized texture if the copy fails.
    const existingTexture = this.lastFrameTextures.get(video);
    const existingSize = this.lastFrameSizes.get(video);
    const canReuseExisting =
      !!existingTexture &&
      !!existingSize &&
      existingSize.width === width &&
      existingSize.height === height;

    let texture = existingTexture;
    let view = this.lastFrameViews.get(video);
    let createdFreshTexture = false;

    if (!canReuseExisting) {
      texture = this.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      view = texture.createView();
      createdFreshTexture = true;
    }

    // Copy current frame to texture
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: texture! },
        [width, height]
      );
      if (createdFreshTexture) {
        this.lastFrameTextures.set(video, texture!);
        this.lastFrameViews.set(video, view!);
        this.lastFrameSizes.set(video, { width, height });
      }
      this.lastFrameMediaTimes.set(video, video.currentTime);
      if (ownerId) {
        this.lastFrameOwners.set(video, ownerId);
      }
      return true;
    } catch {
      if (createdFreshTexture) {
        texture?.destroy();
      }
      return false;
    }
  }

  // Capture video frame via createImageBitmap (async forced decode)
  // This is the ONLY API that forces Chrome to actually decode a video frame.
  // After page reload, all sync APIs (canvas.drawImage, importExternalTexture,
  // new VideoFrame, copyExternalImageToTexture) return black/empty data because
  // Chrome defers frame decoding. createImageBitmap forces async decode.
  async captureVideoFrameViaImageBitmap(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      return false;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    try {
      // createImageBitmap is the ONLY browser API that forces actual frame decode
      const bitmap = await createImageBitmap(video);

      // Get or create texture
      let texture = this.lastFrameTextures.get(video);
      const existingSize = this.lastFrameSizes.get(video);

      if (!texture || !existingSize || existingSize.width !== width || existingSize.height !== height) {
        texture = this.device.createTexture({
          size: [width, height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.lastFrameTextures.set(video, texture);
        this.lastFrameSizes.set(video, { width, height });
        this.lastFrameViews.set(video, texture.createView());
      }

      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [width, height]
      );
      bitmap.close();
      this.lastFrameMediaTimes.set(video, video.currentTime);
      if (ownerId) {
        this.lastFrameOwners.set(video, ownerId);
      }
      log.debug('Pre-cached video frame via createImageBitmap', { width, height });
      return true;
    } catch (e) {
      log.warn('captureVideoFrameViaImageBitmap failed', e);
      return false;
    }
  }

  captureVideoFrameAtTime(
    video: HTMLVideoElement,
    mediaTime: number,
    ownerId?: string
  ): boolean {
    const captured = this.captureVideoFrame(video, ownerId);
    if (captured && Number.isFinite(mediaTime)) {
      this.lastFrameMediaTimes.set(video, mediaTime);
    }
    return captured;
  }

  captureVideoFrameIfCloser(
    video: HTMLVideoElement,
    targetTime: number,
    candidateTime: number,
    ownerId?: string,
    minIntervalMs: number = 50
  ): boolean {
    if (!Number.isFinite(candidateTime) || !Number.isFinite(targetTime)) {
      return false;
    }

    const existing = this.getLastFrame(video, ownerId);
    const existingDrift =
      typeof existing?.mediaTime === 'number' && Number.isFinite(existing.mediaTime)
        ? Math.abs(existing.mediaTime - targetTime)
        : Number.POSITIVE_INFINITY;
    const candidateDrift = Math.abs(candidateTime - targetTime);

    if (candidateDrift + 0.001 >= existingDrift) {
      return false;
    }

    const now = performance.now();
    const lastCapture = this.getLastCaptureTime(video);
    if (now - lastCapture < minIntervalMs) {
      return false;
    }

    const captured = this.captureVideoFrameAtTime(video, candidateTime, ownerId);
    if (captured) {
      this.setLastCaptureTime(video, now);
    }
    return captured;
  }

  // Get last cached frame for a video (used during seeks)
  getLastFrame(
    video: HTMLVideoElement,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    const view = this.lastFrameViews.get(video);
    const size = this.lastFrameSizes.get(video);
    const owner = this.lastFrameOwners.get(video);
    if (ownerId && owner !== ownerId) {
      const now = performance.now();
      const signature = `${ownerId}:${owner ?? 'none'}`;
      const lastSignature = this.lastOwnerMissSignature.get(video);
      const lastAt = this.lastOwnerMissAt.get(video) ?? 0;
      if (signature !== lastSignature || now - lastAt > 120) {
        this.lastOwnerMissSignature.set(video, signature);
        this.lastOwnerMissAt.set(video, now);
        vfPipelineMonitor.record('vf_scrub_owner_miss', {
          requestedClipId: ownerId,
          cachedClipId: owner ?? 'none',
          cachedTimeMs: Math.round((this.lastFrameMediaTimes.get(video) ?? -1) * 1000),
          currentTimeMs: Math.round(video.currentTime * 1000),
        });
      }
      return null;
    }
    if (view && size) {
      return {
        view,
        width: size.width,
        height: size.height,
        mediaTime: this.lastFrameMediaTimes.get(video),
      };
    }
    return null;
  }

  getLastFrameOwner(video: HTMLVideoElement): string | undefined {
    return this.lastFrameOwners.get(video);
  }

  // Only reuse a copied last-frame fallback when it was captured close to the
  // requested media time. This avoids flashing unrelated frames during seeks.
  getLastFrameNearTime(
    video: HTMLVideoElement,
    targetTime: number,
    maxDeltaSeconds: number,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    const frame = this.getLastFrame(video, ownerId);
    if (!frame) {
      return null;
    }

    const frameTime = frame.mediaTime;
    if (typeof frameTime !== 'number' || !Number.isFinite(frameTime)) {
      return null;
    }

    return Math.abs(frameTime - targetTime) <= maxDeltaSeconds
      ? frame
      : null;
  }

  // Get/set last capture time
  getLastCaptureTime(video: HTMLVideoElement): number {
    return this.lastCaptureTime.get(video) || 0;
  }

  setLastCaptureTime(video: HTMLVideoElement, time: number): void {
    this.lastCaptureTime.set(video, time);
  }

  getLastPresentedTime(video: HTMLVideoElement): number | undefined {
    return this.lastPresentedFrameTimes.get(video);
  }

  getLastPresentedOwner(video: HTMLVideoElement): string | undefined {
    return this.lastPresentedFrameOwners.get(video);
  }

  markFramePresented(
    video: HTMLVideoElement,
    time: number = video.currentTime,
    ownerId?: string
  ): void {
    if (Number.isFinite(time)) {
      this.lastPresentedFrameTimes.set(video, time);
    }
    if (ownerId) {
      this.lastPresentedFrameOwners.set(video, ownerId);
    }
  }

  // Cleanup resources for a video that's no longer used
  cleanupVideo(video: HTMLVideoElement): void {
    const texture = this.lastFrameTextures.get(video);
    if (texture) texture.destroy();
    this.lastFrameTextures.delete(video);
    this.lastFrameViews.delete(video);
    this.lastFrameSizes.delete(video);
    this.lastFrameMediaTimes.delete(video);
    this.lastFrameOwners.delete(video);
    this.lastCaptureTime.delete(video);
    this.lastPresentedFrameTimes.delete(video);
    this.lastPresentedFrameOwners.delete(video);
  }

  // === RAM PREVIEW COMPOSITE CACHE ===

  // Quantize time to frame number at 30fps for cache key
  quantizeTime(time: number): number {
    return Math.round(time * 30) / 30;
  }

  private createCompositeCacheReport(
    frameCount: number,
    heapBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): RamPreviewCompositeCacheReport {
    return {
      frameCount,
      maxFrames: this.maxCompositeCacheFrames,
      heapBytes,
      width: sampleFrame?.width,
      height: sampleFrame?.height,
    };
  }

  private getProjectedCompositeCacheReport(
    key: number,
    frameBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): RamPreviewCompositeCacheReport {
    if (this.compositeCache.has(key)) {
      return this.createCompositeCacheReport(this.compositeCache.size, this.compositeCacheBytes, sampleFrame);
    }

    const entries = Array.from(this.compositeCache, ([entryKey, frame]) => ({
      key: entryKey,
      bytes: frame.data.byteLength,
    }));
    entries.push({ key, bytes: frameBytes });
    let projectedBytes = this.compositeCacheBytes + frameBytes;

    while (
      entries.length > this.maxCompositeCacheFrames ||
      projectedBytes > this.maxCompositeCacheBytes
    ) {
      const evicted = entries.shift();
      if (!evicted) break;
      projectedBytes -= evicted.bytes;
    }

    return this.createCompositeCacheReport(entries.length, Math.max(0, projectedBytes), sampleFrame);
  }

  private createCompositeCacheDeniedDecision(reason: string): TimelineRuntimeAdmissionDecision {
    return {
      admitted: false,
      resourceId: 'ram-preview:composite-cache:image-data',
      policyId: 'ram-preview',
      reason,
      projectedUsage: {
        resources: 0,
        sessions: 0,
        frameProviders: 0,
        htmlMediaElements: 0,
        nativeDecoders: 0,
        gpuTextures: 0,
        imageBitmaps: 0,
        audioSources: 0,
        jobs: 0,
        heapBytes: 0,
        gpuBytes: 0,
      },
      pressure: [],
      rejectedUnits: [],
    };
  }

  canCacheCompositeFrame(
    time: number,
    frameBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): TimelineRuntimeAdmissionDecision {
    const key = this.quantizeTime(time);
    const report = this.getProjectedCompositeCacheReport(key, frameBytes, sampleFrame);
    if (report.frameCount <= 0 || report.heapBytes <= 0) {
      return this.createCompositeCacheDeniedDecision('composite-cache-frame-exceeds-local-budget');
    }
    return canRetainRamPreviewCompositeCache(report);
  }

  // Cache composite frame data
  cacheCompositeFrame(time: number, imageData: ImageData): boolean {
    const key = this.quantizeTime(time);
    if (this.compositeCache.has(key)) return true;

    const frameBytes = imageData.data.byteLength;
    const projectedReport = this.getProjectedCompositeCacheReport(key, frameBytes, imageData);
    if (projectedReport.frameCount <= 0 || projectedReport.heapBytes <= 0) return false;

    const admission = canRetainRamPreviewCompositeCache(projectedReport);
    if (!admission.admitted) {
      log.debug('RAM preview composite cache skipped by runtime admission', {
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }

    this.compositeCache.set(key, imageData);
    this.compositeCacheBytes += frameBytes;

    // Evict oldest frames if over frame count OR memory limit
    while (
      this.compositeCache.size > this.maxCompositeCacheFrames ||
      this.compositeCacheBytes > this.maxCompositeCacheBytes
    ) {
      const oldestKey = this.compositeCache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.compositeCache.get(oldestKey);
        if (evicted) this.compositeCacheBytes -= evicted.data.byteLength;
        this.compositeCache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.reportCompositeCacheResource(imageData);
    return true;
  }

  private reportCompositeCacheResource(sampleFrame?: ImageData): void {
    reportRamPreviewCompositeCache(
      this.createCompositeCacheReport(this.compositeCache.size, this.compositeCacheBytes, sampleFrame)
    );
  }

  // Get cached composite frame if available
  getCachedCompositeFrame(time: number): ImageData | null {
    const key = this.quantizeTime(time);
    const imageData = this.compositeCache.get(key);

    if (imageData) {
      // Move to end of Map for O(1) LRU update
      this.compositeCache.delete(key);
      this.compositeCache.set(key, imageData);
      return imageData;
    }
    return null;
  }

  // Check if a frame is cached
  hasCompositeCacheFrame(time: number): boolean {
    return this.compositeCache.has(this.quantizeTime(time));
  }

  // Get composite cache stats
  getCompositeCacheStats(_outputWidth: number, _outputHeight: number): { count: number; maxFrames: number; memoryMB: number } {
    const count = this.compositeCache.size;
    const memoryMB = this.compositeCacheBytes / (1024 * 1024);
    return { count, maxFrames: this.maxCompositeCacheFrames, memoryMB };
  }

  // === GPU FRAME CACHE ===

  // Get cached GPU frame
  getGpuCachedFrame(time: number): GpuFrameCacheEntry | null {
    const key = this.quantizeTime(time);
    const entry = this.gpuFrameCache.get(key);
    if (entry) {
      // Move to end of Map for O(1) LRU update
      this.gpuFrameCache.delete(key);
      this.gpuFrameCache.set(key, entry);
      return entry;
    }
    return null;
  }

  private createGpuFrameReport(
    time: number,
    entry: Pick<GpuFrameCacheEntry, 'width' | 'height' | 'format' | 'gpuBytes'>
  ): RamPreviewGpuFrameReport {
    return {
      frameKey: this.quantizeTime(time),
      time,
      width: entry.width,
      height: entry.height,
      format: entry.format,
      gpuBytes: entry.gpuBytes,
    };
  }

  private evictOldestGpuFrame(excludedKey?: number): boolean {
    for (const oldestKey of this.gpuFrameCache.keys()) {
      if (oldestKey === excludedKey) continue;
      const evicted = this.gpuFrameCache.get(oldestKey);
      if (evicted) evicted.texture.destroy();
      releaseRamPreviewGpuFrameResource(oldestKey);
      this.gpuFrameCache.delete(oldestKey);
      return true;
    }
    return false;
  }

  private prepareGpuCacheAdmission(
    frameKey: number,
    report: RamPreviewGpuFrameReport
  ): TimelineRuntimeAdmissionDecision {
    let admission = canRetainRamPreviewGpuFrame(report);
    while (
      !admission.admitted &&
      admission.rejectedUnits.some((entry) =>
        entry.unit === 'resource' || entry.unit === 'gpu-texture' || entry.unit === 'gpu-bytes'
      ) &&
      this.evictOldestGpuFrame(frameKey)
    ) {
      admission = canRetainRamPreviewGpuFrame(report);
    }
    return admission;
  }

  canCacheGpuFrame(
    time: number,
    entry: Pick<GpuFrameCacheEntry, 'width' | 'height' | 'format' | 'gpuBytes'>
  ): TimelineRuntimeAdmissionDecision {
    const report = this.createGpuFrameReport(time, entry);
    return this.prepareGpuCacheAdmission(report.frameKey, report);
  }

  // Add to GPU cache
  addToGpuCache(time: number, entry: GpuFrameCacheEntry): boolean {
    const key = this.quantizeTime(time);
    const report = this.createGpuFrameReport(time, entry);
    const admission = this.prepareGpuCacheAdmission(key, report);
    if (!admission.admitted) {
      entry.texture.destroy();
      log.debug('RAM preview GPU frame cache skipped by runtime admission', {
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((rejected) => rejected.unit),
      });
      return false;
    }

    const existing = this.gpuFrameCache.get(key);
    if (existing) {
      existing.texture.destroy();
      releaseRamPreviewGpuFrameResource(key);
      this.gpuFrameCache.delete(key);
    }

    this.gpuFrameCache.set(key, entry);
    reportRamPreviewGpuFrame(report);

    // Evict oldest GPU cached frames if over limit
    while (this.gpuFrameCache.size > this.maxGpuCacheFrames) {
      if (!this.evictOldestGpuFrame()) break;
    }
    return true;
  }

  releaseCompositeRuntimeResources(): void {
    releaseRamPreviewCompositeCacheResource();
    releaseRamPreviewGpuFrameCacheResources();
  }

  // Clear composite cache
  clearCompositeCache(): void {
    this.compositeCache.clear();
    this.compositeCacheBytes = 0;
    releaseRamPreviewCompositeCacheResource();

    // Clear GPU frame cache - destroy textures to free VRAM
    for (const entry of this.gpuFrameCache.values()) {
      entry.texture.destroy();
    }
    this.gpuFrameCache.clear();
    releaseRamPreviewGpuFrameCacheResources();

    log.debug('Composite cache cleared');
  }

  // Clear all caches
  clearAll(): void {
    this.clearScrubbingCache();
    this.clearCompositeCache();

    // Clear last frame caches - destroy textures to free VRAM
    for (const texture of this.lastFrameTextures.values()) {
      texture.destroy();
    }
    this.lastFrameTextures.clear();
    this.lastFrameViews.clear();
    this.lastFrameSizes.clear();
    this.lastFrameMediaTimes.clear();
    this.lastFrameOwners = new WeakMap();
    this.lastCaptureTime.clear();
    this.lastPresentedFrameTimes = new WeakMap();
    this.lastPresentedFrameOwners = new WeakMap();

    log.debug('All caches cleared');
  }

  destroy(): void {
    this.clearAll();
  }
}
