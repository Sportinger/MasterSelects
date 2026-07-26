import { Logger } from './logger';
import type { MP4VideoTrack, Sample } from '../engine/webCodecsTypes';
import {
  BACKPRESSURE_POLL_MS,
  BACKPRESSURE_TARGET_FRAMES,
  CANVAS_POOL_SIZE,
  JPEG_QUALITY,
  MAX_PENDING_ENCODE_FRAMES,
  PROXY_FPS,
  PROXY_MAX_WIDTH,
} from './proxyGeneration/constants';
import { createCanvasPool, type CanvasSlot } from './proxyGeneration/canvasPool';
import { createProxyVideoDecoder } from './proxyGeneration/decoder';
import {
  processProxySamples,
  type ProxySampleProcessingResult,
} from './proxyGeneration/decodePipeline';
import { ProxyFrameEncodeWorkerClient } from './proxyGeneration/frameEncodeWorkerClient';
import { createMetrics, logProxyPerformance, type ProxyGenerationMetrics } from './proxyGeneration/metrics';
import { loadProxyVideoWithMP4Box } from './proxyGeneration/mp4Demuxer';
import {
  getDurationSecondsFromSamples,
  getMaxFrameIndex,
} from './proxyGeneration/sampleTiming';
import {
  canUseDedicatedFrameWorkers,
  getDedicatedFrameWorkerCount,
} from './proxyGeneration/workerCapabilities';
import { ProxySceneCutAnalyzer } from './sceneCutDetection/proxySceneCutAnalyzer';
import { getSceneCutCompletenessError } from './sceneCutDetection/sceneCutDetector';
import type { SceneCutAnalysis } from '../types/sceneCutAnalysis';

const log = Logger.create('ProxyGenerator');

interface EncodeQueueItem {
  frameIndex: number;
  frame: VideoFrame;
}

export interface ProxyGenerationOptions {
  analyzeSceneCuts?: boolean;
  sceneCutsOnly?: boolean;
  onSceneCutProgress?: (progress: number) => void;
}

class ProxyGeneratorWebCodecs {
  private decoder: VideoDecoder | null = null;

  private videoTrack: MP4VideoTrack | null = null;
  private samples: Sample[] = [];
  private codecConfig: VideoDecoderConfig | null = null;

  private outputWidth = 0;
  private outputHeight = 0;
  private proxyFps = PROXY_FPS;
  private totalFrames = 0;
  private processedFrames = 0;
  private savedFrameIndices = new Set<number>();
  private decodedFrames: Map<number, VideoFrame> = new Map();
  private processingFrameIndices = new Set<number>();
  private encodeQueue: EncodeQueueItem[] = [];
  private encodeWorkers: Promise<void>[] = [];
  private frameEncodeWorkers: ProxyFrameEncodeWorkerClient[] = [];
  private encodeWakeResolvers: Array<() => void> = [];
  private decodeDone = false;
  private encodeStopRequested = false;
  private metrics: ProxyGenerationMetrics = createMetrics();
  private lastReportedProgress = -1;
  private sceneCutAnalyzer: ProxySceneCutAnalyzer | null = null;
  private sceneCutError: Error | null = null;
  private sceneCutProgress = -1;
  private decodeResult: ProxySampleProcessingResult | null = null;
  private sourceFingerprint = { size: 0, lastModified: 0 };
  private sceneCutsOnly = false;

  private canvasPool: CanvasSlot[] = [];

  private onProgress: ((progress: number) => void) | null = null;
  private checkCancelled: (() => boolean) | null = null;
  private saveFrame: ((frame: { frameIndex: number; blob: Blob }) => Promise<void>) | null = null;
  private onSceneCutProgress: ((progress: number) => void) | null = null;
  private isCancelled = false;

  async generate(
    file: File,
    _mediaFileId: string,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
    saveFrame: (frame: { frameIndex: number; blob: Blob }) => Promise<void>,
    existingFrameIndices?: Set<number>,
    options: ProxyGenerationOptions = {},
  ): Promise<{
    frameCount: number;
    fps: number;
    frameIndices: Set<number>;
    sceneCutAnalysis?: SceneCutAnalysis;
    sceneCutError?: string;
  } | null> {
    this.resetGenerationState(file, onProgress, checkCancelled, saveFrame, options);
    let resumeFrameIndices = existingFrameIndices;

    if (resumeFrameIndices && resumeFrameIndices.size > 0) {
      this.savedFrameIndices = new Set(resumeFrameIndices);
      this.processedFrames = resumeFrameIndices.size;
      log.info(`Resuming: ${resumeFrameIndices.size} frames already on disk`);
    } else {
      this.savedFrameIndices.clear();
      this.processedFrames = 0;
    }

    try {
      if (!('VideoDecoder' in window)) {
        throw new Error('WebCodecs VideoDecoder not available');
      }

      const demuxStart = performance.now();
      const loaded = await this.loadProxyVideo(file);
      this.metrics.demuxMs += performance.now() - demuxStart;
      if (!loaded) {
        throw new Error('Failed to parse video file or no supported codec found');
      }

      if (
        existingFrameIndices &&
        existingFrameIndices.size > 0 &&
        this.proxyFps < PROXY_FPS &&
        getMaxFrameIndex(existingFrameIndices) >= this.totalFrames
      ) {
        this.savedFrameIndices.clear();
        this.processedFrames = 0;
        resumeFrameIndices = undefined;
        log.warn(`Existing proxy frame layout does not match ${this.proxyFps.toFixed(2)}fps; rebuilding frame indices`);
      }

      log.info(`Source: ${this.videoTrack!.video.width}x${this.videoTrack!.video.height} -> Proxy: ${this.outputWidth}x${this.outputHeight} @ ${this.proxyFps.toFixed(2)}fps`);

      if (this.processedFrames > 0 && this.totalFrames > 0) {
        const initialProgress = Math.min(99, Math.round((this.processedFrames / this.totalFrames) * 100));
        this.onProgress?.(initialProgress);
        log.info(`Resume progress: ${initialProgress}% (${this.processedFrames}/${this.totalFrames} frames)`);
      }

      this.initDecoder();
      try {
        await this.processSamples();
      } catch (firstError) {
        log.warn('First decode attempt failed, trying without description...');
        this.closeDecodedFrames();
        this.resetSceneCutAnalyzer(options.analyzeSceneCuts === true);
        this.decodeResult = null;
        this.metrics.decodedOutputFrames = 0;
        const existingCount = resumeFrameIndices?.size ?? 0;
        this.processedFrames = existingCount;
        this.savedFrameIndices = resumeFrameIndices ? new Set(resumeFrameIndices) : new Set();

        if (this.codecConfig?.description) {
          const configWithoutDesc: VideoDecoderConfig = {
            codec: this.codecConfig.codec,
            codedWidth: this.codecConfig.codedWidth,
            codedHeight: this.codecConfig.codedHeight,
          };
          const support = await VideoDecoder.isConfigSupported(configWithoutDesc);
          if (support.supported) {
            log.info('Retrying without description...');
            this.codecConfig = configWithoutDesc;
            this.decoder?.close();
            this.initDecoder();
            await this.processSamples();
          } else {
            throw firstError;
          }
        } else {
          throw firstError;
        }
      }

      if (
        this.isCancelled ||
        (
          !this.sceneCutsOnly &&
          this.processedFrames === 0
        ) ||
        (
          this.sceneCutsOnly &&
          this.metrics.decodedOutputFrames === 0
        )
      ) {
        this.cleanup();
        if (this.isCancelled) {
          log.info('Generation cancelled');
          return null;
        }
        log.error('No frames were processed!');
        return null;
      }

      if (!this.sceneCutsOnly) {
        log.info(`Proxy complete: ${this.savedFrameIndices.size} frames saved as JPEG`);
      }
      const sceneCutAnalysis = await this.completeSceneCutAnalysis();
      const sceneCutError = this.sceneCutError?.message;
      if (sceneCutAnalysis) {
        this.onSceneCutProgress?.(100);
      }
      this.cleanup();

      return {
        frameCount: this.savedFrameIndices.size,
        fps: this.proxyFps,
        frameIndices: new Set(this.savedFrameIndices),
        sceneCutAnalysis,
        sceneCutError,
      };
    } catch (error) {
      log.error('Generation failed', error);
      this.cleanup();
      throw error;
    }
  }

  private async loadProxyVideo(file: File): Promise<boolean> {
    const loaded = await loadProxyVideoWithMP4Box(file, log);
    if (!loaded) return false;

    this.videoTrack = loaded.videoTrack;
    this.samples = loaded.samples;
    this.codecConfig = loaded.codecConfig;
    this.outputWidth = loaded.outputWidth;
    this.outputHeight = loaded.outputHeight;
    this.proxyFps = loaded.proxyFps;
    this.totalFrames = loaded.totalFrames;
    return true;
  }

  private resetGenerationState(
    file: File,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
    saveFrame: (frame: { frameIndex: number; blob: Blob }) => Promise<void>,
    options: ProxyGenerationOptions,
  ): void {
    this.onProgress = onProgress;
    this.checkCancelled = checkCancelled;
    this.saveFrame = saveFrame;
    this.onSceneCutProgress = options.onSceneCutProgress ?? null;
    this.isCancelled = false;
    this.sceneCutsOnly = options.sceneCutsOnly === true;
    this.sourceFingerprint = {
      size: file.size,
      lastModified: file.lastModified,
    };
    this.samples = [];
    this.decodedFrames.clear();
    this.processingFrameIndices.clear();
    this.closeQueuedEncodeFrames();
    this.encodeWorkers = [];
    this.encodeWakeResolvers = [];
    this.decodeDone = false;
    this.encodeStopRequested = false;
    this.metrics = createMetrics();
    this.lastReportedProgress = -1;
    this.sceneCutProgress = -1;
    this.decodeResult = null;
    this.canvasPool = [];
    this.proxyFps = PROXY_FPS;
    this.resetSceneCutAnalyzer(options.analyzeSceneCuts === true);
  }

  private initDecoder() {
    if (!this.codecConfig) return;
    this.decoder = createProxyVideoDecoder(this.codecConfig, frame => this.handleDecodedFrame(frame), log);
  }

  private handleDecodedFrame(frame: VideoFrame) {
    this.metrics.decodedOutputFrames++;
    if (this.sceneCutAnalyzer && !this.sceneCutError) {
      try {
        this.sceneCutAnalyzer.analyze(frame);
      } catch (error) {
        this.sceneCutError = error instanceof Error ? error : new Error(String(error));
        log.warn('Scene-cut analysis failed; proxy generation will continue', this.sceneCutError);
      }
    }
    this.reportSceneCutProgress();
    if (this.sceneCutsOnly) {
      frame.close();
      return;
    }
    const timestamp = frame.timestamp / 1_000_000;
    const frameIndex = Math.round(timestamp * this.proxyFps);

    if (
      frameIndex >= 0 &&
      frameIndex < this.totalFrames &&
      !this.savedFrameIndices.has(frameIndex) &&
      !this.processingFrameIndices.has(frameIndex)
    ) {
      const existing = this.decodedFrames.get(frameIndex);
      if (existing) existing.close();
      this.decodedFrames.set(frameIndex, frame);
      this.updateMaxPendingFrames();
    } else {
      frame.close();
    }
  }

  private queueDecodedFrames(): void {
    if (this.decodedFrames.size === 0 || this.encodeStopRequested) return;

    const sortedIndices = Array.from(this.decodedFrames.keys()).sort((a, b) => a - b);
    for (const frameIndex of sortedIndices) {
      const frame = this.decodedFrames.get(frameIndex);
      if (!frame) continue;

      this.decodedFrames.delete(frameIndex);

      if (this.savedFrameIndices.has(frameIndex) || this.processingFrameIndices.has(frameIndex)) {
        frame.close();
        continue;
      }

      this.processingFrameIndices.add(frameIndex);
      this.encodeQueue.push({ frameIndex, frame });
    }

    this.updateMaxPendingFrames();
    this.wakeEncodeWorkers();
  }

  private startEncodeWorkers(): void {
    if (this.sceneCutsOnly) return;
    if (canUseDedicatedFrameWorkers()) {
      const workerCount = getDedicatedFrameWorkerCount();
      this.frameEncodeWorkers = Array.from(
        { length: workerCount },
        () => new ProxyFrameEncodeWorkerClient(this.outputWidth, this.outputHeight, JPEG_QUALITY)
      );
      this.encodeWorkers = this.frameEncodeWorkers.map((worker) => this.encodeWorkerWithDedicatedWorker(worker));
      log.info(`Using ${workerCount} Dedicated Workers for JPEG proxy frame encoding`);
      return;
    }

    this.initializeCanvasPool(CANVAS_POOL_SIZE);
    this.encodeWorkers = this.canvasPool.map((slot) => this.encodeWorker(slot));
    log.warn('Dedicated proxy frame workers unavailable; using main-thread OffscreenCanvas encode pool');
  }

  private initializeCanvasPool(size: number): void {
    if (this.canvasPool.length > 0) return;
    this.canvasPool = createCanvasPool(size, this.outputWidth, this.outputHeight);
  }

  private async encodeWorker(slot: CanvasSlot): Promise<void> {
    while (true) {
      if (this.encodeStopRequested) {
        this.closeQueuedEncodeFrames();
        return;
      }

      const item = this.encodeQueue.shift();
      if (item) {
        await this.encodeAndSaveFrame(slot, item);
        continue;
      }

      if (this.decodeDone) {
        return;
      }

      await this.waitForEncodeWork();
    }
  }

  private async encodeWorkerWithDedicatedWorker(worker: ProxyFrameEncodeWorkerClient): Promise<void> {
    while (true) {
      if (this.encodeStopRequested) {
        this.closeQueuedEncodeFrames();
        return;
      }

      const item = this.encodeQueue.shift();
      if (item) {
        await this.encodeAndSaveFrameInDedicatedWorker(worker, item);
        continue;
      }

      if (this.decodeDone) {
        return;
      }

      await this.waitForEncodeWork();
    }
  }

  private async encodeAndSaveFrameInDedicatedWorker(
    worker: ProxyFrameEncodeWorkerClient,
    item: EncodeQueueItem
  ): Promise<void> {
    try {
      const encoded = await worker.encode(item.frameIndex, item.frame);
      this.metrics.drawMs += encoded.drawMs;
      this.metrics.jpegMs += encoded.jpegMs;
      this.metrics.savedBytes += encoded.size;

      const saveStart = performance.now();
      await this.saveFrame!({ frameIndex: encoded.frameIndex, blob: encoded.blob });
      this.metrics.saveMs += performance.now() - saveStart;

      this.savedFrameIndices.add(encoded.frameIndex);
      this.processedFrames++;
      this.reportProgress();
    } finally {
      this.processingFrameIndices.delete(item.frameIndex);
      try {
        item.frame.close();
      } catch {
        // Frame ownership may have moved to a Dedicated Worker.
      }
      this.wakeEncodeWorkers();
    }
  }

  private async encodeAndSaveFrame(slot: CanvasSlot, item: EncodeQueueItem): Promise<void> {
    try {
      const drawStart = performance.now();
      slot.ctx.drawImage(item.frame, 0, 0, this.outputWidth, this.outputHeight);
      this.metrics.drawMs += performance.now() - drawStart;
      item.frame.close();

      const jpegStart = performance.now();
      const blob = await slot.canvas.convertToBlob({
        type: 'image/jpeg',
        quality: JPEG_QUALITY,
      });
      this.metrics.jpegMs += performance.now() - jpegStart;
      this.metrics.savedBytes += blob.size;

      const saveStart = performance.now();
      await this.saveFrame!({ frameIndex: item.frameIndex, blob });
      this.metrics.saveMs += performance.now() - saveStart;

      this.savedFrameIndices.add(item.frameIndex);
      this.processedFrames++;
      this.reportProgress();
    } finally {
      this.processingFrameIndices.delete(item.frameIndex);
      try {
        item.frame.close();
      } catch {
        // Frame may already be closed after drawImage.
      }
      this.wakeEncodeWorkers();
    }
  }

  private waitForEncodeWork(): Promise<void> {
    return new Promise(resolve => {
      this.encodeWakeResolvers.push(resolve);
    });
  }

  private wakeEncodeWorkers(): void {
    const resolvers = this.encodeWakeResolvers.splice(0);
    resolvers.forEach(resolve => resolve());
  }

  private async waitForEncodeBackpressure(): Promise<void> {
    while (!this.isCancelled && !this.encodeStopRequested && this.getPendingEncodeFrameCount() > MAX_PENDING_ENCODE_FRAMES) {
      const waitStart = performance.now();
      this.metrics.backpressureWaits++;
      await new Promise(resolve => setTimeout(resolve, BACKPRESSURE_POLL_MS));
      this.metrics.backpressureMs += performance.now() - waitStart;

      if (this.getPendingEncodeFrameCount() <= BACKPRESSURE_TARGET_FRAMES) {
        break;
      }
    }
  }

  private getPendingEncodeFrameCount(): number {
    return this.processingFrameIndices.size + this.decodedFrames.size;
  }

  private updateMaxPendingFrames(): void {
    this.metrics.maxPendingFrames = Math.max(this.metrics.maxPendingFrames, this.getPendingEncodeFrameCount());
  }

  private reportProgress(): void {
    if (this.totalFrames <= 0) return;
    const progress = Math.min(100, Math.round((this.processedFrames / this.totalFrames) * 100));
    if (progress !== this.lastReportedProgress) {
      this.lastReportedProgress = progress;
      this.onProgress?.(progress);
    }
  }

  private closeQueuedEncodeFrames(): void {
    for (const item of this.encodeQueue) {
      this.processingFrameIndices.delete(item.frameIndex);
      item.frame.close();
    }
    this.encodeQueue = [];
  }

  private resetEncodePipeline(): void {
    this.disposeFrameEncodeWorkers();
    this.closeQueuedEncodeFrames();
    this.processingFrameIndices.clear();
    this.encodeWakeResolvers = [];
    this.encodeWorkers = [];
    this.decodeDone = false;
    this.encodeStopRequested = false;
  }

  private disposeFrameEncodeWorkers(): void {
    for (const worker of this.frameEncodeWorkers) {
      worker.dispose();
    }
    this.frameEncodeWorkers = [];
  }

  private logPerformance(totalMs: number): void {
    logProxyPerformance(log, totalMs, this.processedFrames, this.totalFrames, this.metrics);
  }

  private async processSamples(): Promise<void> {
    if (!this.decoder) return;
    this.decodeResult = await processProxySamples({
      decoder: this.decoder,
      samples: this.samples,
      metrics: this.metrics,
      totalFrames: this.totalFrames,
      getProcessedFrames: () => this.processedFrames,
      isCancelled: () => this.isCancelled,
      checkCancelled: () => Boolean(this.checkCancelled?.()),
      markCancelled: () => {
        this.isCancelled = true;
      },
      resetEncodePipeline: () => this.resetEncodePipeline(),
      startEncodeWorkers: () => this.startEncodeWorkers(),
      queueDecodedFrames: () => this.queueDecodedFrames(),
      waitForEncodeBackpressure: () => this.waitForEncodeBackpressure(),
      waitForSceneCutBackpressure: () => this.waitForSceneCutBackpressure(),
      isSceneCutAnalysisActive: () => Boolean(this.sceneCutAnalyzer && !this.sceneCutError),
      getDecodedFrameCount: () => this.decodedFrames.size,
      closeDecodedFrames: () => this.closeDecodedFrames(),
      isEncodeStopRequested: () => this.encodeStopRequested,
      requestEncodeStop: () => {
        this.encodeStopRequested = true;
      },
      setDecodeDone: () => {
        this.decodeDone = true;
      },
      wakeEncodeWorkers: () => this.wakeEncodeWorkers(),
      waitForEncodeWorkers: () => Promise.allSettled(this.encodeWorkers),
      logPerformance: (totalMs) => this.logPerformance(totalMs),
      log,
    });
  }

  private closeDecodedFrames() {
    for (const frame of this.decodedFrames.values()) frame.close();
    this.decodedFrames.clear();
  }

  private resetSceneCutAnalyzer(enabled: boolean): void {
    this.sceneCutAnalyzer?.dispose();
    this.sceneCutAnalyzer = null;
    this.sceneCutError = null;
    this.sceneCutProgress = -1;
    if (!enabled) return;
    try {
      this.sceneCutAnalyzer = new ProxySceneCutAnalyzer();
      log.debug(`Scene-cut analysis backend: ${this.sceneCutAnalyzer.backend}`);
    } catch (error) {
      this.sceneCutAnalyzer = null;
      this.sceneCutError = error instanceof Error ? error : new Error(String(error));
      log.warn('Could not initialize scene-cut analysis; proxy generation will continue', this.sceneCutError);
    }
  }

  private async waitForSceneCutBackpressure(): Promise<void> {
    if (!this.sceneCutAnalyzer || this.sceneCutError) return;
    try {
      await this.sceneCutAnalyzer.waitForBackpressure();
    } catch (error) {
      this.sceneCutError = error instanceof Error ? error : new Error(String(error));
      this.sceneCutAnalyzer.dispose();
      this.sceneCutAnalyzer = null;
      log.warn('Scene-cut worker failed; proxy generation will continue', this.sceneCutError);
    }
  }

  private reportSceneCutProgress(): void {
    if (!this.sceneCutAnalyzer || this.samples.length === 0) return;
    const progress = Math.min(
      99,
      Math.floor((this.metrics.decodedOutputFrames / this.samples.length) * 100),
    );
    if (progress === this.sceneCutProgress) return;
    this.sceneCutProgress = progress;
    this.onSceneCutProgress?.(progress);
  }

  private async completeSceneCutAnalysis(): Promise<SceneCutAnalysis | undefined> {
    if (!this.sceneCutAnalyzer || this.sceneCutError) return undefined;
    if (!this.decodeResult) return undefined;
    try {
      const analysis = await this.sceneCutAnalyzer.complete(
        getDurationSecondsFromSamples(this.samples),
        this.decodeResult.expectedFrameCount,
        this.sourceFingerprint,
      );
      const completenessError = getSceneCutCompletenessError(
        analysis,
        this.decodeResult,
      );
      if (completenessError) {
        this.sceneCutError = new Error(completenessError);
        return undefined;
      }
      return analysis;
    } catch (error) {
      this.sceneCutError = error instanceof Error ? error : new Error(String(error));
      log.warn('Could not finalize scene-cut analysis', this.sceneCutError);
      return undefined;
    }
  }

  private cleanup() {
    try { this.decoder?.close(); } catch { /* ignore */ }
    this.encodeStopRequested = true;
    this.decodeDone = true;
    this.wakeEncodeWorkers();
    this.closeDecodedFrames();
    this.closeQueuedEncodeFrames();
    this.disposeFrameEncodeWorkers();
    this.processingFrameIndices.clear();
    this.canvasPool = [];
    this.decoder = null;
    this.sceneCutAnalyzer?.dispose();
    this.sceneCutAnalyzer = null;
  }
}

let generatorInstance: ProxyGeneratorWebCodecs | null = null;

export function getProxyGenerator(): ProxyGeneratorWebCodecs {
  if (!generatorInstance) {
    generatorInstance = new ProxyGeneratorWebCodecs();
  }
  return generatorInstance;
}

export {
  getDurationSecondsFromSamples,
  getFirstPresentationCts,
  getNormalizedSampleTimestampUs,
} from './proxyGeneration/sampleTiming';
export { ProxyGeneratorWebCodecs, PROXY_FPS, PROXY_MAX_WIDTH };
