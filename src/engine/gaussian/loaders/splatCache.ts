// LRU cache of parsed gaussian splat assets, keyed by mediaFileId.
//
// Tracks total GPU-relevant memory usage from Float32Array buffers.
// On eviction, nulls out frame buffer data but preserves metadata.

import { Logger } from '../../../services/logger.ts';
import type { GaussianSplatAsset } from './types.ts';

const log = Logger.create('SplatCache');

/** Default max cache size: 512 MB */
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

interface CacheEntry {
  mediaFileId: string;
  asset: GaussianSplatAsset;
  byteSize: number;
  lastAccessed: number;
}

class SplatCacheImpl {
  private entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private maxBytes: number;

  constructor(maxBytes: number = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** Get a cached asset by mediaFileId. Updates access time. */
  get(mediaFileId: string): GaussianSplatAsset | null {
    const entry = this.entries.get(mediaFileId);
    if (!entry) return null;

    // Update LRU access time
    entry.lastAccessed = performance.now();
    return entry.asset;
  }

  /** Store a parsed asset in the cache. Evicts LRU entries if needed. */
  put(mediaFileId: string, asset: GaussianSplatAsset): void {
    // If already cached, remove old entry first
    if (this.entries.has(mediaFileId)) {
      this.remove(mediaFileId);
    }

    const byteSize = this.computeAssetBytes(asset);

    // Evict until we have room
    while (this.totalBytes + byteSize > this.maxBytes && this.entries.size > 0) {
      this.evictLRU();
    }

    // If a single asset exceeds the entire cache, log a warning but still cache it
    if (byteSize > this.maxBytes) {
      log.warn('Asset exceeds max cache size, caching anyway', {
        mediaFileId,
        assetMB: (byteSize / (1024 * 1024)).toFixed(1),
        maxMB: (this.maxBytes / (1024 * 1024)).toFixed(0),
      });
    }

    this.entries.set(mediaFileId, {
      mediaFileId,
      asset,
      byteSize,
      lastAccessed: performance.now(),
    });
    this.totalBytes += byteSize;

    log.debug('Cached asset', {
      mediaFileId,
      splatCount: asset.metadata.splatCount,
      assetMB: (byteSize / (1024 * 1024)).toFixed(1),
      totalCacheMB: (this.totalBytes / (1024 * 1024)).toFixed(1),
      entries: this.entries.size,
    });
  }

  /** Remove a specific entry from the cache. */
  remove(mediaFileId: string): boolean {
    const entry = this.entries.get(mediaFileId);
    if (!entry) return false;

    this.totalBytes -= entry.byteSize;
    this.entries.delete(mediaFileId);

    log.debug('Removed from cache', { mediaFileId });
    return true;
  }

  /** Check if a mediaFileId is cached. */
  has(mediaFileId: string): boolean {
    return this.entries.has(mediaFileId);
  }

  /** Clear all entries from the cache. */
  clear(): void {
    // Null out buffer data for GC
    for (const entry of this.entries.values()) {
      this.nullifyBuffers(entry.asset);
    }
    this.entries.clear();
    this.totalBytes = 0;
    log.info('Cache cleared');
  }

  /** Get current cache statistics. */
  getStats(): { entries: number; totalBytes: number; maxBytes: number } {
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
    };
  }

  /** Update the maximum cache size. May trigger evictions. */
  setMaxBytes(maxBytes: number): void {
    this.maxBytes = maxBytes;
    while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
      this.evictLRU();
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private computeAssetBytes(asset: GaussianSplatAsset): number {
    let total = 0;
    for (const frame of asset.frames) {
      total += frame.buffer.data.byteLength;
      if (frame.buffer.shData) {
        total += frame.buffer.shData.byteLength;
      }
    }
    return total;
  }

  private evictLRU(): void {
    let oldest: CacheEntry | null = null;

    for (const entry of this.entries.values()) {
      if (!oldest || entry.lastAccessed < oldest.lastAccessed) {
        oldest = entry;
      }
    }

    if (oldest) {
      log.debug('Evicting LRU entry', {
        mediaFileId: oldest.mediaFileId,
        ageSec: ((performance.now() - oldest.lastAccessed) / 1000).toFixed(1),
        sizeMB: (oldest.byteSize / (1024 * 1024)).toFixed(1),
      });

      // Null out buffer data to help GC, but metadata survives
      this.nullifyBuffers(oldest.asset);

      this.totalBytes -= oldest.byteSize;
      this.entries.delete(oldest.mediaFileId);
    }
  }

  /** Null out Float32Array data in frames to free memory while keeping metadata. */
  private nullifyBuffers(asset: GaussianSplatAsset): void {
    for (const frame of asset.frames) {
      // Replace with empty typed array — keeps the reference valid but frees memory
      (frame.buffer as { data: Float32Array }).data = new Float32Array(0);
      if (frame.buffer.shData) {
        (frame.buffer as { shData: Float32Array | undefined }).shData = undefined;
      }
    }
  }
}

// ── Singleton with HMR support ─────────────────────────────────────────────

let instance: SplatCacheImpl | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.splatCache) {
    instance = import.meta.hot.data.splatCache as SplatCacheImpl;
  }
  import.meta.hot.dispose((data) => {
    data.splatCache = instance;
  });
}

/** Get the splat cache singleton. */
export function getSplatCache(): SplatCacheImpl {
  if (!instance) {
    instance = new SplatCacheImpl();
  }
  return instance;
}

export type { SplatCacheImpl as SplatCache };
