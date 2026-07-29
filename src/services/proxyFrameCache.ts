// Proxy frame cache - loads and caches proxy image/video frames for fast playback
//
// This entry owns the cache maps and ALL mediaRuntime lease acquire/release
// call sites (object URLs, scrub audio elements/buffers/context). Pure cache
// operations, runtime-coordinator admission, preloading, scrub DSP, audio
// source resolution, and proxy video parsing live in src/services/proxyFrame/**.

import { Logger } from './logger';
import {
  mediaRuntimeObjectUrlLeaseOwner,
  toObjectUrlRuntimeSourceId,
} from './mediaRuntime/objectUrlLeases';
import {
  mediaRuntimeScrubAudioLeaseOwner,
  toScrubAudioRuntimeSourceId,
} from './mediaRuntime/scrubAudioLeases';
import type { RuntimeSourceId } from './mediaRuntime/types';
import type {
  CachedFrame,
  CachedVideoFrame,
  ProxyCachedFrame,
  ProxyCachedVideoFrame,
} from './proxyFrame/frameCacheModels';
import {
  canRetainAudioBufferResource,
  canRetainAudioProxyElement,
  logRuntimeAdmissionSkip,
  releaseAudioBufferRuntimeResource,
  releaseAudioProxyElementResource,
  reportAudioProxyElement,
  retainAudioBufferResource,
} from './proxyFrame/frameCacheRuntime';
import {
  addLegacyFrameToCache,
  addVideoFrameToCacheMap,
  clearAllFrameCaches,
  clearFrameCachesForMedia,
  collectCachedMediaIds,
  computeProxyCachedRanges,
  evictOldestLegacyFrame,
  evictOldestVideoFrameFromMap,
  findNearestCachedEntry,
  getProxyFrameCacheKey,
  logFrameCachePerformance,
  lookupCachedEntry,
  MAX_LEGACY_FRAME_CACHE_SIZE,
  resolveWithLoadingMap,
  touchCachedEntry,
} from './proxyFrame/frameCacheOps';
import {
  canWarmScrubAudioBuffer,
  createAudioBufferLoadState,
  deferScrubAudioBufferWarmup,
  enforceAudioBufferCacheLimit,
  loadAudioBufferForScrub,
  touchAudioBufferCacheEntry,
} from './proxyFrame/audioBufferLoader';
import {
  resolveAudioProxySrc,
  waitForAudioProxyReady,
} from './proxyFrame/audioProxyLoader';
import {
  decodeProxyVideoFrame,
  fetchProxyFrameBlob,
  type ProxyVideoSourcePromises,
} from './proxyFrame/proxyStorageSources';
import {
  createProxyFramePreloadState,
  enqueueProxyFramesAroundPosition,
  preloadAllProxyFrames,
  processProxyFramePreloadQueue,
  scheduleProxyFramePreload,
  SCRUB_PRELOAD_RANGE,
  updateProxyFrameScrubDirection,
} from './proxyFrame/preloadScheduler';
import { ScrubAudioPlaybackController } from './proxyFrame/scrubAudioPlayback';
import type { ScrubAudioOptions } from './proxyFrame/scrubAudioModels';
import type { AudioMeterSnapshot } from '../types';
export type { ProxyCachedFrame, ProxyCachedVideoFrame } from './proxyFrame/frameCacheModels';

const log = Logger.create('ProxyFrameCache');

const JPEG_PROXY_FRAMES_ENABLED = true;

class ProxyFrameCache {
  private cache: Map<string, CachedFrame> = new Map();
  private videoFrameCache: Map<string, CachedVideoFrame> = new Map();
  private loadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
  private videoFrameLoadingPromises: Map<string, Promise<VideoFrame | null>> = new Map();
  private proxyVideoSourcePromises: ProxyVideoSourcePromises = new Map();
  private readonly preloadState = createProxyFramePreloadState();
  private readonly scrubPlayback = new ScrubAudioPlaybackController(
    () => this.resetScrubState(),
    (message) => log.debug(message),
  );
  private objectUrlLeaseSequence = 0;
  private scrubAudioLeaseSequence = 0;

  // Audio proxy cache
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private audioLoadingPromises: Map<string, Promise<HTMLAudioElement | null>> = new Map();
  private ownedAudioUrlLeaseIds = new Map<string, RuntimeSourceId>();

  // Audio buffer cache for instant scrubbing (Web Audio API)
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private readonly audioBufferLoadState = createAudioBufferLoadState();
  private readonly suspendedAudioBufferMediaIds = new Set<string>();
  private audioContext: AudioContext | null = null;

  // Cache hit/miss tracking
  private readonly hitStats = { hits: 0, misses: 0 };

  // Test-visible forwarding accessors for the shared preload scheduler state.
  get preloadQueue(): string[] { return this.preloadState.preloadQueue; }
  set preloadQueue(value: string[]) { this.preloadState.preloadQueue = value; }
  get isPreloading(): boolean { return this.preloadState.isPreloading; }
  set isPreloading(value: boolean) { this.preloadState.isPreloading = value; }
  get lastScrubFrame(): number { return this.preloadState.lastScrubFrame; }
  set lastScrubFrame(value: number) { this.preloadState.lastScrubFrame = value; }
  get scrubDirection(): number { return this.preloadState.scrubDirection; }
  set scrubDirection(value: number) { this.preloadState.scrubDirection = value; }
  get isScrubbing(): boolean { return this.preloadState.isScrubbing; }
  set isScrubbing(value: boolean) { this.preloadState.isScrubbing = value; }
  get scrubPreloadQueueDrops(): number { return this.preloadState.scrubPreloadQueueDrops; }
  set scrubPreloadQueueDrops(value: number) { this.preloadState.scrubPreloadQueueDrops = value; }
  get scrubIsActive(): boolean { return this.scrubPlayback.isActive; }

  // ============================================
  // MEDIA RUNTIME LEASES (object URLs, scrub audio)
  // All lease acquire/release call sites stay in this entry module.
  // ============================================

  private nextObjectUrlRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
    this.objectUrlLeaseSequence += 1;
    return toObjectUrlRuntimeSourceId(`${ownerId}:${this.objectUrlLeaseSequence}`, type);
  }

  private nextScrubAudioRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
    this.scrubAudioLeaseSequence += 1;
    return toScrubAudioRuntimeSourceId(`${ownerId}:${this.scrubAudioLeaseSequence}`, type);
  }

  private acquireObjectUrl(
    runtimeSourceId: RuntimeSourceId,
    ownerId: string,
    blob: Blob
  ): string {
    const lease = mediaRuntimeObjectUrlLeaseOwner.acquire({
      runtimeSourceId,
      ownerId,
      blob,
      policy: 'interactive',
    });
    const url = lease.getRuntimeHandles()?.url;
    if (!url) {
      throw new Error('Object URL lease did not acquire a URL');
    }
    return url;
  }

  private releaseObjectUrl(runtimeSourceId: RuntimeSourceId, reason: string): void {
    mediaRuntimeObjectUrlLeaseOwner.release(runtimeSourceId, reason);
  }

  private acquireLegacyFrameObjectUrl(
    mediaFileId: string,
    frameIndex: number,
    blob: Blob
  ): { runtimeSourceId: RuntimeSourceId; url: string } {
    const runtimeSourceId = this.nextObjectUrlRuntimeSourceId(
      `proxy-frame-cache:${mediaFileId}:${frameIndex}`,
      'legacy-frame-image'
    );
    return {
      runtimeSourceId,
      url: this.acquireObjectUrl(
        runtimeSourceId,
        `proxy-frame-cache:${mediaFileId}:legacy-frame:${frameIndex}`,
        blob
      ),
    };
  }

  private acquireAudioProxyObjectUrl(mediaFileId: string, audioFile: Blob): string {
    const runtimeSourceId = this.nextObjectUrlRuntimeSourceId(
      `proxy-frame-cache:${mediaFileId}`,
      'audio-proxy'
    );
    const url = this.acquireObjectUrl(
      runtimeSourceId,
      `proxy-frame-cache:${mediaFileId}:audio-proxy`,
      audioFile
    );
    this.ownedAudioUrlLeaseIds.set(url, runtimeSourceId);
    return url;
  }

  private releaseOwnedAudioObjectUrl(src: string, reason: string): void {
    const runtimeSourceId = this.ownedAudioUrlLeaseIds.get(src);
    if (!runtimeSourceId) return;
    this.releaseObjectUrl(runtimeSourceId, reason);
    this.ownedAudioUrlLeaseIds.delete(src);
  }

  private getScrubAudioContextRuntimeSourceId(): RuntimeSourceId {
    return toScrubAudioRuntimeSourceId('proxy-frame-cache', 'audio-context');
  }

  private getScrubAudioBufferRuntimeSourceId(mediaFileId: string): RuntimeSourceId {
    return toScrubAudioRuntimeSourceId(`proxy-frame-cache:${mediaFileId}`, 'audio-buffer');
  }

  private createAudioProxyElement(mediaFileId: string): HTMLAudioElement {
    const lease = mediaRuntimeScrubAudioLeaseOwner.acquireAudioElement({
      runtimeSourceId: this.nextScrubAudioRuntimeSourceId(
        `proxy-frame-cache:${mediaFileId}`,
        'audio-proxy-element'
      ),
      ownerId: `proxy-frame-cache:${mediaFileId}:audio-proxy-element`,
      policy: 'interactive',
    });
    const audio = lease.getRuntimeHandles()?.element;
    if (!audio) {
      throw new Error('Scrub audio element lease did not acquire an element');
    }
    return audio;
  }

  private cacheDecodedAudioBuffer(mediaFileId: string, buffer: AudioBuffer): boolean {
    if (this.suspendedAudioBufferMediaIds.has(mediaFileId)) {
      return false;
    }
    const admission = canRetainAudioBufferResource(mediaFileId, buffer);
    if (!admission.admitted) {
      logRuntimeAdmissionSkip('Skipped decoded audio buffer cache retention due to runtime budget', {
        mediaFileId,
      }, admission);
      return false;
    }

    mediaRuntimeScrubAudioLeaseOwner.trackAudioBuffer({
      runtimeSourceId: this.getScrubAudioBufferRuntimeSourceId(mediaFileId),
      ownerId: `proxy-frame-cache:${mediaFileId}:audio-buffer`,
      buffer,
      mediaFileId,
      policy: 'interactive',
    });
    touchAudioBufferCacheEntry(this.audioBufferCache, mediaFileId, buffer);
    retainAudioBufferResource(mediaFileId, buffer);
    enforceAudioBufferCacheLimit(
      this.audioBufferCache,
      (id) => this.releaseAudioBufferResource(id),
      (id) => this.deferScrubAudioBufferWarmup(id, 'decoded audio buffer evicted from cache')
    );
    return true;
  }

  private deferScrubAudioBufferWarmup(mediaFileId: string, reason: string): void {
    deferScrubAudioBufferWarmup(this.audioBufferLoadState, mediaFileId, reason);
  }

  private releaseAudioBufferResource(mediaFileId: string): void {
    releaseAudioBufferRuntimeResource(mediaFileId);
    mediaRuntimeScrubAudioLeaseOwner.releaseAudioBuffer(
      this.getScrubAudioBufferRuntimeSourceId(mediaFileId),
      `proxy-frame-cache:${mediaFileId}:release-audio-buffer`
    );
  }

  private disposeAudioProxyElement(mediaFileId: string, audio: HTMLAudioElement): void {
    const src = mediaRuntimeScrubAudioLeaseOwner.releaseAudioElement(
      audio,
      `proxy-frame-cache:${mediaFileId}:dispose-audio-proxy`
    );
    if (src) {
      this.releaseOwnedAudioObjectUrl(src, `proxy-frame-cache:${mediaFileId}:dispose-audio-proxy`);
    }
    this.audioCache.delete(mediaFileId);
    releaseAudioProxyElementResource(mediaFileId);
  }

  // ============================================
  // FRAME CACHE (legacy JPEG images + WebCodecs VideoFrames)
  // ============================================

  // Synchronously get a frame if it's already in memory cache
  // Also triggers preloading of upcoming frames (even if current frame not cached)
  getCachedFrame(mediaFileId: string, frameIndex: number, fps: number = 30): HTMLImageElement | null {
    if (!JPEG_PROXY_FRAMES_ENABLED) return null;

    // ALWAYS trigger preloading, even if current frame isn't cached
    // This ensures nested composition frames get preloaded when playhead enters them
    this.schedulePreload(mediaFileId, frameIndex, fps);

    const cached = lookupCachedEntry(this.cache, getProxyFrameCacheKey(mediaFileId, frameIndex), this.hitStats);
    return cached?.image ?? null;
  }

  // Get nearest cached frame for scrubbing fallback
  getNearestCachedFrame(mediaFileId: string, frameIndex: number, maxDistance: number = 30): HTMLImageElement | null {
    return this.getNearestCachedFrameEntry(mediaFileId, frameIndex, maxDistance)?.image ?? null;
  }

  getNearestCachedFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedFrame | null {
    if (!JPEG_PROXY_FRAMES_ENABLED) return null;
    const entry = findNearestCachedEntry(this.cache, mediaFileId, frameIndex, maxDistance, this.scrubDirection >= 0);
    return entry ? { frameIndex: entry.frameIndex, image: entry.image } : null;
  }

  getCachedVideoFrame(mediaFileId: string, frameIndex: number): VideoFrame | null {
    this.updateScrubDirection(frameIndex);
    const cached = lookupCachedEntry(this.videoFrameCache, getProxyFrameCacheKey(mediaFileId, frameIndex), this.hitStats);
    return cached?.frame ?? null;
  }

  getNearestCachedVideoFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedVideoFrame | null {
    const entry = findNearestCachedEntry(this.videoFrameCache, mediaFileId, frameIndex, maxDistance, this.scrubDirection >= 0);
    return entry ? { frameIndex: entry.frameIndex, frame: entry.frame } : null;
  }

  async getVideoFrame(mediaFileId: string, time: number, fps: number = 30): Promise<VideoFrame | null> {
    const frameIndex = Math.floor(time * fps);
    this.updateScrubDirection(frameIndex);
    const key = getProxyFrameCacheKey(mediaFileId, frameIndex);

    const cached = touchCachedEntry(this.videoFrameCache, key);
    if (cached) return cached.frame;

    return resolveWithLoadingMap(
      this.videoFrameLoadingPromises,
      key,
      () => decodeProxyVideoFrame(this.proxyVideoSourcePromises, mediaFileId, frameIndex),
      (frame) => (this.addVideoFrameToCache(mediaFileId, frameIndex, frame) ? frame : null),
    );
  }

  private addVideoFrameToCache(mediaFileId: string, frameIndex: number, frame: VideoFrame): boolean {
    return addVideoFrameToCacheMap(this.videoFrameCache, mediaFileId, frameIndex, frame);
  }

  // Test-visible compat delegation.
  evictOldestVideoFrame(): void {
    evictOldestVideoFrameFromMap(this.videoFrameCache);
  }

  // Get a frame from cache or load it
  async getFrame(mediaFileId: string, time: number, fps: number = 30): Promise<HTMLImageElement | null> {
    if (!JPEG_PROXY_FRAMES_ENABLED) return null;
    const frameIndex = Math.floor(time * fps);
    const key = getProxyFrameCacheKey(mediaFileId, frameIndex);

    // Check cache first
    const cached = touchCachedEntry(this.cache, key);
    if (cached) return cached.image;

    return resolveWithLoadingMap(
      this.loadingPromises,
      key,
      () => this.loadFrame(mediaFileId, frameIndex),
      (image) => {
        this.addToCache(mediaFileId, frameIndex, image);
        // Trigger preload of upcoming frames
        this.schedulePreload(mediaFileId, frameIndex, fps);
        return image;
      },
    );
  }

  // Load a single frame as an image element via a short-lived object URL lease
  private async loadFrame(mediaFileId: string, frameIndex: number): Promise<HTMLImageElement | null> {
    try {
      const blob = await fetchProxyFrameBlob(mediaFileId, frameIndex);
      if (!blob) return null;

      // Create image from blob
      const { runtimeSourceId, url } = this.acquireLegacyFrameObjectUrl(
        mediaFileId,
        frameIndex,
        blob
      );
      const image = new Image();

      return new Promise((resolve) => {
        image.onload = () => {
          this.releaseObjectUrl(runtimeSourceId, `proxy-frame-cache:${mediaFileId}:legacy-frame-loaded`);
          resolve(image);
        };
        image.onerror = () => {
          this.releaseObjectUrl(runtimeSourceId, `proxy-frame-cache:${mediaFileId}:legacy-frame-error`);
          resolve(null);
        };
        image.src = url;
      });
    } catch (e) {
      log.warn('Failed to load frame', e);
      return null;
    }
  }

  // Add frame to cache
  private addToCache(mediaFileId: string, frameIndex: number, image: HTMLImageElement): boolean {
    return addLegacyFrameToCache(this.cache, mediaFileId, frameIndex, image);
  }

  // Evict oldest frame from cache (LRU). Test-visible compat delegation.
  evictOldest(): void {
    evictOldestLegacyFrame(this.cache);
  }

  // ============================================
  // PRELOADING
  // ============================================

  private preloadBindings() {
    return {
      state: this.preloadState,
      getKey: getProxyFrameCacheKey,
      hasCachedFrame: (key: string) => this.cache.has(key),
      loadFrame: (id: string, frame: number) => this.loadFrame(id, frame),
      addToCache: (id: string, frame: number, image: HTMLImageElement) => {
        this.addToCache(id, frame, image);
      },
      startPreloading: () => {
        void this.processPreloadQueue();
      },
    };
  }

  // Schedule preloading of frames around current position (bidirectional)
  private schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number) {
    scheduleProxyFramePreload({ ...this.preloadBindings(), mediaFileId, currentFrameIndex, fps });
  }

  private updateScrubDirection(currentFrameIndex: number): void {
    updateProxyFrameScrubDirection(this.preloadState, currentFrameIndex);
  }

  // Call this when scrubbing stops to reset state
  resetScrubState(): void {
    this.preloadState.isScrubbing = false;
    this.preloadState.scrubDirection = 0;
    this.preloadState.lastScrubFrame = -1;
  }

  // Process preload queue with parallel loading for speed
  private async processPreloadQueue() {
    await processProxyFramePreloadQueue(this.preloadBindings());
  }

  // Bulk preload frames around a position - call when scrubbing starts
  async preloadAroundPosition(mediaFileId: string, frameIndex: number, _fps: number = 30, range: number = SCRUB_PRELOAD_RANGE): Promise<void> {
    enqueueProxyFramesAroundPosition({
      ...this.preloadBindings(),
      mediaFileId,
      frameIndex,
      range,
      logDebug: (message) => log.debug(message),
    });
  }

  // Preload ALL frames for a media file (for manual cache button)
  async preloadAllFrames(
    mediaFileId: string,
    totalFrames: number,
    _fps: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    await preloadAllProxyFrames({
      ...this.preloadBindings(),
      mediaFileId,
      totalFrames,
      onProgress,
      logInfo: (message) => log.info(message),
    });
  }

  // Cancel ongoing preload (for when user clicks stop or navigates away)
  cancelPreload(): void {
    this.preloadQueue = [];
    log.debug('Preload cancelled');
  }

  // ============================================
  // AUDIO PROXY METHODS
  // ============================================

  /**
   * Get cached audio proxy element, or load it if not cached
   * Returns null if no audio proxy exists
   */
  async getAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    // Check cache first
    const cached = this.audioCache.get(mediaFileId);
    if (cached) {
      return cached;
    }

    return resolveWithLoadingMap(
      this.audioLoadingPromises,
      mediaFileId,
      () => this.loadAudioProxy(mediaFileId),
      (audio) => {
        this.audioCache.set(mediaFileId, audio);
        return audio;
      },
    );
  }

  /**
   * Get cached audio proxy synchronously (returns null if not yet loaded)
   */
  getCachedAudioProxy(mediaFileId: string): HTMLAudioElement | null {
    return this.audioCache.get(mediaFileId) || null;
  }

  releaseAudioProxy(mediaFileId: string): void {
    const audio = this.audioCache.get(mediaFileId);
    if (audio) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }
  }

  /**
   * Preload audio proxy for a media file
   */
  async preloadAudioProxy(mediaFileId: string): Promise<void> {
    // Just call getAudioProxy which handles caching
    await this.getAudioProxy(mediaFileId);
  }

  /**
   * Load audio proxy from project folder
   */
  private async loadAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    let audioSrc: string | undefined;
    try {
      const resolvedSrc = await resolveAudioProxySrc(mediaFileId, (audioFile) =>
        this.acquireAudioProxyObjectUrl(mediaFileId, audioFile)
      );
      if (!resolvedSrc) {
        return null;
      }
      audioSrc = resolvedSrc;

      const admission = canRetainAudioProxyElement(mediaFileId, audioSrc);
      if (!admission.admitted) {
        logRuntimeAdmissionSkip('Skipped audio proxy element retention due to runtime budget', {
          mediaFileId,
        }, admission);
        this.releaseOwnedAudioObjectUrl(audioSrc, `proxy-frame-cache:${mediaFileId}:audio-proxy-rejected`);
        return null;
      }

      // Create audio element with object URL and wait for it to be ready
      const audio = this.createAudioProxyElement(mediaFileId);
      audio.src = audioSrc;
      audio.preload = 'auto';
      await waitForAudioProxyReady(audio);

      reportAudioProxyElement(mediaFileId, audio);
      log.info(`Audio proxy loaded for ${mediaFileId}`);
      return audio;
    } catch (e) {
      log.warn(`Failed to load audio proxy for ${mediaFileId}`, e);
      if (audioSrc) {
        this.releaseOwnedAudioObjectUrl(audioSrc, `proxy-frame-cache:${mediaFileId}:audio-proxy-error`);
      }
      releaseAudioProxyElementResource(mediaFileId);
      return null;
    }
  }

  // ============================================
  // GRANULAR AUDIO SCRUBBING (Web Audio API)
  // ============================================

  /**
   * Get or create AudioContext for scrubbing
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const lease = mediaRuntimeScrubAudioLeaseOwner.acquireAudioContext({
        runtimeSourceId: this.getScrubAudioContextRuntimeSourceId(),
        ownerId: 'proxy-frame-cache:scrub-audio-context',
        policy: 'interactive',
      });
      const audioContext = lease.getRuntimeHandles()?.context;
      if (!audioContext) {
        throw new Error('Scrub audio context lease did not acquire a context');
      }
      this.audioContext = audioContext;
      this.scrubPlayback.initializeAudioContext(this.audioContext);
      log.debug(`AudioContext created, state: ${this.audioContext.state}`);
    }
    return this.audioContext;
  }

  /**
   * Ensure AudioContext is running - MUST be called from a user gesture (mousedown/click).
   * Chrome's autoplay policy requires resume() from a user gesture to unlock audio.
   * IMPORTANT: Do NOT close/replace the AudioContext here - that kills pending decodeAudioData()
   * calls which permanently blacklists audio files. Just resume() - Chrome honors it from gestures.
   */
  ensureAudioContextResumed(): void {
    if (!this.audioContext) {
      // Create fresh context in user gesture → starts "running" automatically
      this.getAudioContext();
      log.debug(`AudioContext created in user gesture, state: ${this.audioContext!.state}`);
      return;
    }

    if (this.audioContext.state === 'suspended') {
      // resume() from a user gesture is always honored by Chrome
      // Don't check synchronously after - resume() is async but Chrome will process it
      this.audioContext.resume().then(() => {
        log.debug(`AudioContext resumed: ${this.audioContext?.state}`);
      }).catch(() => {
        log.warn('AudioContext resume failed');
      });
    }
  }

  /**
   * Get AudioBuffer for a media file (decode on first request)
   * Works with BOTH proxy audio AND original video files
   */
  async getAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
    if (this.suspendedAudioBufferMediaIds.has(mediaFileId)) {
      return null;
    }
    // Check cache
    const cached = this.audioBufferCache.get(mediaFileId);
    if (cached) {
      touchAudioBufferCacheEntry(this.audioBufferCache, mediaFileId, cached);
      return cached;
    }

    return loadAudioBufferForScrub({
      state: this.audioBufferLoadState,
      mediaFileId,
      videoElementSrc,
      getAudioContext: () => this.getAudioContext(),
      cacheDecodedAudioBuffer: (id, buffer) => this.cacheDecodedAudioBuffer(id, buffer),
      onDecodedAudioBufferNotRetained: (id) =>
        this.deferScrubAudioBufferWarmup(id, 'decoded audio buffer was not retained'),
    });
  }

  /**
   * Opportunistically warm a decoded buffer for varispeed scrub audio.
   * Demand callers (stem mixer/export/scrub playback) should use getAudioBuffer().
   */
  async warmScrubAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
    const cached = this.audioBufferCache.get(mediaFileId);
    if (cached) {
      touchAudioBufferCacheEntry(this.audioBufferCache, mediaFileId, cached);
      return cached;
    }

    if (!canWarmScrubAudioBuffer(this.audioBufferLoadState, mediaFileId)) {
      return null;
    }

    return this.getAudioBuffer(mediaFileId, videoElementSrc);
  }

  /**
   * Granular scrub audio - call continuously while dragging the playhead.
   * Short overlapping, pitch-stable grains avoid the gated/stalled sound of
   * one long buffer source and allow backward scrub feedback.
   */
  playScrubAudio(
    mediaFileId: string,
    targetTime: number,
    _duration: number = 0.15,
    videoElementSrc?: string,
    options?: ScrubAudioOptions
  ): void {
    const buffer = this.audioBufferCache.get(mediaFileId);
    if (!buffer) {
      log.debug(`No AudioBuffer for ${mediaFileId} - loading...`);
      this.getAudioBuffer(mediaFileId, videoElementSrc);
      return;
    }

    this.scrubPlayback.playScrubAudio({
      mediaFileId,
      targetTime,
      buffer,
      getAudioContext: () => this.getAudioContext(),
      options,
    });
  }

  /**
   * Stop scrub audio - call when scrubbing ends
   */
  stopScrubAudio(options: { keepMotionTracking?: boolean } = {}): void {
    this.scrubPlayback.stopScrubAudio(options);
  }

  getScrubMeterSnapshot(updatedAt = performance.now()): AudioMeterSnapshot | null {
    return this.scrubPlayback.getScrubMeterSnapshot(updatedAt);
  }

  /**
   * Check if audio buffer is ready for instant scrubbing
   */
  hasAudioBuffer(mediaFileId: string): boolean {
    return this.audioBufferCache.has(mediaFileId);
  }

  getCachedAudioBuffer(mediaFileId: string): AudioBuffer | null {
    const cached = this.audioBufferCache.get(mediaFileId);
    if (!cached) return null;
    touchAudioBufferCacheEntry(this.audioBufferCache, mediaFileId, cached);
    return cached;
  }

  /**
   * Prevent a full-source decoded buffer from being recreated while an export
   * is using byte-ranged clip audio. This also blocks an already-running warmup
   * from committing its decoded result after the export has started.
   */
  suspendDecodedAudioBuffer(mediaFileId: string): void {
    this.suspendedAudioBufferMediaIds.add(mediaFileId);
    const cached = this.audioBufferCache.get(mediaFileId);
    if (cached) {
      this.audioBufferCache.delete(mediaFileId);
      this.releaseAudioBufferResource(mediaFileId);
    }
  }

  resumeDecodedAudioBuffer(mediaFileId: string): void {
    this.suspendedAudioBufferMediaIds.delete(mediaFileId);
    this.audioBufferLoadState.nextAllowedWarmAt.delete(mediaFileId);
    this.audioBufferLoadState.warmBackoffLogged.delete(mediaFileId);
  }

  /**
   * Release one decoded PCM buffer without disturbing the media's frame or
   * proxy-element caches. Long exports call this after trimming their source
   * into clip-sized buffers so the full source cannot keep ~GB of heap alive.
   */
  releaseCachedAudioBuffer(mediaFileId: string, expectedBuffer?: AudioBuffer): boolean {
    const cached = this.audioBufferCache.get(mediaFileId);
    if (!cached || (expectedBuffer && cached !== expectedBuffer)) {
      return false;
    }

    this.audioBufferCache.delete(mediaFileId);
    this.releaseAudioBufferResource(mediaFileId);
    this.deferScrubAudioBufferWarmup(
      mediaFileId,
      'decoded audio buffer released after export source trimming'
    );
    return true;
  }

  // ============================================
  // CLEAR / DISPOSE / STATS
  // ============================================

  // Clear cache for a specific media file
  clearForMedia(mediaFileId: string) {
    clearFrameCachesForMedia(this.cache, this.videoFrameCache, mediaFileId);
    this.preloadQueue = this.preloadQueue.filter((k) => !k.startsWith(mediaFileId + '_'));
    this.proxyVideoSourcePromises.delete(mediaFileId);

    // Also clear audio cache
    const audio = this.audioCache.get(mediaFileId);
    if (audio) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }

    this.audioBufferCache.delete(mediaFileId);
    this.releaseAudioBufferResource(mediaFileId);
    this.audioBufferLoadState.failed.delete(mediaFileId);
    this.audioBufferLoadState.retryTime.delete(mediaFileId);
    this.audioBufferLoadState.nextAllowedWarmAt.delete(mediaFileId);
    this.audioBufferLoadState.warmBackoffLogged.delete(mediaFileId);
    this.suspendedAudioBufferMediaIds.delete(mediaFileId);
  }

  // Clear entire cache
  clearAll() {
    clearAllFrameCaches(this.cache, this.videoFrameCache);
    this.videoFrameLoadingPromises.clear();
    this.proxyVideoSourcePromises.clear();
    this.preloadQueue = [];

    // Clear audio cache
    for (const [mediaFileId, audio] of Array.from(this.audioCache.entries())) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }
    this.audioCache.clear();
    this.ownedAudioUrlLeaseIds.clear();

    this.releaseAllAudioBuffers();
    this.suspendedAudioBufferMediaIds.clear();

    // Clean up audio context
    this.disposeAudioContext();
  }

  private releaseAllAudioBuffers(): void {
    const audioBufferMediaIds = Array.from(this.audioBufferCache.keys());
    this.audioBufferCache.clear();
    for (const mediaFileId of audioBufferMediaIds) {
      this.releaseAudioBufferResource(mediaFileId);
    }
  }

  clearAudioBufferCache(): void {
    this.releaseAllAudioBuffers();
    this.audioBufferLoadState.failed.clear();
    this.audioBufferLoadState.retryTime.clear();
    this.audioBufferLoadState.nextAllowedWarmAt.clear();
    this.audioBufferLoadState.warmBackoffLogged.clear();
    this.audioBufferLoadState.loading.clear();
    this.suspendedAudioBufferMediaIds.clear();
  }

  /**
   * Dispose the AudioContext used for scrub audio.
   * Stops active scrub audio, closes the context, and resets state.
   */
  disposeAudioContext(): void {
    // Stop any active scrub audio first
    this.stopScrubAudio();

    // Close the AudioContext
    if (this.audioContext) {
      mediaRuntimeScrubAudioLeaseOwner.releaseAudioContext(
        this.getScrubAudioContextRuntimeSourceId(),
        'proxy-frame-cache:dispose-audio-context'
      );
    }
    this.audioContext = null;
    this.scrubPlayback.disposeAudioContextState();

    // Clear audio buffer cache (buffers are tied to the old context)
    this.releaseAllAudioBuffers();
    this.audioBufferLoadState.failed.clear();
    this.audioBufferLoadState.retryTime.clear();
    this.audioBufferLoadState.nextAllowedWarmAt.clear();
    this.audioBufferLoadState.warmBackoffLogged.clear();

    log.info('AudioContext disposed');
  }

  // Get cache stats with more detail
  getStats() {
    return {
      cachedFrames: this.cache.size,
      maxCacheSize: MAX_LEGACY_FRAME_CACHE_SIZE,
      preloadQueueSize: this.preloadQueue.length,
      isPreloading: this.isPreloading,
      isScrubbing: this.isScrubbing,
      scrubDirection: this.scrubDirection,
      scrubPreloadQueueDrops: this.scrubPreloadQueueDrops,
      hitRate: this.hitStats.hits / Math.max(1, this.hitStats.hits + this.hitStats.misses),
    };
  }

  // Log cache performance (call periodically for debugging)
  logPerformance(): void {
    logFrameCachePerformance({
      ...this.hitStats,
      cachedFrames: this.cache.size,
      preloadQueueSize: this.preloadQueue.length,
    });
  }

  // Reset performance counters
  resetPerformanceCounters(): void {
    this.hitStats.hits = 0;
    this.hitStats.misses = 0;
  }

  // Get cached frame ranges for a specific media file (for timeline display)
  // Returns ranges in seconds relative to media file start
  getCachedRanges(mediaFileId: string, fps: number = 30): Array<{ start: number; end: number }> {
    return computeProxyCachedRanges(this.cache, this.videoFrameCache, mediaFileId, fps);
  }

  // Get all cached media file IDs
  getCachedMediaIds(): string[] {
    return collectCachedMediaIds(this.cache);
  }
}

// Singleton instance
export const proxyFrameCache = new ProxyFrameCache();

// Global user interaction listener to unlock AudioContext as early as possible.
// Chrome requires a user gesture to start/resume AudioContext.
// This fires on the FIRST interaction with the page (any click, key, touch).
if (typeof document !== 'undefined') {
  const unlockAudio = () => {
    proxyFrameCache.ensureAudioContextResumed();
    document.removeEventListener('mousedown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('mousedown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('touchstart', unlockAudio, { capture: true });
}
