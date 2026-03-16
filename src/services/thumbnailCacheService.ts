// Source-based thumbnail cache service
// Generates 1 thumbnail per second per source media file
// Stores in IndexedDB, serves from in-memory cache
// Clips reference sourceId — split/trim needs zero thumbnail work

import { Logger } from './logger';
import { projectDB } from './projectDB';

const log = Logger.create('ThumbnailCache');

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const THUMB_QUALITY = 0.6;
const BATCH_SIZE = 10; // Write to IndexedDB every N frames

export type ThumbnailStatus = 'none' | 'generating' | 'ready' | 'error';

// Event listeners for status changes (so React can re-render)
type StatusListener = (mediaFileId: string, status: ThumbnailStatus) => void;

export function createThumbnailGenerationVideo(sourceVideo: HTMLVideoElement): HTMLVideoElement | null {
  const sourceUrl = sourceVideo.currentSrc || sourceVideo.src;
  if (!sourceUrl) {
    return null;
  }

  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = sourceVideo.crossOrigin || 'anonymous';
  video.load();
  return video;
}

async function prepareThumbnailGenerationVideo(
  video: HTMLVideoElement,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new Error('Thumbnail generation aborted');
  }

  if (video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail video metadata timeout'));
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Thumbnail video failed to load metadata'));
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Thumbnail generation aborted'));
    };

    if (video.readyState >= 1) {
      cleanup();
      resolve();
      return;
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  if (signal?.aborted || video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail video frame decode timeout'));
    }, 4000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = () => {
      cleanup();
      video.pause?.();
      resolve();
    };

    const onReady = () => {
      finish();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Thumbnail video failed during frame decode warmup'));
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Thumbnail generation aborted'));
    };

    if (video.readyState >= 2) {
      finish();
      return;
    }

    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });

    const seekTarget = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(0.001, Math.max(0, video.duration - 0.001))
      : 0.001;

    try {
      video.currentTime = seekTarget;
    } catch {
      // Ignore seek failures until metadata settles.
    }

    video.play().then(() => {
      setTimeout(() => {
        if (video.readyState >= 2) {
          finish();
        }
      }, 60);
    }).catch(() => {
      // Fallback: rely on seek/load events or timeout.
    });
  });
}

function cleanupThumbnailGenerationVideo(video: HTMLVideoElement): void {
  video.pause?.();
  video.removeAttribute?.('src');
  try {
    video.load?.();
  } catch {
    // Ignore teardown failures from test environments or detached elements.
  }
}

class ThumbnailCacheService {
  // In-memory cache: Map<mediaFileId, Map<secondIndex, blobUrl>>
  private cache = new Map<string, Map<number, string>>();
  // Generation status per source
  private status = new Map<string, ThumbnailStatus>();
  // Total duration per source (to know how many thumbs exist)
  private durations = new Map<string, number>();
  // Abort controllers for in-progress generation
  private abortControllers = new Map<string, AbortController>();
  // Status change listeners
  private listeners = new Set<StatusListener>();

  /** Subscribe to status changes (returns unsubscribe function) */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(mediaFileId: string, status: ThumbnailStatus): void {
    this.status.set(mediaFileId, status);
    for (const listener of this.listeners) {
      try { listener(mediaFileId, status); } catch { /* ignore */ }
    }
  }

  /** Get a single thumbnail for a specific second */
  getThumbnail(mediaFileId: string, secondIndex: number): string | null {
    return this.cache.get(mediaFileId)?.get(secondIndex) ?? null;
  }

  /**
   * Get thumbnails for a range, evenly distributed.
   * Returns array of count blob URLs (or null for missing).
   */
  getThumbnailsForRange(
    mediaFileId: string,
    inPoint: number,
    outPoint: number,
    count: number,
    reversed?: boolean
  ): (string | null)[] {
    const sourceCache = this.cache.get(mediaFileId);
    if (!sourceCache || sourceCache.size === 0 || count <= 0) {
      return new Array(count).fill(null);
    }

    const duration = outPoint - inPoint;
    const result: (string | null)[] = [];

    for (let i = 0; i < count; i++) {
      // Map each visible slot to a time in the source
      const t = inPoint + (i / count) * duration;
      const secondIndex = Math.floor(t);
      // Find closest available thumbnail
      let thumb = sourceCache.get(secondIndex) ?? null;
      if (!thumb && secondIndex > 0) {
        // Try adjacent seconds
        thumb = sourceCache.get(secondIndex - 1) ?? sourceCache.get(secondIndex + 1) ?? null;
      }
      result.push(thumb);
    }

    if (reversed) {
      result.reverse();
    }

    return result;
  }

  /** Get status for a source */
  getStatus(mediaFileId: string): ThumbnailStatus {
    return this.status.get(mediaFileId) ?? 'none';
  }

  /** Check if source has thumbnails in memory */
  hasSource(mediaFileId: string): boolean {
    const cache = this.cache.get(mediaFileId);
    return !!cache && cache.size > 0;
  }

  /** Get total thumbnail count for a source */
  getCount(mediaFileId: string): number {
    return this.cache.get(mediaFileId)?.size ?? 0;
  }

  /**
   * Generate thumbnails for a source media file (1 per second).
   * Called on import. Non-blocking, runs in background.
   */
  async generateForSource(
    mediaFileId: string,
    sourceVideo: HTMLVideoElement,
    duration: number,
    fileHash?: string
  ): Promise<void> {
    // Already generating or ready?
    const currentStatus = this.getStatus(mediaFileId);
    if (currentStatus === 'generating' || currentStatus === 'ready') {
      log.debug('Thumbnails already generating/ready', { mediaFileId, status: currentStatus });
      return;
    }

    this.durations.set(mediaFileId, duration);
    this.notify(mediaFileId, 'generating');

    // Try loading from IndexedDB first (via fileHash for dedup or mediaFileId)
    const loaded = await this.loadFromDB(mediaFileId, fileHash);
    if (loaded) {
      log.debug('Loaded thumbnails from IndexedDB', { mediaFileId, count: this.getCount(mediaFileId) });
      this.notify(mediaFileId, 'ready');
      return;
    }

    // Generate fresh thumbnails
    const abortController = new AbortController();
    this.abortControllers.set(mediaFileId, abortController);
    const thumbnailVideo = createThumbnailGenerationVideo(sourceVideo);

    if (!thumbnailVideo) {
      log.warn('Thumbnail generation skipped - source video has no usable src', { mediaFileId });
      this.abortControllers.delete(mediaFileId);
      this.notify(mediaFileId, 'error');
      return;
    }

    try {
      await prepareThumbnailGenerationVideo(thumbnailVideo, abortController.signal);
      await this.generateThumbnails(mediaFileId, thumbnailVideo, duration, fileHash, abortController.signal);
      if (!abortController.signal.aborted) {
        this.notify(mediaFileId, 'ready');
        log.debug('Thumbnail generation complete', { mediaFileId, count: this.getCount(mediaFileId) });
      }
    } catch (e) {
      if (!abortController.signal.aborted) {
        log.warn('Thumbnail generation failed', { mediaFileId, error: e });
        this.notify(mediaFileId, 'error');
      }
    } finally {
      cleanupThumbnailGenerationVideo(thumbnailVideo);
      this.abortControllers.delete(mediaFileId);
    }
  }

  /** Load thumbnails from IndexedDB into memory cache */
  private async loadFromDB(mediaFileId: string, fileHash?: string): Promise<boolean> {
    try {
      const frames = await projectDB.getSourceThumbnails(mediaFileId);
      if (frames.length > 0) {
        this.loadFramesIntoCache(mediaFileId, frames);
        return true;
      }

      // Try by fileHash (deduplication)
      if (fileHash) {
        const hashFrames = await projectDB.getSourceThumbnailsByHash(fileHash);
        if (hashFrames.length > 0) {
          this.loadFramesIntoCache(mediaFileId, hashFrames);
          return true;
        }
      }
    } catch (e) {
      log.debug('IndexedDB load failed, will regenerate', { mediaFileId, error: e });
    }
    return false;
  }

  private loadFramesIntoCache(
    mediaFileId: string,
    frames: Array<{ secondIndex: number; blob: Blob }>
  ): void {
    const sourceCache = new Map<number, string>();
    for (const frame of frames) {
      const url = URL.createObjectURL(frame.blob);
      sourceCache.set(frame.secondIndex, url);
    }
    this.cache.set(mediaFileId, sourceCache);
  }

  /** Core generation: seek video to each second, capture frame */
  private async generateThumbnails(
    mediaFileId: string,
    video: HTMLVideoElement,
    duration: number,
    fileHash: string | undefined,
    signal: AbortSignal
  ): Promise<void> {
    // Wait for video to be seekable
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('canplay', () => resolve(), { once: true });
        setTimeout(resolve, 3000);
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get canvas 2d context');
    }

    const totalThumbs = Math.ceil(duration);
    const sourceCache = new Map<number, string>();
    this.cache.set(mediaFileId, sourceCache);

    let batch: Array<{
      id: string;
      mediaFileId: string;
      fileHash?: string;
      secondIndex: number;
      blob: Blob;
    }> = [];

    for (let s = 0; s < totalThumbs; s++) {
      if (signal.aborted) return;

      const seekTime = Math.min(s, duration - 0.01);

      try {
        await this.seekVideoSafe(video, seekTime);
        ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

        // Convert to blob (more efficient than data URL)
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
            'image/jpeg',
            THUMB_QUALITY
          );
        });

        // Create blob URL for in-memory use
        const url = URL.createObjectURL(blob);
        sourceCache.set(s, url);

        // Queue for IndexedDB batch write
        batch.push({
          id: `${mediaFileId}_${s.toString().padStart(6, '0')}`,
          mediaFileId,
          fileHash,
          secondIndex: s,
          blob,
        });

        // Batch write to IndexedDB
        if (batch.length >= BATCH_SIZE) {
          await projectDB.saveSourceThumbnailsBatch(batch);
          batch = [];
        }

        // Notify periodically so UI updates progressively
        if (s % 5 === 0) {
          this.notify(mediaFileId, 'generating');
        }
      } catch (e) {
        log.debug('Thumbnail capture failed at second', { secondIndex: s, error: e });
        // Continue with next second
      }
    }

    // Write remaining batch
    if (batch.length > 0) {
      await projectDB.saveSourceThumbnailsBatch(batch);
    }

    // Seek back to start
    try { video.currentTime = 0; } catch { /* ignore */ }
  }

  /** Seek video and wait for seeked event with timeout */
  private seekVideoSafe(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Seek timeout')), 3000);

      const onSeeked = () => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });
  }

  /** Abort in-progress generation */
  abort(mediaFileId: string): void {
    const controller = this.abortControllers.get(mediaFileId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(mediaFileId);
    }
  }

  /** Evict from memory (thumbnails remain in IndexedDB) */
  evictFromMemory(mediaFileId: string): void {
    const sourceCache = this.cache.get(mediaFileId);
    if (sourceCache) {
      // Revoke all blob URLs
      for (const url of sourceCache.values()) {
        URL.revokeObjectURL(url);
      }
      this.cache.delete(mediaFileId);
    }
    this.status.delete(mediaFileId);
    this.durations.delete(mediaFileId);
  }

  /** Clear everything for a source (memory + IndexedDB) */
  async clearSource(mediaFileId: string): Promise<void> {
    this.abort(mediaFileId);
    this.evictFromMemory(mediaFileId);
    try {
      await projectDB.deleteSourceThumbnails(mediaFileId);
    } catch (e) {
      log.warn('Failed to delete thumbnails from IndexedDB', { mediaFileId, error: e });
    }
  }

  /** Clear all cached thumbnails */
  async clearAll(): Promise<void> {
    for (const [id] of this.cache) {
      this.evictFromMemory(id);
    }
    this.cache.clear();
    this.status.clear();
    this.durations.clear();
    try {
      await projectDB.clearAllSourceThumbnails();
    } catch (e) {
      log.warn('Failed to clear all thumbnails from IndexedDB', e);
    }
  }
}

// HMR-safe singleton
let instance: ThumbnailCacheService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.thumbnailCacheService) {
    instance = import.meta.hot.data.thumbnailCacheService;
  }
  import.meta.hot.dispose((data) => {
    data.thumbnailCacheService = instance;
  });
}

if (!instance) {
  instance = new ThumbnailCacheService();
}

export const thumbnailCacheService = instance;
