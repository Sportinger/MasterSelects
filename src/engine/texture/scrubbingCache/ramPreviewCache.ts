import { Logger } from '../../../services/logger';
import {
  canRetainRamPreviewCompositeCache,
  canRetainRamPreviewGpuFrame,
  releaseRamPreviewCompositeCacheResource,
  releaseRamPreviewGpuFrameCacheResources,
  releaseRamPreviewGpuFrameResource,
  reportRamPreviewCompositeCache,
  reportRamPreviewGpuFrame,
  type RamPreviewCompositeCacheReport,
  type RamPreviewGpuFrameReport,
} from '../../../services/timeline/ramPreviewRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../../services/timeline/runtimeCoordinatorTypes';
import type { GpuFrameCacheEntry } from '../../core/types';
import { quantizeTime } from './cacheKeys';

const log = Logger.create('ScrubbingCache');

export class RamPreviewCache {
  private compositeCache: Map<number, ImageData> = new Map();
  private maxCompositeFrames = 900;
  private maxCompositeBytes = 512 * 1024 * 1024;
  private compositeBytes = 0;
  private gpuFrameCache: Map<number, GpuFrameCacheEntry> = new Map();
  private maxGpuFrames = 60;

  get maxGpuCacheFrames(): number {
    return this.maxGpuFrames;
  }

  set maxGpuCacheFrames(value: number) {
    this.maxGpuFrames = value;
  }

  createCompositeCacheReport(
    frameCount: number,
    heapBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): RamPreviewCompositeCacheReport {
    return {
      frameCount,
      maxFrames: this.maxCompositeFrames,
      heapBytes,
      width: sampleFrame?.width,
      height: sampleFrame?.height,
    };
  }

  canCacheCompositeFrame(
    time: number,
    frameBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): TimelineRuntimeAdmissionDecision {
    const key = quantizeTime(time);
    const report = this.getProjectedCompositeCacheReport(key, frameBytes, sampleFrame);
    if (report.frameCount <= 0 || report.heapBytes <= 0) {
      return createCompositeCacheDeniedDecision('composite-cache-frame-exceeds-local-budget');
    }
    return canRetainRamPreviewCompositeCache(report);
  }

  cacheCompositeFrame(time: number, imageData: ImageData): boolean {
    const key = quantizeTime(time);
    if (this.compositeCache.has(key)) return true;

    const frameBytes = imageData.data.byteLength;
    const projectedReport = this.getProjectedCompositeCacheReport(key, frameBytes, imageData);
    if (projectedReport.frameCount <= 0 || projectedReport.heapBytes <= 0) return false;

    const admission = canRetainRamPreviewCompositeCache(projectedReport);
    if (!admission.admitted) {
      log.debug('RAM preview composite cache skipped by runtime admission', {
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }

    this.compositeCache.set(key, imageData);
    this.compositeBytes += frameBytes;

    while (
      this.compositeCache.size > this.maxCompositeFrames ||
      this.compositeBytes > this.maxCompositeBytes
    ) {
      const oldestKey = this.compositeCache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.compositeCache.get(oldestKey);
        if (evicted) this.compositeBytes -= evicted.data.byteLength;
        this.compositeCache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.reportCompositeCacheResource(imageData);
    return true;
  }

  getCachedCompositeFrame(time: number): ImageData | null {
    const key = quantizeTime(time);
    const imageData = this.compositeCache.get(key);

    if (imageData) {
      this.compositeCache.delete(key);
      this.compositeCache.set(key, imageData);
      return imageData;
    }
    return null;
  }

  hasCompositeCacheFrame(time: number): boolean {
    return this.compositeCache.has(quantizeTime(time));
  }

  getCompositeCacheStats(_outputWidth: number, _outputHeight: number): { count: number; maxFrames: number; memoryMB: number } {
    const count = this.compositeCache.size;
    const memoryMB = this.compositeBytes / (1024 * 1024);
    return { count, maxFrames: this.maxCompositeFrames, memoryMB };
  }

  getGpuCachedFrame(time: number): GpuFrameCacheEntry | null {
    const key = quantizeTime(time);
    const entry = this.gpuFrameCache.get(key);
    if (entry) {
      this.gpuFrameCache.delete(key);
      this.gpuFrameCache.set(key, entry);
      return entry;
    }
    return null;
  }

  canCacheGpuFrame(
    time: number,
    entry: Pick<GpuFrameCacheEntry, 'width' | 'height' | 'format' | 'gpuBytes'>
  ): TimelineRuntimeAdmissionDecision {
    const report = this.createGpuFrameReport(time, entry);
    return this.prepareGpuCacheAdmission(report.frameKey, report);
  }

  addToGpuCache(time: number, entry: GpuFrameCacheEntry): boolean {
    const key = quantizeTime(time);
    const report = this.createGpuFrameReport(time, entry);
    const admission = this.prepareGpuCacheAdmission(key, report);
    if (!admission.admitted) {
      entry.texture.destroy();
      log.debug('RAM preview GPU frame cache skipped by runtime admission', {
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((rejected) => rejected.unit),
      });
      return false;
    }

    const existing = this.gpuFrameCache.get(key);
    if (existing) {
      existing.texture.destroy();
      releaseRamPreviewGpuFrameResource(key);
      this.gpuFrameCache.delete(key);
    }

    this.gpuFrameCache.set(key, entry);
    reportRamPreviewGpuFrame(report);

    while (this.gpuFrameCache.size > this.maxGpuFrames) {
      if (!this.evictOldestGpuFrame()) break;
    }
    return true;
  }

  releaseCompositeRuntimeResources(): void {
    releaseRamPreviewCompositeCacheResource();
    releaseRamPreviewGpuFrameCacheResources();
  }

  clearCompositeCache(): void {
    this.compositeCache.clear();
    this.compositeBytes = 0;
    releaseRamPreviewCompositeCacheResource();

    for (const entry of this.gpuFrameCache.values()) {
      entry.texture.destroy();
    }
    this.gpuFrameCache.clear();
    releaseRamPreviewGpuFrameCacheResources();

    log.debug('Composite cache cleared');
  }

  private getProjectedCompositeCacheReport(
    key: number,
    frameBytes: number,
    sampleFrame?: Pick<ImageData, 'width' | 'height'>
  ): RamPreviewCompositeCacheReport {
    if (this.compositeCache.has(key)) {
      return this.createCompositeCacheReport(this.compositeCache.size, this.compositeBytes, sampleFrame);
    }

    const entries = Array.from(this.compositeCache, ([entryKey, frame]) => ({
      key: entryKey,
      bytes: frame.data.byteLength,
    }));
    entries.push({ key, bytes: frameBytes });
    let projectedBytes = this.compositeBytes + frameBytes;

    while (entries.length > this.maxCompositeFrames || projectedBytes > this.maxCompositeBytes) {
      const evicted = entries.shift();
      if (!evicted) break;
      projectedBytes -= evicted.bytes;
    }

    return this.createCompositeCacheReport(entries.length, Math.max(0, projectedBytes), sampleFrame);
  }

  private reportCompositeCacheResource(sampleFrame?: ImageData): void {
    reportRamPreviewCompositeCache(
      this.createCompositeCacheReport(this.compositeCache.size, this.compositeBytes, sampleFrame)
    );
  }

  private createGpuFrameReport(
    time: number,
    entry: Pick<GpuFrameCacheEntry, 'width' | 'height' | 'format' | 'gpuBytes'>
  ): RamPreviewGpuFrameReport {
    return {
      frameKey: quantizeTime(time),
      time,
      width: entry.width,
      height: entry.height,
      format: entry.format,
      gpuBytes: entry.gpuBytes,
    };
  }

  private evictOldestGpuFrame(excludedKey?: number): boolean {
    for (const oldestKey of this.gpuFrameCache.keys()) {
      if (oldestKey === excludedKey) continue;
      const evicted = this.gpuFrameCache.get(oldestKey);
      if (evicted) evicted.texture.destroy();
      releaseRamPreviewGpuFrameResource(oldestKey);
      this.gpuFrameCache.delete(oldestKey);
      return true;
    }
    return false;
  }

  private prepareGpuCacheAdmission(
    frameKey: number,
    report: RamPreviewGpuFrameReport
  ): TimelineRuntimeAdmissionDecision {
    let admission = canRetainRamPreviewGpuFrame(report);
    while (
      !admission.admitted &&
      admission.rejectedUnits.some((entry) =>
        entry.unit === 'resource' || entry.unit === 'gpu-texture' || entry.unit === 'gpu-bytes'
      ) &&
      this.evictOldestGpuFrame(frameKey)
    ) {
      admission = canRetainRamPreviewGpuFrame(report);
    }
    return admission;
  }
}

function createCompositeCacheDeniedDecision(reason: string): TimelineRuntimeAdmissionDecision {
  return {
    admitted: false,
    resourceId: 'ram-preview:composite-cache:image-data',
    policyId: 'ram-preview',
    reason,
    projectedUsage: {
      resources: 0,
      sessions: 0,
      frameProviders: 0,
      htmlMediaElements: 0,
      nativeDecoders: 0,
      gpuTextures: 0,
      imageBitmaps: 0,
      audioSources: 0,
      jobs: 0,
      heapBytes: 0,
      gpuBytes: 0,
    },
    pressure: [],
    rejectedUnits: [],
  };
}
