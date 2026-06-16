import {
  frameIndexForTime,
  getScrubbingKey,
  getScrubbingKeyForFrame,
  getScrubbingKeyTime,
  SCRUB_CACHE_FPS,
} from './cacheKeys';

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
  private readonly maxFrames = 480;
  private readonly maxBytes = 1024 * 1024 * 1024;
  readonly maxDimension = 960;
  private bytes = 0;
  private evictions = 0;
  private allocations = 0;
  private reuses = 0;
  private releases = 0;
  private pendingCaptures = new Set<string>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  hasFrame(videoSrc: string, frameIndex: number): boolean {
    return this.cache.has(getScrubbingKeyForFrame(videoSrc, frameIndex));
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number): void {
    if (video.videoWidth === 0 || video.readyState < 2) return;

    const target = this.computeSize(video.videoWidth, video.videoHeight);
    const needsDownscale = target.width !== video.videoWidth || target.height !== video.videoHeight;

    if (!needsDownscale || typeof createImageBitmap !== 'function') {
      this.addFrameFromSource(video, video.src, time, video.videoWidth, video.videoHeight);
      return;
    }

    const videoSrc = video.src;
    if (!videoSrc) return;
    const key = getScrubbingKey(videoSrc, time);
    if (this.cache.has(key) || this.pendingCaptures.has(key)) return;

    this.pendingCaptures.add(key);
    void createImageBitmap(video, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'medium',
    })
      .then((bitmap) => {
        this.addFrameFromSource(bitmap, videoSrc, time, bitmap.width, bitmap.height);
        bitmap.close();
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
    height: number
  ): boolean {
    if (!videoSrc || width <= 0 || height <= 0) return false;

    const key = getScrubbingKey(videoSrc, time);
    if (this.cache.has(key)) {
      this.reuses += 1;
      return false;
    }

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
      this.cache.set(key, { texture, view: texture.createView(), bytes });
      this.bytes += bytes;
      this.allocations += 1;
      this.evictIfNeeded();
      return true;
    } catch {
      texture.destroy();
      return false;
    }
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
    }

    return null;
  }

  getCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    if (!videoSrc) return [];

    const prefix = `${videoSrc}:`;
    const frameIndices = new Set<number>();
    for (const key of this.cache.keys()) {
      if (!key.startsWith(prefix)) continue;
      frameIndices.add(frameIndexForTime(getScrubbingKeyTime(key)));
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

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxFrames || this.bytes > this.maxBytes) {
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
