// Proxy frame generator using WebCodecs VideoDecoder + parallel OffscreenCanvas → JPEG
// Decodes source video with hardware VideoDecoder, resizes on a pool of OffscreenCanvases,
// then saves individual JPEG frames via convertToBlob for instant scrubbing.

import { Logger } from './logger';
import * as MP4BoxModule from 'mp4box';
import type { MP4ArrayBuffer, MP4VideoTrack, Sample } from '../engine/webCodecsTypes';

const MP4Box = MP4BoxModule as unknown as {
  createFile: typeof MP4BoxModule.createFile;
  DataStream: {
    new (buffer?: unknown, byteOffset?: number, endianness?: number): {
      buffer: ArrayBuffer;
      position?: number;
    };
    BIG_ENDIAN: number;
  };
};

const log = Logger.create('ProxyGenerator');

// Configuration
const PROXY_FPS = 30;
const PROXY_MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.82;
const CANVAS_POOL_SIZE = 8;       // Parallel encoding canvases
const DECODE_BATCH_SIZE = 30;     // Feed 30 samples at a time before yielding
const MAX_PENDING_ENCODE_FRAMES = CANVAS_POOL_SIZE * 8;
const BACKPRESSURE_TARGET_FRAMES = CANVAS_POOL_SIZE * 4;
const BACKPRESSURE_POLL_MS = 5;
const MIN_FLUSH_TIMEOUT_MS = 30000;
const MAX_FLUSH_TIMEOUT_MS = 180000;
const FLUSH_TIMEOUT_PER_SAMPLE_MS = 120;
const FRAME_COUNT_EPSILON = 1e-3;

interface EncodeQueueItem {
  frameIndex: number;
  frame: VideoFrame;
}

interface ProxyGenerationMetrics {
  demuxMs: number;
  decodeFeedMs: number;
  decodeWallMs: number;
  decoderFlushMs: number;
  drawMs: number;
  jpegMs: number;
  saveMs: number;
  backpressureMs: number;
  backpressureWaits: number;
  maxPendingFrames: number;
  decodedOutputFrames: number;
  savedBytes: number;
}

function createMetrics(): ProxyGenerationMetrics {
  return {
    demuxMs: 0,
    decodeFeedMs: 0,
    decodeWallMs: 0,
    decoderFlushMs: 0,
    drawMs: 0,
    jpegMs: 0,
    saveMs: 0,
    backpressureMs: 0,
    backpressureWaits: 0,
    maxPendingFrames: 0,
    decodedOutputFrames: 0,
    savedBytes: 0,
  };
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function ceilFrameCount(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= FRAME_COUNT_EPSILON) {
    return rounded;
  }
  return Math.ceil(value);
}

export function getFirstPresentationCts(samples: Sample[]): number {
  let firstPresentationCts = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    if (Number.isFinite(sample.cts) && sample.cts < firstPresentationCts) {
      firstPresentationCts = sample.cts;
    }
  }
  return Number.isFinite(firstPresentationCts) ? firstPresentationCts : 0;
}

export function getNormalizedSampleTimestampUs(sample: Sample, firstPresentationCts: number): number {
  const normalizedCts = Math.max(0, sample.cts - firstPresentationCts);
  return (normalizedCts / sample.timescale) * 1_000_000;
}

interface AVCConfigurationBox {
  AVCProfileIndication: number;
  profile_compatibility: number;
  AVCLevelIndication: number;
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

interface MP4TrackDetails {
  mdia?: {
    minf?: {
      stbl?: {
        stsd?: {
          entries?: Array<{
            avcC?: AVCConfigurationBox;
          }>;
        };
      };
    };
  };
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: unknown, samples: Sample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: unknown, options: { nbSamples: number }) => void;
  getTrackById: (id: number) => MP4TrackDetails | undefined;
}

interface CanvasSlot {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

class ProxyGeneratorWebCodecs {
  private mp4File: MP4File | null = null;
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
  private encodeWakeResolvers: Array<() => void> = [];
  private decodeDone = false;
  private encodeStopRequested = false;
  private metrics: ProxyGenerationMetrics = createMetrics();
  private lastReportedProgress = -1;

  // Pool of canvases for parallel encoding
  private canvasPool: CanvasSlot[] = [];

  private onProgress: ((progress: number) => void) | null = null;
  private checkCancelled: (() => boolean) | null = null;
  private saveFrame: ((frame: { frameIndex: number; blob: Blob }) => Promise<void>) | null = null;
  private isCancelled = false;

  async generate(
    file: File,
    _mediaFileId: string,
    onProgress: (progress: number) => void,
    checkCancelled: () => boolean,
    saveFrame: (frame: { frameIndex: number; blob: Blob }) => Promise<void>,
    existingFrameIndices?: Set<number>,
  ): Promise<{ frameCount: number; fps: number; frameIndices: Set<number> } | null> {
    this.onProgress = onProgress;
    this.checkCancelled = checkCancelled;
    this.saveFrame = saveFrame;
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
    let resumeFrameIndices = existingFrameIndices;

    // Pre-populate with existing frames for resume
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

      // Load file with MP4Box
      const demuxStart = performance.now();
      const loaded = await this.loadWithMP4Box(file);
      this.metrics.demuxMs += performance.now() - demuxStart;
      if (!loaded) {
        throw new Error('Failed to parse video file or no supported codec found');
      }

      if (
        existingFrameIndices &&
        existingFrameIndices.size > 0 &&
        this.proxyFps < PROXY_FPS &&
        this.getMaxFrameIndex(existingFrameIndices) >= this.totalFrames
      ) {
        this.savedFrameIndices.clear();
        this.processedFrames = 0;
        resumeFrameIndices = undefined;
        log.warn(`Existing proxy frame layout does not match ${this.proxyFps.toFixed(2)}fps; rebuilding frame indices`);
      }

      log.info(`Source: ${this.videoTrack!.video.width}x${this.videoTrack!.video.height} → Proxy: ${this.outputWidth}x${this.outputHeight} @ ${this.proxyFps.toFixed(2)}fps`);

      // Report initial progress if resuming
      if (this.processedFrames > 0 && this.totalFrames > 0) {
        const initialProgress = Math.min(99, Math.round((this.processedFrames / this.totalFrames) * 100));
        this.onProgress?.(initialProgress);
        log.info(`Resume progress: ${initialProgress}% (${this.processedFrames}/${this.totalFrames} frames)`);
      }

      // Initialize canvas pool for parallel encoding
      for (let i = 0; i < CANVAS_POOL_SIZE; i++) {
        const canvas = new OffscreenCanvas(this.outputWidth, this.outputHeight);
        const ctx = canvas.getContext('2d')!;
        this.canvasPool.push({ canvas, ctx });
      }

      // Initialize decoder
      this.initDecoder();

      // Process all samples
      try {
        await this.processSamples();
      } catch (firstError) {
        log.warn('First decode attempt failed, trying without description...');
        this.closeDecodedFrames();
        // Reset to existing frames only (preserve disk state for resume)
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

      // Finalize
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

  private async loadWithMP4Box(file: File): Promise<boolean> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve) => {
      this.mp4File = MP4Box.createFile() as unknown as MP4File;
      const mp4File = this.mp4File!;
      let expectedSamples = 0;
      let samplesReady = false;
      let codecReady = false;

      const checkComplete = () => {
        if (codecReady && samplesReady) {
          log.info(`Extracted ${this.samples.length} samples from video`);
          resolve(true);
        }
      };

      mp4File.onReady = async (info: { videoTracks: MP4VideoTrack[] }) => {
        if (info.videoTracks.length === 0) {
          resolve(false);
          return;
        }

        this.videoTrack = info.videoTracks[0];
        const track = this.videoTrack;
        expectedSamples = track.nb_samples;

        // Calculate output dimensions
        let width = track.video.width;
        let height = track.video.height;
        if (width > PROXY_MAX_WIDTH) {
          height = Math.round((PROXY_MAX_WIDTH / width) * height);
          width = PROXY_MAX_WIDTH;
        }
        // Ensure even dimensions
        this.outputWidth = width & ~1;
        this.outputHeight = height & ~1;

        this.duration = track.duration / track.timescale;
        const sourceFps = this.duration > 0 ? expectedSamples / this.duration : PROXY_FPS;
        this.proxyFps = Number.isFinite(sourceFps) && sourceFps > 0
          ? Math.min(PROXY_FPS, Math.round(sourceFps * 100) / 100)
          : PROXY_FPS;
        this.totalFrames = ceilFrameCount(this.duration * this.proxyFps);

        log.info(`Duration: ${this.duration.toFixed(3)}s, totalFrames: ${this.totalFrames}, samples: ${expectedSamples}, proxyFps: ${this.proxyFps.toFixed(2)}`);

        // Get codec config
        const trak = this.mp4File!.getTrackById(track.id);
        const codecString = this.getCodecString(track.codec, trak);
        log.debug(`Detected codec: ${codecString}`);

        // Get AVC description
        let description: Uint8Array | undefined;
        if (codecString.startsWith('avc1')) {
          const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
          if (avcC) {
            const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
            avcC.write(stream);
            const totalWritten = stream.position || stream.buffer.byteLength;
            if (totalWritten > 8) {
              description = new Uint8Array(stream.buffer.slice(8, totalWritten));
              log.debug(`Got AVC description: ${description.length} bytes`);
            }
          }
        }

        const config = await this.findSupportedCodec(codecString, track.video.width, track.video.height, description);
        if (!config) {
          resolve(false);
          return;
        }

        this.codecConfig = config;
        codecReady = true;

        mp4File.setExtractionOptions(track.id, null, { nbSamples: Infinity });
        mp4File.start();
        mp4File.flush();
        checkComplete();
      };

      mp4File.onSamples = (_trackId: number, _ref: unknown, samples: Sample[]) => {
        this.samples.push(...samples);
        if (this.samples.length >= expectedSamples) {
          samplesReady = true;
          checkComplete();
        }
      };

      mp4File.onError = (error: string) => {
        log.error('MP4Box error', error);
        resolve(false);
      };

      const fileData = await file.arrayBuffer();

      try {
        const buffer1 = fileData.slice(0) as MP4ArrayBuffer;
        buffer1.fileStart = 0;
        mp4File.appendBuffer(buffer1);
        mp4File.flush();

        // Poll for codec readiness
        const maxCodecWait = 3000;
        const pollStart = performance.now();
        while (!codecReady && performance.now() - pollStart < maxCodecWait) {
          await new Promise(r => setTimeout(r, 20));
        }

        if (!codecReady) {
          log.warn('Codec not ready after polling');
          resolve(false);
          return;
        }

        if (this.samples.length === 0) {
          const buffer2 = fileData.slice(0) as MP4ArrayBuffer;
          buffer2.fileStart = 0;
          mp4File.appendBuffer(buffer2);
          mp4File.flush();
        }

        // Poll for samples
        const maxSampleWait = 3000;
        const samplePollStart = performance.now();
        while (!samplesReady && performance.now() - samplePollStart < maxSampleWait) {
          if (this.samples.length > 0 && this.samples.length >= expectedSamples) {
            samplesReady = true;
            break;
          }
          await new Promise(r => setTimeout(r, 20));
        }

        if (!samplesReady && this.samples.length > 0) {
          samplesReady = true;
        }

        if (samplesReady) {
          checkComplete();
        } else {
          log.error('No samples extracted');
          resolve(false);
        }
      } catch (e) {
        log.error('File read error', e);
        resolve(false);
      }
    });
  }

  private getCodecString(codec: string, trak: MP4TrackDetails | undefined): string {
    if (codec.startsWith('avc1')) {
      const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
      if (avcC) {
        const profile = avcC.AVCProfileIndication.toString(16).padStart(2, '0');
        const compat = avcC.profile_compatibility.toString(16).padStart(2, '0');
        const level = avcC.AVCLevelIndication.toString(16).padStart(2, '0');
        return `avc1.${profile}${compat}${level}`;
      }
      return 'avc1.640028';
    }
    return codec;
  }

  private async findSupportedCodec(
    baseCodec: string,
    width: number,
    height: number,
    description?: Uint8Array
  ): Promise<VideoDecoderConfig | null> {
    const h264Fallbacks = [
      baseCodec,
      'avc1.42001e', 'avc1.4d001e', 'avc1.64001e',
      'avc1.640028', 'avc1.4d0028', 'avc1.42E01E',
      'avc1.4D401E', 'avc1.640029',
    ];

    const codecsToTry = baseCodec.startsWith('avc1') ? h264Fallbacks : [baseCodec];

    for (const codec of codecsToTry) {
      const config: VideoDecoderConfig = {
        codec,
        codedWidth: width,
        codedHeight: height,
        hardwareAcceleration: 'prefer-hardware',
        ...(description && { description }),
      };

      try {
        const support = await VideoDecoder.isConfigSupported(config);
        if (support.supported) {
          log.debug(`Decoder codec ${codec}: supported`);
          return config;
        }
      } catch {
        // Try next
      }
    }

    log.warn(`No supported decoder codec found for ${baseCodec}`);
    return null;
  }

  private initDecoder() {
    if (!this.codecConfig) return;

    let errorCount = 0;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.handleDecodedFrame(frame);
      },
      error: (error) => {
        errorCount++;
        if (errorCount <= 5) {
          log.error('Decoder error', error.message || error);
        }
      },
    });

    this.decoder.configure(this.codecConfig);
    log.debug('Decoder configured', {
      codec: this.codecConfig.codec,
      size: `${this.codecConfig.codedWidth}x${this.codecConfig.codedHeight}`,
    });
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

  private getMaxFrameIndex(frameIndices: Set<number>): number {
    let maxFrameIndex = -1;
    for (const frameIndex of frameIndices) {
      if (frameIndex > maxFrameIndex) maxFrameIndex = frameIndex;
    }
    return maxFrameIndex;
  }

  /**
   * Hand decoded frames to background encode/save workers.
   */
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
    this.encodeWorkers = this.canvasPool.map((slot) => this.encodeWorker(slot));
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
    this.closeQueuedEncodeFrames();
    this.processingFrameIndices.clear();
    this.encodeWakeResolvers = [];
    this.encodeWorkers = [];
    this.decodeDone = false;
    this.encodeStopRequested = false;
  }

  private logPerformance(totalMs: number): void {
    const metrics = this.metrics;
    const encodedFrames = Math.max(1, this.processedFrames);

    log.info('Performance', {
      frames: `${this.processedFrames}/${this.totalFrames}`,
      total: formatMs(totalMs),
      demux: formatMs(metrics.demuxMs),
      decodeWall: formatMs(metrics.decodeWallMs),
      decodeFeed: formatMs(metrics.decodeFeedMs),
      decoderFlush: formatMs(metrics.decoderFlushMs),
      drawImage: formatMs(metrics.drawMs),
      jpegEncode: formatMs(metrics.jpegMs),
      save: formatMs(metrics.saveMs),
      backpressure: formatMs(metrics.backpressureMs),
      backpressureWaits: metrics.backpressureWaits,
      maxPendingFrames: metrics.maxPendingFrames,
      decodedOutputFrames: metrics.decodedOutputFrames,
      avgDraw: formatMs(metrics.drawMs / encodedFrames),
      avgJpeg: formatMs(metrics.jpegMs / encodedFrames),
      avgSave: formatMs(metrics.saveMs / encodedFrames),
      outputMB: Number((metrics.savedBytes / 1024 / 1024).toFixed(2)),
    });
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

      // Feed decoder in batches. Encoding and saving runs on background workers.
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

        // Feed a batch of samples to the decoder
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
          } catch {
            decodeErrors++;
            if (decodeErrors > 50) {
              log.error('Too many decode errors, stopping');
              return;
            }
          }
        }

        // Yield to let decoder output callbacks fire, then hand frames to encode workers.
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

      // Yield to collect last decoded frames.
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
    this.encodeStopRequested = true;
    this.decodeDone = true;
    this.wakeEncodeWorkers();
    this.closeDecodedFrames();
    this.closeQueuedEncodeFrames();
    this.processingFrameIndices.clear();
    this.canvasPool = [];
    this.decoder = null;
  }
}

// Singleton instance
let generatorInstance: ProxyGeneratorWebCodecs | null = null;

export function getProxyGenerator(): ProxyGeneratorWebCodecs {
  if (!generatorInstance) {
    generatorInstance = new ProxyGeneratorWebCodecs();
  }
  return generatorInstance;
}

export { ProxyGeneratorWebCodecs, PROXY_FPS, PROXY_MAX_WIDTH };
