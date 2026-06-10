import {
  canRetainThumbnailJob,
  getThumbnailDbLoadJobId,
  releaseThumbnailRuntimeResource,
  reportThumbnailJob,
} from '../timeline/thumbnailRuntimeReporting';
import type { ThumbnailCacheLogger } from './types';

type CachedLoadFactory = (sourceVersion: number) => Promise<boolean>;

export class ThumbnailRequestQueue {
  private cachedLoadPromises = new Map<string, Promise<boolean>>();
  private cachedLoadJobIds = new Map<string, string>();
  private sourceVersions = new Map<string, number>();

  getSourceVersion(mediaFileId: string): number {
    return this.sourceVersions.get(mediaFileId) ?? 0;
  }

  bumpSourceVersion(mediaFileId: string): number {
    const nextVersion = this.getSourceVersion(mediaFileId) + 1;
    this.sourceVersions.set(mediaFileId, nextVersion);
    return nextVersion;
  }

  isSourceVersionCurrent(mediaFileId: string, sourceVersion: number): boolean {
    return this.getSourceVersion(mediaFileId) === sourceVersion;
  }

  beginCachedLoad(
    mediaFileId: string,
    fileHash: string | undefined,
    log: ThumbnailCacheLogger,
    loadFactory: CachedLoadFactory,
  ): Promise<boolean> | false {
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

    const loadPromise = loadFactory(sourceVersion)
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

  deleteCachedLoadsForSource(mediaFileId: string): void {
    for (const loadKey of [...this.cachedLoadPromises.keys()]) {
      if (this.getMediaFileIdFromCachedLoadKey(loadKey) !== mediaFileId) continue;
      this.cachedLoadPromises.delete(loadKey);
      this.releaseCachedLoadJob(loadKey);
    }
  }

  releaseAllCachedLoads(onReleasedSource: (mediaFileId: string) => void): void {
    for (const [loadKey] of this.cachedLoadPromises) {
      const mediaFileId = this.getMediaFileIdFromCachedLoadKey(loadKey);
      onReleasedSource(mediaFileId);
      this.releaseCachedLoadJob(loadKey);
    }
  }

  clearCachedLoads(): void {
    this.cachedLoadPromises.clear();
    this.cachedLoadJobIds.clear();
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
}

