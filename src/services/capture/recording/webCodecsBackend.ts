import { flags } from '../../../engine/featureFlags';
import { useTimelineStore } from '../../../stores/timeline';
import { suspendPerformanceQualityReset } from '../../performanceMonitor';
import type { ScreenCaptureBackend } from '../ScreenCaptureService';
import { CaptureMuxer } from './captureMuxer';
import { CaptureAudioEncoder, detectCaptureAudioCodec } from './captureAudioEncoder';
import { CaptureVideoEncoder } from './captureVideoEncoder';
import { createCaptureAudioTap, getCaptureAudioFormat, type CapturePcmChunk } from './audioMixing';
import { transformCaptureFrame, resolveCaptureOutputSize } from './frameTransform';
import { MediaRecorderCaptureBackend } from './mediaRecorderBackend';
import {
  appendCaptureRecoveryChunk,
  ArtifactCaptureRecordingBlobStore,
  deleteCaptureRecoveryEntry,
  getCaptureRecoveryStorage,
  readCaptureRecoveryEntries,
  upsertCaptureRecoveryEntry,
  type CaptureRecoveryBlobStore,
} from './recoveryPersistence';
import type { CaptureRecordingConfig, CaptureRecordingResult } from './sessionTypes';
import { CaptureSyncClock } from './syncClock';

type TrackProcessorConstructor = new(init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

export interface WebCodecsCaptureBackendOptions {
  Processor?: TrackProcessorConstructor;
  blobStore?: CaptureRecoveryBlobStore;
  recoveryStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
  onFatalError?: (error: Error) => void;
}

export class WebCodecsCaptureBackend implements ScreenCaptureBackend {
  private readonly Processor?: TrackProcessorConstructor;
  private readonly blobStore: CaptureRecoveryBlobStore;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly now: () => number;
  private readonly onFatalError?: (error: Error) => void;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private encoder: CaptureVideoEncoder | null = null;
  private audioEncoder: CaptureAudioEncoder | null = null;
  private muxer: CaptureMuxer | null = null;
  private clock = new CaptureSyncClock();
  private sessionId: string | null = null;
  private startedAt = 0;
  private active = false;
  private paused = false;
  private resumePending = false;
  private lastSourceTimestamp = 0;
  private captureStartUs = 0;
  private videoTimestampBase: number | null = null;
  private closeAudioTap: (() => Promise<void>) | null = null;
  private audioWrite = Promise.resolve();
  private discardAudio = false;
  private runArtifactIds: string[] = [];
  private readPromise: Promise<void> | null = null;
  private readError: unknown;
  private restorePerformanceReset: (() => void) | null = null;
  private stopPromise: Promise<CaptureRecordingResult> | null = null;
  private abortPromise: Promise<void> | null = null;
  private codec = 'avc1';

  constructor(options: WebCodecsCaptureBackendOptions = {}) {
    this.Processor = options.Processor
      ?? (globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorConstructor }).MediaStreamTrackProcessor;
    this.blobStore = options.blobStore ?? new ArtifactCaptureRecordingBlobStore();
    this.storage = options.recoveryStorage ?? getCaptureRecoveryStorage();
    this.now = options.now ?? (() => Date.now());
    this.onFatalError = options.onFatalError;
  }

  async start(input: { sessionId: string; source: MediaStream; config: CaptureRecordingConfig }): Promise<void> {
    if (!flags.screenCaptureWebCodecs) throw new Error('WebCodecs screen capture is disabled.');
    if (useTimelineStore.getState().isExporting) throw new Error('Stop the current export before starting WebCodecs capture.');
    if (!this.Processor || !globalThis.VideoEncoder || !globalThis.VideoFrame) throw new Error('WebCodecs screen capture is not supported in this browser.');
    const videoTrack = input.source.getVideoTracks()[0];
    if (!videoTrack) throw new Error('The capture source has no video track.');
    const settings = videoTrack.getSettings();
    const sourceSize = { width: settings.width ?? 0, height: settings.height ?? 0 };
    if (sourceSize.width < 2 || sourceSize.height < 2) throw new Error('The capture source dimensions are unavailable.');
    const cropSize = input.config.crop
      ? { width: input.config.crop.width, height: input.config.crop.height }
      : sourceSize;
    const outputSize = resolveCaptureOutputSize(cropSize, input.config.scale ?? 1);

    this.restorePerformanceReset = suspendPerformanceQualityReset('screen-capture');
    try {
      this.runArtifactIds = [];
      const audioFormat = getCaptureAudioFormat(input.source);
      const audioBitrate = input.config.audioBitrateBitsPerSecond ?? 192_000;
      const detectedAudioCodec = audioFormat ? await detectCaptureAudioCodec({
        sampleRate: audioFormat.sampleRate,
        numberOfChannels: audioFormat.numberOfChannels,
        bitrate: audioBitrate,
      }) : null;
      if (audioFormat && !detectedAudioCodec) throw new Error('No WebCodecs audio encoder is available for capture.');
      this.muxer = new CaptureMuxer({
        fps: input.config.fps,
        audioCodec: detectedAudioCodec?.codec,
        writeRun: async run => {
          const ref = await this.blobStore.putChunk({
            sessionId: input.sessionId,
            chunkIndex: run.runIndex,
            blob: new Blob([run.data], { type: 'application/octet-stream' }),
            mimeType: 'video/mp4',
            startedAt: this.startedAt,
            timeStart: 0,
            position: run.position,
          });
          this.runArtifactIds.push(ref.artifactId);
          appendCaptureRecoveryChunk(this.storage, input.sessionId, ref);
          const previous = readCaptureRecoveryEntries(this.storage).find(entry => entry.sessionId === input.sessionId);
          if (previous) upsertCaptureRecoveryEntry(this.storage, {
            ...previous,
            bytes: Math.max(previous.bytes ?? 0, run.position + run.data.byteLength),
            recoverable: previous.recoverable || run.recoverableFragment,
          });
        },
      });
      this.encoder = new CaptureVideoEncoder({
        width: outputSize.width,
        height: outputSize.height,
        fps: input.config.fps,
        bitrate: input.config.bitrateBitsPerSecond,
        muxer: this.muxer,
        onError: error => this.failCapture(error),
      });
      const videoConfig = await this.encoder.initialize();
      this.codec = `${videoConfig.codec}${detectedAudioCodec ? `+${detectedAudioCodec.codec}` : ''}`;
      if (audioFormat && detectedAudioCodec) {
        if (!globalThis.AudioData) throw new Error('AudioData is not available for WebCodecs capture.');
        this.audioEncoder = new CaptureAudioEncoder({
          sampleRate: audioFormat.sampleRate,
          numberOfChannels: audioFormat.numberOfChannels,
          bitrate: audioBitrate,
          muxer: this.muxer,
          detectCodec: async () => detectedAudioCodec,
          onError: error => this.failCapture(error),
        });
        await this.audioEncoder.initialize();
      }
      this.reader = new this.Processor({ track: videoTrack }).readable.getReader();
      this.clock = new CaptureSyncClock();
      this.captureStartUs = performance.now() * 1000;
      this.clock.start(this.captureStartUs);
      this.lastSourceTimestamp = this.captureStartUs;
      this.videoTimestampBase = null;
      this.audioWrite = Promise.resolve();
      this.discardAudio = false;
      this.sessionId = input.sessionId;
      this.startedAt = this.now();
      this.active = true;
      this.paused = false;
      this.resumePending = false;
      this.readError = null;
      this.stopPromise = null;
      this.abortPromise = null;
      upsertCaptureRecoveryEntry(this.storage, {
        sessionId: input.sessionId,
        status: 'active',
        tier: 'webcodecs',
        startedAt: this.startedAt,
        mimeType: 'video/mp4',
        chunks: [],
      });
      this.readPromise = this.readFrames(input.config, sourceSize);
      if (this.audioEncoder) {
        this.closeAudioTap = await createCaptureAudioTap(
          input.source,
          chunk => this.queueAudio(chunk),
          error => this.failCapture(error),
        );
      }
    } catch (error) {
      await this.muxer?.cancel().catch(() => undefined);
      this.cleanupRuntime();
      throw error;
    }
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.clock.pause(this.lastSourceTimestamp);
    this.updateLedger('paused');
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this.resumePending = true;
    this.updateLedger('active');
  }

  stop(): Promise<CaptureRecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    const sessionId = this.sessionId;
    if (!sessionId || !this.encoder || !this.muxer) throw new Error('No WebCodecs capture is active.');
    this.stopPromise = (async () => {
      this.active = false;
      await this.reader?.cancel().catch(() => undefined);
      await this.readPromise;
      if (this.readError) throw this.readError;
      await this.closeAudioTap?.();
      this.closeAudioTap = null;
      await this.audioWrite;
      if (this.readError) throw this.readError;
      await this.audioEncoder?.flush();
      if (this.readError) throw this.readError;
      await this.encoder!.flush();
      const buffer = await this.muxer!.finalize();
      if (buffer) throw new Error('WebCodecs capture unexpectedly finalized to memory instead of recovery storage.');
      const muxerStats = this.muxer!.getStats();
      const result = {
        sessionId,
        mimeType: 'video/mp4',
        durationSeconds: this.clock.elapsedSeconds,
        bytes: muxerStats.outputBytes,
        artifactIds: [...this.runArtifactIds],
      };
      this.updateLedger('stopped', result);
      return result;
    })().catch(async error => {
      this.updateErrorLedger(error);
      await this.muxer?.cancel().catch(() => undefined);
      throw error;
    }).finally(() => this.cleanupRuntime());
    return this.stopPromise;
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId;
    this.active = false;
    this.discardAudio = true;
    await this.reader?.cancel().catch(() => undefined);
    await this.readPromise?.catch(() => undefined);
    await this.closeAudioTap?.().catch(() => undefined);
    this.closeAudioTap = null;
    await this.audioWrite.catch(() => undefined);
    await this.muxer?.cancel().catch(() => undefined);
    this.cleanupRuntime();
    if (sessionId) await deleteCaptureRecoveryEntry(this.storage, this.blobStore, sessionId);
  }

  getStats(): { encodeQueueSize: number; droppedFrames: number; queuedPacketBytes: number; artifactBytes: number; outputBytes: number; mimeType: string; codec: string } {
    const encoder = this.encoder?.getStats();
    const muxer = this.muxer?.getStats();
    return {
      encodeQueueSize: encoder?.encodeQueueSize ?? 0,
      droppedFrames: encoder?.droppedFrames ?? 0,
      queuedPacketBytes: muxer?.queuedPacketBytes ?? 0,
      artifactBytes: muxer?.artifactBytes ?? 0,
      outputBytes: muxer?.outputBytes ?? 0,
      mimeType: 'video/mp4',
      codec: this.codec,
    };
  }

  private async readFrames(config: CaptureRecordingConfig, initialSize: { width: number; height: number }): Promise<void> {
    try {
      while (this.active && this.reader) {
        const { value: frame, done } = await this.reader.read();
        if (done) break;
        this.videoTimestampBase ??= frame.timestamp;
        const sourceTimestamp = this.captureStartUs + frame.timestamp - this.videoTimestampBase;
        this.lastSourceTimestamp = sourceTimestamp;
        if (this.resumePending) {
          this.clock.resume(sourceTimestamp);
          this.resumePending = false;
        }
        if (this.paused) {
          frame.close();
          continue;
        }
        if (config.crop && (frame.displayWidth !== initialSize.width || frame.displayHeight !== initialSize.height)) {
          frame.close();
          throw new Error('The capture source dimensions changed while a crop was active.');
        }
        const timestamp = this.clock.timestamp('video', sourceTimestamp, performance.now() * 1000);
        const transformed = transformCaptureFrame(frame, { crop: config.crop, scale: config.scale ?? 1, timestamp });
        frame.close();
        this.encoder!.encode(transformed);
        transformed.close();
      }
    } catch (error) {
      if (this.active) this.failCapture(error);
    }
  }

  private queueAudio(chunk: CapturePcmChunk): void {
    if (this.discardAudio || this.paused || !this.audioEncoder) return;
    if (this.resumePending) {
      this.clock.resume(chunk.sourceTimestampUs);
      this.resumePending = false;
    }
    this.lastSourceTimestamp = Math.max(this.lastSourceTimestamp, chunk.sourceTimestampUs);
    const timestamp = this.clock.timestamp('audio', chunk.sourceTimestampUs, chunk.observedAtUs);
    this.audioWrite = this.audioWrite.then(async () => {
      if (this.discardAudio || !this.audioEncoder) return;
      await this.audioEncoder.encode(new AudioData({
        format: 'f32-planar',
        sampleRate: chunk.sampleRate,
        numberOfFrames: chunk.numberOfFrames,
        numberOfChannels: chunk.numberOfChannels,
        timestamp,
        data: chunk.data,
      }));
    }).catch(error => {
      this.failCapture(error);
    });
  }

  private failCapture(cause: unknown): void {
    if (this.abortPromise) return;
    const error = cause instanceof Error ? cause : new Error('WebCodecs screen capture failed.');
    this.readError = error;
    this.active = false;
    this.discardAudio = true;
    this.updateErrorLedger(error);
    const reader = this.reader;
    const closeAudioTap = this.closeAudioTap;
    const muxer = this.muxer;
    this.encoder?.close();
    this.audioEncoder?.close();
    this.abortPromise = (async () => {
      await reader?.cancel().catch(() => undefined);
      await closeAudioTap?.().catch(() => undefined);
      await muxer?.cancel().catch(() => undefined);
    })().finally(() => {
      this.cleanupRuntime();
      this.onFatalError?.(error);
    });
  }

  private updateErrorLedger(error: unknown): void {
    if (!this.sessionId) return;
    const previous = readCaptureRecoveryEntries(this.storage).find(entry => entry.sessionId === this.sessionId);
    if (!previous) return;
    upsertCaptureRecoveryEntry(this.storage, {
      ...previous,
      status: 'error',
      message: error instanceof Error ? error.message : 'WebCodecs screen capture failed.',
    });
  }

  private updateLedger(status: 'active' | 'paused' | 'stopped', result?: CaptureRecordingResult): void {
    if (!this.sessionId) return;
    const previous = readCaptureRecoveryEntries(this.storage).find(entry => entry.sessionId === this.sessionId);
    upsertCaptureRecoveryEntry(this.storage, {
      sessionId: this.sessionId,
      status,
      tier: 'webcodecs',
      startedAt: this.startedAt,
      stoppedAt: result ? this.now() : undefined,
      mimeType: 'video/mp4',
      durationSeconds: result?.durationSeconds,
      bytes: result?.bytes,
      recoverable: result ? true : previous?.recoverable,
      chunks: previous?.chunks ?? [],
    });
  }

  private cleanupRuntime(): void {
    this.encoder?.close();
    this.audioEncoder?.close();
    this.encoder = null;
    this.audioEncoder = null;
    this.muxer = null;
    this.reader = null;
    this.readPromise = null;
    this.closeAudioTap = null;
    this.restorePerformanceReset?.();
    this.restorePerformanceReset = null;
  }
}

export class CaptureBackendRouter implements ScreenCaptureBackend {
  private active: ScreenCaptureBackend | null = null;
  private fatalErrorHandler?: (error: Error) => void;

  setFatalErrorHandler(handler: (error: Error) => void): void { this.fatalErrorHandler = handler; }

  async start(input: { sessionId: string; source: MediaStream; config: CaptureRecordingConfig }): Promise<void> {
    this.active = input.config.tier === 'webcodecs'
      ? new WebCodecsCaptureBackend({ onFatalError: this.fatalErrorHandler })
      : new MediaRecorderCaptureBackend();
    await this.active.start(input);
  }

  pause(): Promise<void> | void { return this.requireActive().pause(); }
  resume(): Promise<void> | void { return this.requireActive().resume(); }
  stop(): Promise<CaptureRecordingResult> { return this.requireActive().stop(); }
  cancel(): Promise<void> | void { return this.active?.cancel(); }
  getStats() {
    return this.active && 'getStats' in this.active && typeof this.active.getStats === 'function'
      ? this.active.getStats()
      : {};
  }

  private requireActive(): ScreenCaptureBackend {
    if (!this.active) throw new Error('No capture backend is active.');
    return this.active;
  }
}
