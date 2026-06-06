// Source-based thumbnail cache service
// Generates 1 thumbnail per second per source media file
// Stores in IndexedDB, serves from in-memory cache
// Clips reference sourceId — split/trim needs zero thumbnail work

import { Logger } from './logger';
import { projectDB } from './projectDB';
import {
  closeByThumbnailUrls,
  registerThumbnailBitmapSource,
} from './timeline/thumbnailBitmapCache';
import {
  canRetainThumbnailGenerationCanvas,
  canRetainThumbnailGenerationVideo,
  canRetainThumbnailJob,
  getThumbnailDbLoadJobId,
  getThumbnailGenerationCanvasResourceId,
  getThumbnailGenerationJobId,
  getThumbnailGenerationVideoResourceId,
  releaseThumbnailRuntimeResource,
  reportThumbnailGenerationCanvas,
  reportThumbnailGenerationVideo,
  reportThumbnailJob,
} from './timeline/thumbnailRuntimeReporting';

const log = Logger.create('ThumbnailCache');

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const THUMB_QUALITY = 0.6;
const BATCH_SIZE = 10; // Write to IndexedDB every N frames

export type ThumbnailStatus = 'none' | 'generating' | 'ready' | 'error';

export type ThumbnailCacheEventType =
  | 'status'
  | 'frames-loaded'
  | 'frame-ready'
  | 'memory-evicted'
  | 'source-cleared';

export interface ThumbnailCacheEvent {
  type: ThumbnailCacheEventType;
  mediaFileId: string;
  status: ThumbnailStatus;
  secondIndex?: number;
  secondIndices?: readonly number[];
  count?: number;
}

// Event listeners for status/frame changes (so React can re-render). The third
// argument is optional to keep existing two-argument subscribers compatible.
export type StatusListener = (
  mediaFileId: string,
  status: ThumbnailStatus,
  event?: ThumbnailCacheEvent,
) => void;

export function createThumbnailGenerationVideoFromUrl(
  sourceUrl: string,
  crossOrigin = 'anonymous',
): HTMLVideoElement | null {
  if (!sourceUrl) {
    return null;
  }

  const video = document.createElement('video');
  video.src = sourceUrl;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = crossOrigin || 'anonymous';
  video.load();
  return video;
}

export function createThumbnailGenerationVideo(sourceVideo: HTMLVideoElement): HTMLVideoElement | null {
  return createThumbnailGenerationVideoFromUrl(
    sourceVideo.currentSrc || sourceVideo.src,
    sourceVideo.crossOrigin || 'anonymous',
  );
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
  // IndexedDB cache-load requests in flight. These are intentionally separate
  // from generation so timeline viewport rendering can warm memory cheaply.
  private cachedLoadPromises = new Map<string, Promise<boolean>>();
  private cachedLoadJobIds = new Map<string, string>();
  private sourceVersions = new Map<string, number>();
  private lastGenerationErrors = new Map<string, string>();
  // Status change listeners
  private listeners = new Set<StatusListener>();

  private getSourceVersion(mediaFileId: string): number {
    return this.sourceVersions.get(mediaFileId) ?? 0;
  }

  private bumpSourceVersion(mediaFileId: string): number {
    const nextVersion = this.getSourceVersion(mediaFileId) + 1;
    this.sourceVersions.set(mediaFileId, nextVersion);
    return nextVersion;
  }

  private isSourceVersionCurrent(mediaFileId: string, sourceVersion: number): boolean {
    return this.getSourceVersion(mediaFileId) === sourceVersion;
  }

  private getCachedLoadKey(mediaFileId: string, fileHash?: string): string {
    return `${mediaFileId}\u0000${fileHash ?? ''}`;
  }

  private getMediaFileIdFromCachedLoadKey(loadKey: string): string {
    return loadKey.split('\u0000', 1)[0];
  }

  private releaseCachedLoadJob(loadKey: string): void {
    const jobId = this.cachedLoadJobIds.get(loadKey);
    if (!jobId) {
      return;
    }
    releaseThumbnailRuntimeResource(jobId);
    this.cachedLoadJobIds.delete(loadKey);
  }

  private deleteCachedLoadsForSource(mediaFileId: string): void {
    for (const loadKey of [...this.cachedLoadPromises.keys()]) {
      if (this.getMediaFileIdFromCachedLoadKey(loadKey) !== mediaFileId) continue;
      this.cachedLoadPromises.delete(loadKey);
      this.releaseCachedLoadJob(loadKey);
    }
  }

  /** Subscribe to status changes (returns unsubscribe function) */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(
    mediaFileId: string,
    status: ThumbnailStatus,
    event: Omit<ThumbnailCacheEvent, 'mediaFileId' | 'status'> = { type: 'status' },
  ): void {
    this.status.set(mediaFileId, status);
    const payload: ThumbnailCacheEvent = {
      mediaFileId,
      status,
      ...event,
    };
    for (const listener of this.listeners) {
      try { listener(mediaFileId, status, payload); } catch { /* ignore */ }
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

  /**
   * Load already-generated thumbnails from IndexedDB into memory.
   * This does not create video elements or generate missing frames.
   */
  async loadCachedForSource(mediaFileId: string, fileHash?: string): Promise<boolean> {
    if (this.hasSource(mediaFileId)) {
      if (this.getStatus(mediaFileId) !== 'ready') {
        this.notify(mediaFileId, 'ready');
      }
      return true;
    }

    const currentStatus = this.getStatus(mediaFileId);
    if (currentStatus === 'generating' || currentStatus === 'ready') {
      return currentStatus === 'ready';
    }

    const loadKey = this.getCachedLoadKey(mediaFileId, fileHash);
    const existing = this.cachedLoadPromises.get(loadKey);
    if (existing) return existing;

    const sourceVersion = this.getSourceVersion(mediaFileId);
    const jobId = getThumbnailDbLoadJobId(mediaFileId, fileHash);
    const admission = canRetainThumbnailJob({
      jobId,
      jobKind: 'thumbnail-db-load',
      mediaFileId,
      fileHash,
    });
    if (!admission.admitted) {
      log.debug('Cached thumbnail load skipped by runtime admission', {
        mediaFileId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }

    reportThumbnailJob({
      jobId,
      jobKind: 'thumbnail-db-load',
      mediaFileId,
      fileHash,
    });
    const loadPromise = this.loadFromDB(mediaFileId, fileHash, sourceVersion)
      .then((loaded) => {
        if (!this.isSourceVersionCurrent(mediaFileId, sourceVersion)) {
          return false;
        }
        if (loaded) {
          this.notify(mediaFileId, 'ready');
        }
        return loaded;
      })
      .catch((error) => {
        log.debug('Cached thumbnail load failed', { mediaFileId, error });
        return false;
      })
      .finally(() => {
        this.cachedLoadPromises.delete(loadKey);
        this.releaseCachedLoadJob(loadKey);
      });

    this.cachedLoadPromises.set(loadKey, loadPromise);
    this.cachedLoadJobIds.set(loadKey, jobId);
    return loadPromise;
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

  getLastGenerationError(mediaFileId: string): string | null {
    return this.lastGenerationErrors.get(mediaFileId) ?? null;
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
    await this.generateForSourceUrl(
      mediaFileId,
      sourceVideo.currentSrc || sourceVideo.src,
      duration,
      fileHash,
      sourceVideo.crossOrigin || 'anonymous',
    );
  }

  async generateForSourceUrl(
    mediaFileId: string,
    sourceUrl: string,
    duration: number,
    fileHash?: string,
    crossOrigin = 'anonymous',
  ): Promise<void> {
    // Already generating or ready?
    const currentStatus = this.getStatus(mediaFileId);
    if (currentStatus === 'generating' || currentStatus === 'ready') {
      log.debug('Thumbnails already generating/ready', { mediaFileId, status: currentStatus });
      return;
    }

    const generationJobId = getThumbnailGenerationJobId(mediaFileId);
    const generationAdmission = canRetainThumbnailJob({
      jobId: generationJobId,
      jobKind: 'thumbnail-generation',
      mediaFileId,
      fileHash,
      sourceUrl,
    });
    if (!generationAdmission.admitted) {
      log.debug('Thumbnail generation skipped by runtime admission', {
        mediaFileId,
        reason: generationAdmission.reason,
        rejectedUnits: generationAdmission.rejectedUnits.map((entry) => entry.unit),
      });
      return;
    }

    reportThumbnailJob({
      jobId: generationJobId,
      jobKind: 'thumbnail-generation',
      mediaFileId,
      fileHash,
      sourceUrl,
    });
    this.lastGenerationErrors.delete(mediaFileId);

    try {
      this.durations.set(mediaFileId, duration);
      this.notify(mediaFileId, 'generating');

      // Try loading from IndexedDB first (via fileHash for dedup or mediaFileId)
      const sourceVersion = this.getSourceVersion(mediaFileId);
      const loaded = await this.loadFromDB(mediaFileId, fileHash, sourceVersion);
      if (loaded) {
        if (!this.isSourceVersionCurrent(mediaFileId, sourceVersion)) {
          return;
        }
        log.debug('Loaded thumbnails from IndexedDB', { mediaFileId, count: this.getCount(mediaFileId) });
        this.notify(mediaFileId, 'ready');
        return;
      }

      // Generate fresh thumbnails
      const abortController = new AbortController();
      this.abortControllers.set(mediaFileId, abortController);
      if (!sourceUrl) {
        log.warn('Thumbnail generation skipped - source has no usable URL', { mediaFileId });
        this.abortControllers.delete(mediaFileId);
        this.notify(mediaFileId, 'error');
        return;
      }

      const videoAdmission = canRetainThumbnailGenerationVideo({
        mediaFileId,
        sourceUrl,
      });
      if (!videoAdmission.admitted) {
        log.debug('Thumbnail generation video skipped by runtime admission', {
          mediaFileId,
          reason: videoAdmission.reason,
          rejectedUnits: videoAdmission.rejectedUnits.map((entry) => entry.unit),
        });
        this.abortControllers.delete(mediaFileId);
        this.notify(mediaFileId, 'none');
        return;
      }

      const thumbnailVideo = createThumbnailGenerationVideoFromUrl(sourceUrl, crossOrigin);

      if (!thumbnailVideo) {
        log.warn('Thumbnail generation skipped - source has no usable URL', { mediaFileId });
        this.abortControllers.delete(mediaFileId);
        this.notify(mediaFileId, 'error');
        return;
      }

      reportThumbnailGenerationVideo({
        mediaFileId,
        sourceUrl,
        element: thumbnailVideo,
      });

      try {
        await prepareThumbnailGenerationVideo(thumbnailVideo, abortController.signal);
        reportThumbnailGenerationVideo({
          mediaFileId,
          sourceUrl,
          element: thumbnailVideo,
        });
        const generated = await this.generateThumbnails(
          mediaFileId,
          thumbnailVideo,
          duration,
          fileHash,
          abortController.signal
        );
        if (generated && !abortController.signal.aborted) {
          this.notify(mediaFileId, 'ready');
          log.debug('Thumbnail generation complete', { mediaFileId, count: this.getCount(mediaFileId) });
        } else if (!abortController.signal.aborted && this.getStatus(mediaFileId) === 'generating') {
          this.notify(mediaFileId, 'none');
        }
      } catch (e) {
        if (!abortController.signal.aborted) {
          log.warn('Thumbnail generation failed', { mediaFileId, error: e });
          this.notify(mediaFileId, 'error');
        }
      } finally {
        cleanupThumbnailGenerationVideo(thumbnailVideo);
        releaseThumbnailRuntimeResource(getThumbnailGenerationVideoResourceId(mediaFileId));
        this.abortControllers.delete(mediaFileId);
      }
    } finally {
      releaseThumbnailRuntimeResource(generationJobId);
    }
  }

  /** Load thumbnails from IndexedDB into memory cache */
  private async loadFromDB(
    mediaFileId: string,
    fileHash?: string,
    sourceVersion = this.getSourceVersion(mediaFileId),
  ): Promise<boolean> {
    try {
      const frames = await projectDB.getSourceThumbnails(mediaFileId);
      if (frames.length > 0) {
        if (!this.isSourceVersionCurrent(mediaFileId, sourceVersion)) return false;
        this.loadFramesIntoCache(mediaFileId, frames);
        return true;
      }

      // Try by fileHash (deduplication)
      if (fileHash) {
        const hashFrames = await projectDB.getSourceThumbnailsByHash(fileHash);
        if (hashFrames.length > 0) {
          if (!this.isSourceVersionCurrent(mediaFileId, sourceVersion)) return false;
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
    const secondIndices: number[] = [];
    for (const frame of frames) {
      const url = URL.createObjectURL(frame.blob);
      registerThumbnailBitmapSource(url, mediaFileId);
      sourceCache.set(frame.secondIndex, url);
      secondIndices.push(frame.secondIndex);
    }
    this.cache.set(mediaFileId, sourceCache);
    this.notify(mediaFileId, 'ready', {
      type: 'frames-loaded',
      secondIndices,
      count: secondIndices.length,
    });
  }

  /** Core generation: seek video to each second, capture frame */
  private async generateThumbnails(
    mediaFileId: string,
    video: HTMLVideoElement,
    duration: number,
    fileHash: string | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    // Wait for video to be seekable
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('canplay', () => resolve(), { once: true });
        setTimeout(resolve, 3000);
      });
    }

    const canvasAdmission = canRetainThumbnailGenerationCanvas(mediaFileId);
    if (!canvasAdmission.admitted) {
      log.debug('Thumbnail generation canvas skipped by runtime admission', {
        mediaFileId,
        reason: canvasAdmission.reason,
        rejectedUnits: canvasAdmission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    reportThumbnailGenerationCanvas(mediaFileId);

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas 2d context');
      }

      const totalThumbs = Math.ceil(duration);
      const sourceCache = new Map<number, string>();
      this.cache.set(mediaFileId, sourceCache);
      const captureErrors: string[] = [];

      let batch: Array<{
        id: string;
        mediaFileId: string;
        fileHash?: string;
        secondIndex: number;
        blob: Blob;
      }> = [];

      for (let s = 0; s < totalThumbs; s++) {
        if (signal.aborted) return false;

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
          registerThumbnailBitmapSource(url, mediaFileId);
          sourceCache.set(s, url);
          this.notify(mediaFileId, 'generating', {
            type: 'frame-ready',
            secondIndex: s,
            secondIndices: [s],
            count: 1,
          });

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
        } catch (e) {
          if (captureErrors.length < 5) {
            captureErrors.push(`second ${s}: ${e instanceof Error ? e.message : String(e)}`);
          }
          log.debug('Thumbnail capture failed at second', { secondIndex: s, error: e });
          // Continue with next second
        }
      }

      if (sourceCache.size === 0) {
        const errorMessage = captureErrors.length > 0
          ? `No thumbnail frames captured (${captureErrors.join('; ')})`
          : 'No thumbnail frames captured';
        this.lastGenerationErrors.set(mediaFileId, errorMessage);
        log.warn('Thumbnail generation produced no frames', {
          mediaFileId,
          duration,
          errors: captureErrors,
          readyState: video.readyState,
          currentTime: video.currentTime,
          videoDuration: video.duration,
        });
        return false;
      }

      // Write remaining batch
      if (batch.length > 0) {
        await projectDB.saveSourceThumbnailsBatch(batch);
      }

      // Seek back to start
      try { video.currentTime = 0; } catch { /* ignore */ }
      return true;
    } finally {
      releaseThumbnailRuntimeResource(getThumbnailGenerationCanvasResourceId(mediaFileId));
    }
  }

  /** Seek video and wait for seeked event with timeout */
  private seekVideoSafe(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let settleFallbackId: number | null = null;
      const targetTime = Math.max(0, time);

      const cleanup = () => {
        if (settleFallbackId !== null) {
          clearTimeout(settleFallbackId);
          settleFallbackId = null;
        }
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const isReadyAtTarget = () => (
        video.readyState >= 2 &&
        Number.isFinite(video.currentTime) &&
        Math.abs(video.currentTime - targetTime) <= 0.04
      );

      const timeout = setTimeout(() => {
        if (isReadyAtTarget()) {
          resolveOnce();
          return;
        }
        rejectOnce(new Error('Seek timeout'));
      }, 3000);

      const onSeeked = () => {
        resolveOnce();
      };

      video.addEventListener('seeked', onSeeked);

      try {
        video.currentTime = targetTime;
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error('Seek failed'));
        return;
      }

      if (isReadyAtTarget()) {
        settleFallbackId = window.setTimeout(resolveOnce, 0);
      }
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
    this.bumpSourceVersion(mediaFileId);
    this.deleteCachedLoadsForSource(mediaFileId);
    const sourceCache = this.cache.get(mediaFileId);
    if (sourceCache) {
      const urls = [...sourceCache.values()];
      closeByThumbnailUrls(urls);
      // Revoke all blob URLs
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      this.cache.delete(mediaFileId);
      this.notify(mediaFileId, 'none', {
        type: 'memory-evicted',
        secondIndices: [...sourceCache.keys()],
        count: sourceCache.size,
      });
    }
    this.status.delete(mediaFileId);
    this.durations.delete(mediaFileId);
  }

  /** Clear everything for a source (memory + IndexedDB) */
  async clearSource(mediaFileId: string): Promise<void> {
    this.abort(mediaFileId);
    this.lastGenerationErrors.delete(mediaFileId);
    this.deleteCachedLoadsForSource(mediaFileId);
    this.evictFromMemory(mediaFileId);
    try {
      await projectDB.deleteSourceThumbnails(mediaFileId);
      this.notify(mediaFileId, 'none', { type: 'source-cleared' });
    } catch (e) {
      log.warn('Failed to delete thumbnails from IndexedDB', { mediaFileId, error: e });
    }
  }

  /** Clear all cached thumbnails */
  async clearAll(): Promise<void> {
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      releaseThumbnailRuntimeResource(getThumbnailGenerationJobId(id));
      releaseThumbnailRuntimeResource(getThumbnailGenerationVideoResourceId(id));
      releaseThumbnailRuntimeResource(getThumbnailGenerationCanvasResourceId(id));
    }
    this.abortControllers.clear();
    for (const [loadKey] of this.cachedLoadPromises) {
      const mediaFileId = this.getMediaFileIdFromCachedLoadKey(loadKey);
      this.bumpSourceVersion(mediaFileId);
      this.releaseCachedLoadJob(loadKey);
    }
    for (const [id] of this.cache) {
      this.evictFromMemory(id);
    }
    this.cache.clear();
    this.status.clear();
    this.durations.clear();
    this.cachedLoadPromises.clear();
    this.cachedLoadJobIds.clear();
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
