// Scrubbing frame cache facade for instant access during timeline scrubbing.
// Internal cache owners live under ./scrubbingCache to keep handle lifecycles
// local to their storage clusters while preserving this public API.

import { Logger } from '../../services/logger';
import type { GpuFrameCacheEntry } from '../core/types';
import type { TimelineRuntimeAdmissionDecision } from '../../services/timeline/runtimeCoordinatorTypes';
import {
  BackgroundPreloadController,
  type BackgroundScrubCacheStats,
} from './scrubbingCache/backgroundPreload';
import type { BackgroundPreloadSession } from './scrubbingCache/backgroundSession';
import { quantizeTime } from './scrubbingCache/cacheKeys';
import { LastFrameCache } from './scrubbingCache/lastFrameCache';
import { RamPreviewCache } from './scrubbingCache/ramPreviewCache';
import { ScrubTextureCache } from './scrubbingCache/scrubTextureCache';

const log = Logger.create('ScrubbingCache');

export type { BackgroundScrubCacheStats } from './scrubbingCache/backgroundPreload';

export interface ScrubbingCacheStats {
  count: number;
  maxCount: number;
  fillPct: number;
  approxMemoryMB: number;
  evictions: number;
  budgetMode: 'static';
  background: BackgroundScrubCacheStats;
}

export type WorkerFirstCacheRuntimeOwner = 'source-frame' | 'composite-frame';

export interface WorkerFirstCacheRuntimeRecord {
  readonly cacheId: string;
  readonly owner: WorkerFirstCacheRuntimeOwner;
  readonly entries: number;
  readonly bytes: number;
  readonly allocations: number;
  readonly reuses: number;
  readonly evictions: number;
  readonly transfers: number;
  readonly releases: number;
  readonly leakChecks: number;
}

export interface WorkerFirstCacheRuntimeSnapshot {
  readonly generatedAtMs: number;
  readonly records: readonly WorkerFirstCacheRuntimeRecord[];
}

export class ScrubbingCache {
  private readonly scrubTextureCache: ScrubTextureCache;
  private readonly backgroundPreload: BackgroundPreloadController;
  private readonly lastFrameCache: LastFrameCache;
  private readonly ramPreviewCache = new RamPreviewCache();

  constructor(device: GPUDevice, onBackgroundFrameCached?: () => void) {
    this.scrubTextureCache = new ScrubTextureCache(device);
    this.backgroundPreload = new BackgroundPreloadController(
      this.scrubTextureCache,
      onBackgroundFrameCached
    );
    this.lastFrameCache = new LastFrameCache(device);
  }

  // Compat surface restored after the scrubbingCache/ split: thin delegation
  // so the entry class keeps its de-facto public API (tests and external
  // callers reach these members on the instance).
  get SCRUB_CACHE_MAX_DIMENSION(): number {
    return this.scrubTextureCache.maxDimension;
  }

  get maxGpuCacheFrames(): number {
    return this.ramPreviewCache.maxGpuCacheFrames;
  }

  set maxGpuCacheFrames(value: number) {
    this.ramPreviewCache.maxGpuCacheFrames = value;
  }

  // Resolution-aware downscale to the longest-side cap; returns the original
  // size when already within the cap. Delegates to ScrubTextureCache.
  computeScrubCacheSize(width: number, height: number): { width: number; height: number } {
    return this.scrubTextureCache.computeSize(width, height);
  }

  getOrCreateBackgroundSession(video: HTMLVideoElement): BackgroundPreloadSession | null {
    return this.backgroundPreload.getOrCreateSession(video);
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number): void {
    this.scrubTextureCache.cacheFrameAtTime(video, time);
  }

  preloadAroundTime(
    video: HTMLVideoElement,
    targetTime: number,
    options: { isDragging?: boolean; isPlaying?: boolean } = {}
  ): void {
    this.backgroundPreload.preloadAroundTime(video, targetTime, options);
  }

  getCachedFrame(videoSrc: string, time: number): GPUTextureView | null {
    return this.scrubTextureCache.getCachedFrame(videoSrc, time);
  }

  getCachedFrameEntry(
    videoSrc: string,
    time: number
  ): { view: GPUTextureView; mediaTime: number } | null {
    return this.scrubTextureCache.getCachedFrameEntry(videoSrc, time);
  }

  getNearestCachedFrame(
    videoSrc: string,
    time: number,
    maxDistanceFrames: number = 6
  ): GPUTextureView | null {
    return this.scrubTextureCache.getNearestCachedFrame(videoSrc, time, maxDistanceFrames);
  }

  getNearestCachedFrameEntry(
    videoSrc: string,
    time: number,
    maxDistanceFrames: number = 6
  ): { view: GPUTextureView; mediaTime: number } | null {
    return this.scrubTextureCache.getNearestCachedFrameEntry(videoSrc, time, maxDistanceFrames);
  }

  getCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    return this.scrubTextureCache.getCachedRanges(videoSrc);
  }

  getScrubbingCacheStats(): ScrubbingCacheStats {
    const snapshot = this.scrubTextureCache.getSnapshot();
    const frameFillPct = snapshot.maxFrames > 0
      ? (snapshot.count / snapshot.maxFrames) * 100
      : 0;
    const byteFillPct = snapshot.maxBytes > 0
      ? (snapshot.bytes / snapshot.maxBytes) * 100
      : 0;

    return {
      count: snapshot.count,
      maxCount: snapshot.maxFrames,
      fillPct: Math.round(Math.max(frameFillPct, byteFillPct) * 10) / 10,
      approxMemoryMB: Math.round((snapshot.bytes / (1024 * 1024)) * 100) / 100,
      evictions: snapshot.evictions,
      budgetMode: 'static',
      background: this.backgroundPreload.getStats(),
    };
  }

  getWorkerFirstCacheRuntimeSnapshot(): WorkerFirstCacheRuntimeSnapshot {
    const scrub = this.scrubTextureCache.getRuntimeCacheSnapshot();
    const lastFrame = this.lastFrameCache.getRuntimeCacheSnapshot();
    const ramPreview = this.ramPreviewCache.getRuntimeCacheSnapshot();
    return {
      generatedAtMs: Date.now(),
      records: [
        {
          cacheId: 'scrubbing:texture-cache',
          owner: 'source-frame',
          entries: scrub.entries,
          bytes: scrub.bytes,
          allocations: scrub.allocations,
          reuses: scrub.reuses,
          evictions: scrub.evictions,
          transfers: 0,
          releases: scrub.releases,
          leakChecks: 1,
        },
        {
          cacheId: 'scrubbing:last-frame-cache',
          owner: 'source-frame',
          entries: lastFrame.entries,
          bytes: lastFrame.bytes,
          allocations: lastFrame.allocations,
          reuses: lastFrame.reuses,
          evictions: 0,
          transfers: 0,
          releases: lastFrame.releases,
          leakChecks: 1,
        },
        {
          cacheId: 'ram-preview:composite-cache',
          owner: 'composite-frame',
          entries: ramPreview.composite.entries,
          bytes: ramPreview.composite.bytes,
          allocations: ramPreview.composite.allocations,
          reuses: ramPreview.composite.reuses,
          evictions: ramPreview.composite.evictions,
          transfers: 0,
          releases: ramPreview.composite.releases,
          leakChecks: 1,
        },
        {
          cacheId: 'ram-preview:gpu-frame-cache',
          owner: 'composite-frame',
          entries: ramPreview.gpuFrames.entries,
          bytes: ramPreview.gpuFrames.bytes,
          allocations: ramPreview.gpuFrames.allocations,
          reuses: ramPreview.gpuFrames.reuses,
          evictions: ramPreview.gpuFrames.evictions,
          transfers: ramPreview.gpuFrames.allocations,
          releases: ramPreview.gpuFrames.releases,
          leakChecks: 1,
        },
      ],
    };
  }

  clearScrubbingCache(videoSrc?: string): void {
    this.backgroundPreload.clear(videoSrc);
    this.scrubTextureCache.clear(videoSrc);
  }

  captureVideoFrame(video: HTMLVideoElement, ownerId?: string): boolean {
    return this.lastFrameCache.captureVideoFrame(video, ownerId);
  }

  captureVideoFrameViaImageBitmap(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    return this.lastFrameCache.captureVideoFrameViaImageBitmap(video, ownerId);
  }

  captureVideoFrameAtTime(
    video: HTMLVideoElement,
    mediaTime: number,
    ownerId?: string
  ): boolean {
    return this.lastFrameCache.captureVideoFrameAtTime(video, mediaTime, ownerId);
  }

  captureVideoFrameIfCloser(
    video: HTMLVideoElement,
    targetTime: number,
    candidateTime: number,
    ownerId?: string,
    minIntervalMs: number = 50
  ): boolean {
    return this.lastFrameCache.captureVideoFrameIfCloser(
      video,
      targetTime,
      candidateTime,
      ownerId,
      minIntervalMs
    );
  }

  getLastFrame(
    video: HTMLVideoElement,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    return this.lastFrameCache.getLastFrame(video, ownerId);
  }

  getLastFrameOwner(video: HTMLVideoElement): string | undefined {
    return this.lastFrameCache.getLastFrameOwner(video);
  }

  getLastFrameNearTime(
    video: HTMLVideoElement,
    targetTime: number,
    maxDeltaSeconds: number,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    return this.lastFrameCache.getLastFrameNearTime(video, targetTime, maxDeltaSeconds, ownerId);
  }

  getLastCaptureTime(video: HTMLVideoElement): number {
    return this.lastFrameCache.getLastCaptureTime(video);
  }

  setLastCaptureTime(video: HTMLVideoElement, time: number): void {
    this.lastFrameCache.setLastCaptureTime(video, time);
  }

  getLastPresentedTime(video: HTMLVideoElement): number | undefined {
    return this.lastFrameCache.getLastPresentedTime(video);
  }

  getLastPresentedOwner(video: HTMLVideoElement): string | undefined {
    return this.lastFrameCache.getLastPresentedOwner(video);
  }

  markFramePresented(video: HTMLVideoElement, time: number = video.currentTime, ownerId?: string): void {
    this.lastFrameCache.markFramePresented(video, time, ownerId);
  }

  cleanupVideo(video: HTMLVideoElement): void {
    this.lastFrameCache.cleanupVideo(video);
  }

  quantizeTime(time: number): number {
    return quantizeTime(time);
  }

  canCacheCompositeFrame(
    time: number,
    frameBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): TimelineRuntimeAdmissionDecision {
    return this.ramPreviewCache.canCacheCompositeFrame(time, frameBytes, sampleFrame);
  }

  cacheCompositeFrame(time: number, imageData: ImageData): boolean {
    return this.ramPreviewCache.cacheCompositeFrame(time, imageData);
  }

  getCachedCompositeFrame(time: number): ImageData | null {
    return this.ramPreviewCache.getCachedCompositeFrame(time);
  }

  hasCompositeCacheFrame(time: number): boolean {
    return this.ramPreviewCache.hasCompositeCacheFrame(time);
  }

  getCompositeCacheStats(outputWidth: number, outputHeight: number): { count: number; maxFrames: number; memoryMB: number } {
    return this.ramPreviewCache.getCompositeCacheStats(outputWidth, outputHeight);
  }

  getGpuCachedFrame(time: number): GpuFrameCacheEntry | null {
    return this.ramPreviewCache.getGpuCachedFrame(time);
  }

  canCacheGpuFrame(
    time: number,
    entry: Pick<GpuFrameCacheEntry, 'width' | 'height' | 'format' | 'gpuBytes'>
  ): TimelineRuntimeAdmissionDecision {
    return this.ramPreviewCache.canCacheGpuFrame(time, entry);
  }

  addToGpuCache(time: number, entry: GpuFrameCacheEntry): boolean {
    return this.ramPreviewCache.addToGpuCache(time, entry);
  }

  releaseCompositeRuntimeResources(): void {
    this.ramPreviewCache.releaseCompositeRuntimeResources();
  }

  clearCompositeCache(): void {
    this.ramPreviewCache.clearCompositeCache();
  }

  clearAll(): void {
    this.clearScrubbingCache();
    this.clearCompositeCache();
    this.lastFrameCache.clearAll();

    log.debug('All caches cleared');
  }

  destroy(): void {
    this.clearAll();
  }
}
