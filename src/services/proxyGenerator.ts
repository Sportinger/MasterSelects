import { Logger } from './logger';
import type { MP4VideoTrack, Sample } from '../engine/webCodecsTypes';
import { VideoEncoderWrapper } from '../engine/export/VideoEncoderWrapper';
import {
  BACKPRESSURE_POLL_MS,
  BACKPRESSURE_TARGET_FRAMES,
  CANVAS_POOL_SIZE,
  DECODE_BATCH_SIZE,
  FLUSH_TIMEOUT_PER_SAMPLE_MS,
  JPEG_QUALITY,
  MAX_FLUSH_TIMEOUT_MS,
  MAX_PENDING_ENCODE_FRAMES,
  MIN_FLUSH_TIMEOUT_MS,
  PROXY_FPS,
  PROXY_MAX_WIDTH,
  getProxyVideoBitrate,
} from './proxyGeneration/constants';
import { createCanvasPool, createCanvasSlot, type CanvasSlot } from './proxyGeneration/canvasPool';
import { createProxyVideoDecoder } from './proxyGeneration/decoder';
import { ProxyFrameEncodeWorkerClient } from './proxyGeneration/frameEncodeWorkerClient';
import { createMetrics, logProxyPerformance, type ProxyGenerationMetrics } from './proxyGeneration/metrics';
import { loadProxyVideoWithMP4Box } from './proxyGeneration/mp4Demuxer';
import {
  getFirstPresentationCts,
  getMaxFrameIndex,
  getNormalizedSampleTimestampUs,
} from './proxyGeneration/sampleTiming';
import {
  canUseDedicatedFrameWorkers,
  getDedicatedFrameWorkerCount,
} from './proxyGeneration/workerCapabilities';

const log = Logger.create('ProxyGenerator');

interface EncodeQueueItem {
  frameIndex: number;
  frame: VideoFrame;
}

type ProxyOutputMode = 'jpeg-sequence' | 'all-intra-mp4';

class ProxyGeneratorWebCodecs {
  private decoder: VideoDecoder | null = null;

  private videoTrack: MP4VideoTrack | null = null;
  private samples: Sample[] = [];
  private codecConfig: VideoDecoderConfig | null = null;

  private outputWidth = 0;
  private outputHeight = 0;
  private duration = 0;
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

  private canvasPool: CanvasSlot[] = [];

  private onProgress: ((progress: number) => void) | null = null;
  private checkCancelled: (() => boolean) | null = null;
  private saveFrame: ((frame: { frameIndex: number; blob: Blob }) => Promise<void>) | null = null;
  private outputMode: ProxyOutputMode = 'jpeg-sequence';
  private videoEncoder: VideoEncoderWrapper | null = null;
  private isCancelled = false;

  async generate(
    file: File,
    _mediaFileId: string,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
    saveFrame: (frame: { frameIndex: number; blob: Blob }) => Promise<void>,
    existingFrameIndices?: Set<number>,
  ): Promise<{ frameCount: number; fps: number; frameIndices: Set<number> } | null> {
    this.resetGenerationState('jpeg-sequence', onProgress, checkCancelled, saveFrame);
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

      if (this.isCancelled || this.processedFrames === 0) {
        this.cleanup();
        if (this.isCancelled) {
          log.info('Generation cancelled');
          return null;
        }
        log.error('No frames were processed!');
        return null;
      }

      log.info(`Proxy complete: ${this.savedFrameIndices.size} frames saved as JPEG`);
      this.cleanup();

      return {
        frameCount: this.savedFrameIndices.size,
        fps: this.proxyFps,
        frameIndices: new Set(this.savedFrameIndices),
      };
    } catch (error) {
      log.error('Generation failed', error);
      this.cleanup();
      throw error;
    }
  }

  async generateAllIntraVideo(
    file: File,
    _mediaFileId: string,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
  ): Promise<{ frameCount: number; fps: number; blob: Blob } | null> {
    this.resetGenerationState('all-intra-mp4', onProgress, checkCancelled, null);
    this.savedFrameIndices.clear();
    this.processedFrames = 0;

    try {
      if (!('VideoDecoder' in window)) {
        throw new Error('WebCodecs VideoDecoder not available');
      }
      if (!('VideoEncoder' in window)) {
        throw new Error('WebCodecs VideoEncoder not available');
      }

      const demuxStart = performance.now();
      const loaded = await this.loadProxyVideo(file);
      this.metrics.demuxMs += performance.now() - demuxStart;
      if (!loaded) {
        throw new Error('Failed to parse video file or no supported codec found');
      }

      log.info(`Source: ${this.videoTrack!.video.width}x${this.videoTrack!.video.height} -> Proxy MP4: ${this.outputWidth}x${this.outputHeight} @ ${this.proxyFps.toFixed(2)}fps`);

      this.canvasPool.push(createCanvasSlot(
        this.outputWidth,
        this.outputHeight,
        'Failed to create proxy video canvas context'
      ));

      const encoder = new VideoEncoderWrapper({
        width: this.outputWidth,
        height: this.outputHeight,
        fps: this.proxyFps,
        codec: 'h264',
        container: 'mp4',
        bitrate: getProxyVideoBitrate(this.outputWidth, this.outputHeight, this.proxyFps),
        rateControl: 'vbr',
        startTime: 0,
        endTime: this.duration,
        includeAudio: false,
      });
      const encoderReady = await encoder.init();
      if (!encoderReady) {
        throw new Error('Failed to initialize all-intra H.264 proxy encoder');
      }
      this.videoEncoder = encoder;

      this.initDecoder();
      await this.processSamples();

      if (this.isCancelled || this.processedFrames === 0) {
        this.cleanup();
        if (this.isCancelled) {
          log.info('All-intra proxy generation cancelled');
          return null;
        }
        log.error('No frames were processed!');
        return null;
      }

      const blob = await encoder.finish();
      this.metrics.savedBytes = blob.size;
      log.info(`All-intra MP4 proxy complete: ${this.processedFrames} frames, ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
      this.logPerformance(performance.now() - demuxStart);
      this.cleanup();

      return {
        frameCount: this.processedFrames,
        fps: this.proxyFps,
        blob,
      };
    } catch (error) {
      log.error('All-intra proxy generation failed', error);
      this.cleanup();
      throw error;
    } finally {
      this.outputMode = 'jpeg-sequence';
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
    this.duration = loaded.duration;
    this.proxyFps = loaded.proxyFps;
    this.totalFrames = loaded.totalFrames;
    return true;
  }

  private resetGenerationState(
    outputMode: ProxyOutputMode,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
    saveFrame: ((frame: { frameIndex: number; blob: Blob }) => Promise<void>) | null
  ): void {
    this.onProgress = onProgress;
    this.checkCancelled = checkCancelled;
    this.saveFrame = saveFrame;
    this.outputMode = outputMode;
    this.isCancelled = false;
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
    this.canvasPool = [];
    this.proxyFps = PROXY_FPS;
  }

  private initDecoder() {
    if (!this.codecConfig) return;
    this.decoder = createProxyVideoDecoder(this.codecConfig, frame => this.handleDecodedFrame(frame), log);
  }

  private handleDecodedFrame(frame: VideoFrame) {
    this.metrics.decodedOutputFrames++;
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
    if (this.outputMode === 'all-intra-mp4') {
      const slots = this.canvasPool.slice(0, 1);
      this.encodeWorkers = slots.map((slot) => this.encodeWorker(slot));
      return;
    }

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
    if (this.outputMode === 'all-intra-mp4') {
      await this.encodeAndMuxVideoFrame(slot, item);
      return;
    }

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

  private async encodeAndMuxVideoFrame(slot: CanvasSlot, item: EncodeQueueItem): Promise<void> {
    let encodedFrame: VideoFrame | null = null;
    try {
      const drawStart = performance.now();
      slot.ctx.drawImage(item.frame, 0, 0, this.outputWidth, this.outputHeight);
      this.metrics.drawMs += performance.now() - drawStart;
      item.frame.close();

      const timestampMicros = Math.round(item.frameIndex * (1_000_000 / this.proxyFps));
      const durationMicros = Math.round(1_000_000 / this.proxyFps);
      encodedFrame = new VideoFrame(slot.canvas, {
        timestamp: timestampMicros,
        duration: durationMicros,
      });

      const encodeStart = performance.now();
      await this.videoEncoder?.encodeVideoFrame(encodedFrame, item.frameIndex, 1);
      if ((this.videoEncoder?.getEncodeQueueSize() ?? 0) > 90) {
        await this.videoEncoder?.flushPendingVideo();
      }
      this.metrics.jpegMs += performance.now() - encodeStart;

      this.savedFrameIndices.add(item.frameIndex);
      this.processedFrames++;
      this.reportProgress();
    } finally {
      encodedFrame?.close();
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
    const decoder = this.decoder;

    const sortedSamples = [...this.samples].sort((a, b) => a.dts - b.dts);
    const firstPresentationCts = getFirstPresentationCts(sortedSamples);

    const keyframeCount = sortedSamples.filter(s => s.is_sync).length;
    log.info(`Decoding ${sortedSamples.length} samples (${keyframeCount} keyframes)...`);
    if (firstPresentationCts > 0) {
      log.debug('Normalizing proxy sample timestamps', {
        firstPresentationCts,
        firstPresentationSeconds: firstPresentationCts / sortedSamples[0].timescale,
      });
    }

    const firstKeyframeIdx = sortedSamples.findIndex(s => s.is_sync);
    if (firstKeyframeIdx === -1) throw new Error('No keyframes found');

    const startTime = performance.now();
    let decodeErrors = 0;
    let primaryError: unknown = null;
    let workerFailureReason: unknown = null;
    this.resetEncodePipeline();
    this.startEncodeWorkers();

    try {
      const decodeWallStart = performance.now();

      for (let batchStart = firstKeyframeIdx; batchStart < sortedSamples.length; batchStart += DECODE_BATCH_SIZE) {
        if (this.checkCancelled?.()) {
          this.isCancelled = true;
          break;
        }

        if (decoder.state === 'closed') {
          log.error('Decoder closed unexpectedly');
          break;
        }

        const batchEnd = Math.min(batchStart + DECODE_BATCH_SIZE, sortedSamples.length);

        for (let i = batchStart; i < batchEnd; i++) {
          const sample = sortedSamples[i];

          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: getNormalizedSampleTimestampUs(sample, firstPresentationCts),
            duration: (sample.duration / sample.timescale) * 1_000_000,
            data: sample.data,
          });

          try {
            const feedStart = performance.now();
            decoder.decode(chunk);
            this.metrics.decodeFeedMs += performance.now() - feedStart;
          } catch (error) {
            decodeErrors++;
            if (decodeErrors <= 5) {
              log.error('Decode chunk failed', error);
            }
            if (decodeErrors > 50) {
              log.error('Too many decode errors, stopping');
              return;
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 0));
        this.queueDecodedFrames();
        await this.waitForEncodeBackpressure();
      }

      const flushTimeoutMs = Math.max(
        MIN_FLUSH_TIMEOUT_MS,
        Math.min(MAX_FLUSH_TIMEOUT_MS, sortedSamples.length * FLUSH_TIMEOUT_PER_SAMPLE_MS)
      );
      const flushStart = performance.now();
      const flushed = await this.flushDecoder(flushTimeoutMs);
      this.metrics.decoderFlushMs += performance.now() - flushStart;
      if (!flushed && !this.isCancelled) {
        throw new Error(`Decoder flush timed out after ${flushTimeoutMs}ms`);
      }

      this.metrics.decodeWallMs += performance.now() - decodeWallStart;

      try {
        if (decoder.state !== 'closed') decoder.close();
      } catch { /* ignore */ }

      await new Promise(resolve => setTimeout(resolve, 10));
      this.queueDecodedFrames();
    } catch (error) {
      primaryError = error;
      this.encodeStopRequested = true;
      throw error;
    } finally {
      if (this.encodeStopRequested) {
        this.closeDecodedFrames();
      } else {
        this.queueDecodedFrames();
      }

      this.decodeDone = true;
      this.wakeEncodeWorkers();

      const workerResults = await Promise.allSettled(this.encodeWorkers);
      const workerFailure = workerResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (!primaryError && workerFailure) {
        workerFailureReason = workerFailure.reason;
      }
    }

    if (workerFailureReason) {
      throw workerFailureReason;
    }

    const totalTime = performance.now() - startTime;
    const fps = this.processedFrames / (totalTime / 1000);
    log.info(`Complete: ${this.processedFrames}/${this.totalFrames} frames in ${(totalTime / 1000).toFixed(1)}s (${fps.toFixed(1)} fps encode)`);
    this.logPerformance(totalTime);
  }

  private async flushDecoder(timeoutMs: number): Promise<boolean> {
    if (!this.decoder || this.decoder.state === 'closed') return true;
    const decoder = this.decoder;

    let settled = false;
    let succeeded = false;
    const startedAt = performance.now();

    const flushPromise = decoder.flush()
      .then(() => {
        succeeded = true;
      })
      .catch((error) => {
        log.warn('Decoder flush failed', error);
      })
      .finally(() => {
        settled = true;
      });

    while (!settled) {
      if (this.checkCancelled?.()) {
        this.isCancelled = true;
        break;
      }

      this.queueDecodedFrames();
      await this.waitForEncodeBackpressure();
      if (this.decodedFrames.size === 0) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      if (performance.now() - startedAt > timeoutMs) {
        log.warn('Decoder flush timed out', {
          decodeQueueSize: decoder.decodeQueueSize,
          decodedFrames: this.decodedFrames.size,
          processedFrames: this.processedFrames,
          totalFrames: this.totalFrames,
          timeoutMs,
        });
        break;
      }
    }

    if (settled) {
      await flushPromise;
    }
    return succeeded;
  }

  private closeDecodedFrames() {
    for (const frame of this.decodedFrames.values()) frame.close();
    this.decodedFrames.clear();
  }

  private cleanup() {
    try { this.decoder?.close(); } catch { /* ignore */ }
    try { this.videoEncoder?.cancel(); } catch { /* ignore */ }
    this.encodeStopRequested = true;
    this.decodeDone = true;
    this.wakeEncodeWorkers();
    this.closeDecodedFrames();
    this.closeQueuedEncodeFrames();
    this.disposeFrameEncodeWorkers();
    this.processingFrameIndices.clear();
    this.canvasPool = [];
    this.decoder = null;
    this.videoEncoder = null;
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
