import {
  frameIndexForTime,
  getScrubbingKey,
  getScrubbingKeyForFrame,
  getScrubbingKeyTime,
  SCRUB_CACHE_FPS,
} from './cacheKeys';
import { shouldStageHtmlVideoFrame } from '../videoFrameCopyPolicy';
import { ScrubRamCache } from './scrubRamCache';

type ScrubbingTextureEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  bytes: number;
};

export interface ScrubTextureCacheSnapshot {
  count: number;
  maxFrames: number;
  bytes: number;
  maxBytes: number;
  evictions: number;
}

export class ScrubTextureCache {
  private readonly device: GPUDevice;
  private readonly cache: Map<string, ScrubbingTextureEntry> = new Map();
  // Keep enough paused/scrub context for responsive seeking without allowing
  // discontinuous montage source ranges to consume most of the GPU budget.
  private readonly maxFrames = 192;
  private readonly maxBytes = 192 * 1024 * 1024;
  readonly maxDimension = 960;
  private bytes = 0;
  private evictions = 0;
  private allocations = 0;
  private reuses = 0;
  private releases = 0;
  private pendingCaptures = new Set<string>();
  private playbackCallbacks = new Map<HTMLVideoElement, () => void>();
  private readonly ram = new ScrubRamCache();
  private pendingUploads = new Map<string, ScrubbingTextureEntry>();
  private generation = 0;
  private lost = false;
  private gpuFailureLimit = Infinity;

  private readonly onChanged?: () => void;
  constructor(device: GPUDevice, onChanged?: () => void) {
    this.device = device; this.onChanged = onChanged;
    void device.lost?.then(() => { this.lost = true; this.clear(); });
  }

  setRamBudget(bytes: number): void {
    this.ram.setBudget(bytes);
    if (bytes === 0) for (const stop of this.playbackCallbacks.values()) stop();
    this.onChanged?.();
  }
  getRamSnapshot() { return this.ram.getSnapshot(); }

  hasFrame(videoSrc: string, frameIndex: number): boolean {
    const key = getScrubbingKeyForFrame(videoSrc, frameIndex);
    return this.cache.has(key) || this.ram.has(key) || this.pendingUploads.has(key);
  }

  // Rendering may reuse its layer data. Follow decoded frames and video restarts
  // directly, including temporary pauses while the playback sync code seeks.
  cachePlaybackFrame(video: HTMLVideoElement): void {
    if (this.lost || this.ram.getSnapshot().maxBytes === 0) return;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      if (!video.paused) this.capturePlaybackImage(video, video.currentTime);
      return;
    }
    if (this.playbackCallbacks.has(video)) return;
    let handle: number | undefined;
    const pause = () => {
      if (handle !== undefined) video.cancelVideoFrameCallback(handle);
      handle = undefined;
    };
    const start = () => {
      if (video.paused || handle !== undefined || this.lost || this.ram.getSnapshot().maxBytes === 0) return;
      handle = video.requestVideoFrameCallback((_now, metadata) => {
        handle = undefined;
        if (!video.paused && !this.lost && this.ram.getSnapshot().maxBytes > 0) {
          this.capturePlaybackImage(video, metadata.mediaTime);
          start();
        }
      });
    };
    this.playbackCallbacks.set(video, () => {
      pause();
      video.removeEventListener('pause', pause);
      video.removeEventListener('play', start);
      this.playbackCallbacks.delete(video);
    });
    video.addEventListener('pause', pause);
    video.addEventListener('play', start);
    start();
  }

  stopPlaybackCapture(video: HTMLVideoElement): void {
    this.playbackCallbacks.get(video)?.();
  }

  private capturePlaybackImage(video: HTMLVideoElement, time: number): void {
    // One conversion in flight: slow readback skips frames instead of queuing work.
    if (video.seeking || this.pendingCaptures.size > 0 || this.pendingUploads.size > 0) return;
    this.cacheFrameAtTime(video, time);
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number): void {
    if (video.videoWidth === 0 || video.readyState < 2) return;

    const target = this.computeSize(video.videoWidth, video.videoHeight);
    const needsDownscale = target.width !== video.videoWidth || target.height !== video.videoHeight;

    const shouldCreateBitmap =
      typeof createImageBitmap === 'function' &&
      (needsDownscale || shouldStageHtmlVideoFrame(video));

    if (!shouldCreateBitmap) {
      this.addFrameFromSource(video, video.src, time, video.videoWidth, video.videoHeight);
      return;
    }

    const videoSrc = video.src;
    if (!videoSrc) return;
    const key = getScrubbingKey(videoSrc, time);
    if (this.hasFrame(videoSrc, frameIndexForTime(time)) || this.pendingCaptures.has(key)) return;

    this.pendingCaptures.add(key);
    const generation = this.generation;
    const bitmapOptions = needsDownscale
      ? {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'medium' as const,
        }
      : undefined;
    void createImageBitmap(video, bitmapOptions)
      .then((bitmap) => {
        try {
          if (generation === this.generation && !this.lost) {
            this.addFrameFromSource(bitmap, videoSrc, time, bitmap.width, bitmap.height);
          }
        } finally { bitmap.close(); }
      })
      .catch(() => { /* frame unavailable - skip */ })
      .finally(() => {
        this.pendingCaptures.delete(key);
      });
  }

  addFrameFromSource(
    source: HTMLVideoElement | ImageBitmap,
    videoSrc: string,
    time: number,
    width: number,
    height: number,
    notify = true
  ): boolean {
    if (!videoSrc || width <= 0 || height <= 0 || this.lost) return false;

    const key = getScrubbingKey(videoSrc, time);
    if (this.cache.has(key)) {
      this.reuses += 1;
      return false;
    }

    const target = this.computeSize(width, height);
    this.ram.capture(key, source, target.width, target.height);
    const pixels = this.ram.get(key);
    // CPU pixels are already resized; direct fallback keeps its original geometry.
    return this.upload(key, pixels ?? source, pixels?.width ?? width, pixels?.height ?? height, notify);
  }

  /**
   * Background neighbour frames: the already resized bitmap goes straight to the
   * GPU, and its CPU copy is read back off the main thread. Takes ownership of
   * the bitmap.
   */
  addBackgroundFrame(bitmap: ImageBitmap, videoSrc: string, time: number, notify: boolean): boolean {
    if (!videoSrc || bitmap.width <= 0 || bitmap.height <= 0 || this.lost) { bitmap.close(); return false; }
    const key = getScrubbingKey(videoSrc, time);
    if (this.cache.has(key)) { this.reuses += 1; bitmap.close(); return false; }
    const uploaded = this.upload(key, bitmap, bitmap.width, bitmap.height, notify);
    this.ram.captureDetached(key, bitmap);
    return uploaded;
  }

  getCachedFrame(videoSrc: string, time: number): GPUTextureView | null {
    return this.getCachedFrameEntry(videoSrc, time)?.view ?? null;
  }

  getCachedFrameEntry(
    videoSrc: string,
    time: number
  ): { view: GPUTextureView; mediaTime: number } | null {
    const key = getScrubbingKey(videoSrc, time);
    const entry = this.cache.get(key);
    if (entry) {
      return this.touchEntry(key, entry);
    }
    const pixels = this.ram.get(key);
    if (pixels) this.upload(key, pixels, pixels.width, pixels.height);
    return null;
  }

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

    const baseFrame = frameIndexForTime(time);
    for (let distance = 1; distance <= maxDistanceFrames; distance++) {
      const previousKey = getScrubbingKey(videoSrc, (baseFrame - distance) / SCRUB_CACHE_FPS);
      const previous = this.cache.get(previousKey);
      if (previous) {
        return this.touchEntry(previousKey, previous);
      }

      const nextKey = getScrubbingKey(videoSrc, (baseFrame + distance) / SCRUB_CACHE_FPS);
      const next = this.cache.get(nextKey);
      if (next) {
        return this.touchEntry(nextKey, next);
      }
      for (const key of [previousKey, nextKey]) {
        const pixels = this.ram.get(key);
        if (pixels) { this.upload(key, pixels, pixels.width, pixels.height); return null; }
      }
    }

    return null;
  }

  getCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    if (!videoSrc) return [];

    const prefix = `${videoSrc}:`;
    const frameIndices = new Set<number>();
    for (const key of [...this.cache.keys(), ...this.ram.keys()]) {
      if (!key.startsWith(prefix)) continue;
      frameIndices.add(frameIndexForTime(getScrubbingKeyTime(key)));
    }

    if (frameIndices.size === 0) return [];

    const sorted = [...frameIndices].toSorted((a, b) => a - b);
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
      start: range.startFrame / SCRUB_CACHE_FPS,
      end: (range.endFrame + 1) / SCRUB_CACHE_FPS,
    }));
  }

  getSnapshot(): ScrubTextureCacheSnapshot {
    return {
      count: this.cache.size,
      maxFrames: this.maxFrames,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      evictions: this.evictions,
    };
  }

  clear(videoSrc?: string): void {
    this.generation++;
    for (const [video, stop] of this.playbackCallbacks) {
      if (videoSrc && video.src !== videoSrc) continue;
      stop();
    }
    this.pendingCaptures.clear();
    this.ram.clear(videoSrc);
    for (const [key, entry] of this.pendingUploads) {
      if (videoSrc && !key.startsWith(`${videoSrc}:`)) continue;
      entry.texture.destroy();
      this.pendingUploads.delete(key);
    }
    this.onChanged?.();
    if (videoSrc) {
      const prefix = `${videoSrc}:`;
      for (const key of [...this.cache.keys()]) {
        if (key.startsWith(prefix)) {
          const entry = this.cache.get(key);
          if (entry) {
            this.bytes -= entry.bytes;
            entry.texture.destroy();
            this.releases += 1;
          }
          this.cache.delete(key);
        }
      }
      return;
    }

    for (const entry of this.cache.values()) {
      entry.texture.destroy();
    }
    this.releases += this.cache.size;
    this.cache.clear();
    this.bytes = 0;
  }

  computeSize(width: number, height: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (longest <= this.maxDimension || longest <= 0) {
      return { width, height };
    }
    const scale = this.maxDimension / longest;
    const scaledWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
    const scaledHeight = Math.max(2, Math.round((height * scale) / 2) * 2);
    return { width: scaledWidth, height: scaledHeight };
  }

  private touchEntry(
    key: string,
    entry: ScrubbingTextureEntry
  ): { view: GPUTextureView; mediaTime: number } {
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.reuses += 1;
    return {
      view: entry.view,
      mediaTime: getScrubbingKeyTime(key),
    };
  }

  private evictIfNeeded(incoming = 0): void {
    const pendingBytes = [...this.pendingUploads.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (this.cache.size + this.pendingUploads.size >= this.maxFrames ||
      this.bytes + pendingBytes + incoming > Math.min(this.maxBytes, this.gpuFailureLimit)) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;

      const oldest = this.cache.get(oldestKey);
      if (oldest) {
        this.bytes -= oldest.bytes;
        this.evictions++;
        this.releases += 1;
        oldest.texture.destroy();
      }
      this.cache.delete(oldestKey);
    }
  }

  /** Publish textures only after WebGPU's asynchronous error scopes confirm success. */
  /** notify=false publishes silently: background neighbours do not change the displayed frame. */
  private upload(key: string, source: HTMLVideoElement | ImageBitmap | ImageData,
    width: number, height: number, notify = true): boolean {
    const bytes = width * height * 4;
    if (this.lost || this.pendingUploads.has(key) || this.pendingUploads.size >= 4 ||
      bytes > Math.min(this.maxBytes, this.gpuFailureLimit)) return false;
    this.evictIfNeeded(bytes);
    let entry: ScrubbingTextureEntry | undefined;
    let allocated: GPUTexture | undefined;
    this.device.pushErrorScope('out-of-memory');
    this.device.pushErrorScope('validation');
    try {
      const texture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      allocated = texture;
      entry = { texture, view: texture.createView(), bytes };
      if ('data' in source) {
        this.device.queue.writeTexture({ texture }, source.data as Uint8ClampedArray<ArrayBuffer>,
          { bytesPerRow: width * 4 }, [width, height]);
      } else {
        this.device.queue.copyExternalImageToTexture({ source }, { texture }, [width, height]);
      }
      this.pendingUploads.set(key, entry);
    } catch {
      allocated?.destroy();
      entry = undefined;
    }
    const candidate = entry;
    const scopes = [this.device.popErrorScope(), this.device.popErrorScope()];
    void Promise.all(scopes).then(([validation, memory]) => {
      if (!candidate || this.pendingUploads.get(key) !== candidate) return;
      this.pendingUploads.delete(key);
      if (validation || memory || this.lost || this.bytes + bytes > this.gpuFailureLimit) {
        candidate.texture.destroy();
        if (memory) {
          this.gpuFailureLimit = Math.floor(Math.min(this.maxBytes, this.gpuFailureLimit,
            this.bytes + bytes) * 0.75);
          this.evictIfNeeded();
        }
      } else {
        this.cache.set(key, candidate);
        this.bytes += bytes;
        this.allocations++;
      }
      if (notify || memory) this.onChanged?.();
    }).catch(() => {
      if (candidate && this.pendingUploads.get(key) === candidate) {
        this.pendingUploads.delete(key);
        candidate.texture.destroy();
      }
    });
    return !!candidate;
  }

  getRuntimeCacheSnapshot(): {
    entries: number;
    bytes: number;
    allocations: number;
    reuses: number;
    evictions: number;
    releases: number;
  } {
    return {
      entries: this.cache.size,
      bytes: this.bytes,
      allocations: this.allocations,
      reuses: this.reuses,
      evictions: this.evictions,
      releases: this.releases,
    };
  }
}
