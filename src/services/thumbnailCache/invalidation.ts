import {
  getThumbnailGenerationCanvasResourceId,
  getThumbnailGenerationJobId,
  getThumbnailGenerationVideoResourceId,
  releaseThumbnailRuntimeResource,
} from '../timeline/thumbnailRuntimeReporting';
import { ThumbnailCacheEventBus } from './events';
import { ThumbnailMemoryTier } from './memoryTier';
import { ThumbnailPersistentTier } from './persistentTier';
import { ThumbnailRequestQueue } from './requestQueue';
import type { ThumbnailCacheLogger } from './types';

export interface ThumbnailInvalidationOptions {
  abortControllers: Map<string, AbortController>;
  durations: Map<string, number>;
  events: ThumbnailCacheEventBus;
  lastGenerationErrors: Map<string, string>;
  log: ThumbnailCacheLogger;
  memory: ThumbnailMemoryTier;
  persistent: ThumbnailPersistentTier;
  requestQueue: ThumbnailRequestQueue;
}

export class ThumbnailInvalidationController {
  private readonly options: ThumbnailInvalidationOptions;

  constructor(options: ThumbnailInvalidationOptions) {
    this.options = options;
  }

  abort(mediaFileId: string): void {
    const controller = this.options.abortControllers.get(mediaFileId);
    if (controller) {
      controller.abort();
      this.options.abortControllers.delete(mediaFileId);
    }
  }

  evictFromMemory(mediaFileId: string): void {
    this.options.requestQueue.bumpSourceVersion(mediaFileId);
    this.options.requestQueue.deleteCachedLoadsForSource(mediaFileId);
    const eviction = this.options.memory.evictSource(mediaFileId);
    if (eviction) {
      this.options.events.notify(mediaFileId, 'none', {
        type: 'memory-evicted',
        secondIndices: eviction.secondIndices,
        count: eviction.count,
      });
    }
    this.options.events.deleteStatus(mediaFileId);
    this.options.durations.delete(mediaFileId);
  }

  async clearSource(mediaFileId: string): Promise<void> {
    this.abort(mediaFileId);
    this.options.lastGenerationErrors.delete(mediaFileId);
    this.options.requestQueue.deleteCachedLoadsForSource(mediaFileId);
    this.evictFromMemory(mediaFileId);
    try {
      await this.options.persistent.deleteSource(mediaFileId);
      this.options.events.notify(mediaFileId, 'none', { type: 'source-cleared' });
    } catch (error) {
      this.options.log.warn('Failed to delete thumbnails from IndexedDB', { mediaFileId, error });
    }
  }

  async clearAll(): Promise<void> {
    for (const [id, controller] of this.options.abortControllers) {
      controller.abort();
      releaseThumbnailRuntimeResource(getThumbnailGenerationJobId(id));
      releaseThumbnailRuntimeResource(getThumbnailGenerationVideoResourceId(id));
      releaseThumbnailRuntimeResource(getThumbnailGenerationCanvasResourceId(id));
    }
    this.options.abortControllers.clear();
    this.options.requestQueue.releaseAllCachedLoads((mediaFileId) => {
      this.options.requestQueue.bumpSourceVersion(mediaFileId);
    });
    for (const id of this.options.memory.sourceIds()) {
      this.evictFromMemory(id);
    }
    this.options.memory.clear();
    this.options.events.clear();
    this.options.durations.clear();
    this.options.requestQueue.clearCachedLoads();
    try {
      await this.options.persistent.clearAll();
    } catch (error) {
      this.options.log.warn('Failed to clear all thumbnails from IndexedDB', error);
    }
  }
}
