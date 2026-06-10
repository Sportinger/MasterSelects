// Source-based thumbnail cache service
// Generates 1 thumbnail per second per source media file
// Stores in IndexedDB, serves from in-memory cache
// Clips reference sourceId - split/trim needs zero thumbnail work

import { Logger } from './logger';
import { ThumbnailCacheEventBus } from './thumbnailCache/events';
import { ThumbnailGenerator } from './thumbnailCache/generation';
import { ThumbnailInvalidationController } from './thumbnailCache/invalidation';
import { ThumbnailMemoryTier } from './thumbnailCache/memoryTier';
import { ThumbnailPersistentTier } from './thumbnailCache/persistentTier';
import { ThumbnailRequestQueue } from './thumbnailCache/requestQueue';
import {
  cleanupThumbnailGenerationVideo,
  createThumbnailGenerationVideoFromUrl,
  prepareThumbnailGenerationVideo,
} from './thumbnailCache/videoRuntime';
import {
  canRetainThumbnailGenerationVideo,
  canRetainThumbnailJob,
  getThumbnailGenerationJobId,
  getThumbnailGenerationVideoResourceId,
  releaseThumbnailRuntimeResource,
  reportThumbnailGenerationVideo,
  reportThumbnailJob,
} from './timeline/thumbnailRuntimeReporting';
import type {
  StatusListener,
  ThumbnailStatus,
} from './thumbnailCache/types';

export type {
  StatusListener,
  ThumbnailCacheEvent,
  ThumbnailCacheEventType,
  ThumbnailStatus,
} from './thumbnailCache/types';
export {
  createThumbnailGenerationVideo,
  createThumbnailGenerationVideoFromUrl,
} from './thumbnailCache/videoRuntime';

const log = Logger.create('ThumbnailCache');

class ThumbnailCacheService {
  private readonly memory = new ThumbnailMemoryTier();
  private readonly events = new ThumbnailCacheEventBus();
  private readonly persistent = new ThumbnailPersistentTier(log);
  private readonly requestQueue = new ThumbnailRequestQueue();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly durations = new Map<string, number>();
  private readonly lastGenerationErrors = new Map<string, string>();
  private readonly generator: ThumbnailGenerator;
  private readonly invalidation: ThumbnailInvalidationController;

  constructor() {
    this.generator = new ThumbnailGenerator({
      memory: this.memory,
      persistent: this.persistent,
      log,
      notify: (mediaFileId, status, event) => this.events.notify(mediaFileId, status, event),
      setLastGenerationError: (mediaFileId, error) => {
        this.lastGenerationErrors.set(mediaFileId, error);
      },
    });
    this.invalidation = new ThumbnailInvalidationController({
      abortControllers: this.abortControllers,
      durations: this.durations,
      events: this.events,
      lastGenerationErrors: this.lastGenerationErrors,
      log,
      memory: this.memory,
      persistent: this.persistent,
      requestQueue: this.requestQueue,
    });
  }

  /** Subscribe to status changes (returns unsubscribe function) */
  subscribe(listener: StatusListener): () => void {
    return this.events.subscribe(listener);
  }

  /** Get a single thumbnail for a specific second */
  getThumbnail(mediaFileId: string, secondIndex: number): string | null {
    return this.memory.getThumbnail(mediaFileId, secondIndex);
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
    reversed?: boolean,
  ): (string | null)[] {
    return this.memory.getThumbnailsForRange(mediaFileId, inPoint, outPoint, count, reversed);
  }

  /** Get status for a source */
  getStatus(mediaFileId: string): ThumbnailStatus {
    return this.events.getStatus(mediaFileId);
  }

  /**
   * Load already-generated thumbnails from IndexedDB into memory.
   * This does not create video elements or generate missing frames.
   */
  async loadCachedForSource(mediaFileId: string, fileHash?: string): Promise<boolean> {
    if (this.hasSource(mediaFileId)) {
      if (this.getStatus(mediaFileId) !== 'ready') {
        this.events.notify(mediaFileId, 'ready');
      }
      return true;
    }

    const currentStatus = this.getStatus(mediaFileId);
    if (currentStatus === 'generating' || currentStatus === 'ready') {
      return currentStatus === 'ready';
    }

    const loadPromise = this.requestQueue.beginCachedLoad(
      mediaFileId,
      fileHash,
      log,
      async (sourceVersion) => {
        const loaded = await this.loadFromDB(mediaFileId, fileHash, sourceVersion);
        if (!this.requestQueue.isSourceVersionCurrent(mediaFileId, sourceVersion)) {
          return false;
        }
        if (loaded) {
          this.events.notify(mediaFileId, 'ready');
        }
        return loaded;
      },
    );

    return loadPromise || false;
  }

  /** Check if source has thumbnails in memory */
  hasSource(mediaFileId: string): boolean {
    return this.memory.hasSource(mediaFileId);
  }

  /** Get total thumbnail count for a source */
  getCount(mediaFileId: string): number {
    return this.memory.getCount(mediaFileId);
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
    fileHash?: string,
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
      this.events.notify(mediaFileId, 'generating');

      const sourceVersion = this.requestQueue.getSourceVersion(mediaFileId);
      const loaded = await this.loadFromDB(mediaFileId, fileHash, sourceVersion);
      if (loaded) {
        if (!this.requestQueue.isSourceVersionCurrent(mediaFileId, sourceVersion)) {
          return;
        }
        log.debug('Loaded thumbnails from IndexedDB', { mediaFileId, count: this.getCount(mediaFileId) });
        this.events.notify(mediaFileId, 'ready');
        return;
      }

      const abortController = new AbortController();
      this.abortControllers.set(mediaFileId, abortController);
      if (!sourceUrl) {
        log.warn('Thumbnail generation skipped - source has no usable URL', { mediaFileId });
        this.abortControllers.delete(mediaFileId);
        this.events.notify(mediaFileId, 'error');
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
        this.events.notify(mediaFileId, 'none');
        return;
      }

      const thumbnailVideo = createThumbnailGenerationVideoFromUrl(sourceUrl, crossOrigin);

      if (!thumbnailVideo) {
        log.warn('Thumbnail generation skipped - source has no usable URL', { mediaFileId });
        this.abortControllers.delete(mediaFileId);
        this.events.notify(mediaFileId, 'error');
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
        const generated = await this.generator.generateThumbnails(
          mediaFileId,
          thumbnailVideo,
          duration,
          fileHash,
          abortController.signal,
        );
        if (generated && !abortController.signal.aborted) {
          this.events.notify(mediaFileId, 'ready');
          log.debug('Thumbnail generation complete', { mediaFileId, count: this.getCount(mediaFileId) });
        } else if (!abortController.signal.aborted && this.getStatus(mediaFileId) === 'generating') {
          this.events.notify(mediaFileId, 'none');
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          log.warn('Thumbnail generation failed', { mediaFileId, error });
          this.events.notify(mediaFileId, 'error');
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

  /** Abort in-progress generation */
  abort(mediaFileId: string): void {
    this.invalidation.abort(mediaFileId);
  }

  /** Evict from memory (thumbnails remain in IndexedDB) */
  evictFromMemory(mediaFileId: string): void {
    this.invalidation.evictFromMemory(mediaFileId);
  }

  /** Clear everything for a source (memory + IndexedDB) */
  async clearSource(mediaFileId: string): Promise<void> {
    await this.invalidation.clearSource(mediaFileId);
  }

  /** Clear all cached thumbnails */
  async clearAll(): Promise<void> {
    await this.invalidation.clearAll();
  }

  /** Load thumbnails from IndexedDB into memory cache */
  private async loadFromDB(
    mediaFileId: string,
    fileHash?: string,
    sourceVersion = this.requestQueue.getSourceVersion(mediaFileId),
  ): Promise<boolean> {
    const frames = await this.persistent.loadFrames(mediaFileId, fileHash);
    if (!frames || !this.requestQueue.isSourceVersionCurrent(mediaFileId, sourceVersion)) {
      return false;
    }

    const result = this.memory.loadFrames(mediaFileId, frames);
    this.events.notify(mediaFileId, 'ready', {
      type: 'frames-loaded',
      secondIndices: result.secondIndices,
      count: result.count,
    });
    return true;
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
