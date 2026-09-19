import type { PixelFormat } from 'turbores';
import type { DecodeSessionPolicy, RuntimeFrameProvider } from '../types';
import {
  TurboResPacketSource,
  type TurboResPacket,
  type TurboResPacketReader,
} from './TurboResPacketSource';
import type { TurboResProResFourCC } from './turboResCodecIdentity';
import { planTurboResRuntimePolicy } from './turboResResourceEstimate';
import { probeTurboResVideoFrameFormats } from './turboResVideoFrameCapabilities';

type RequestMode = 'advance' | 'reverse' | 'seek' | 'scrub' | 'fast';

interface FrameRequest {
  sequence: number;
  epoch: number;
  mode: RequestMode;
  timeSeconds: number;
}

interface DecodedTurboResFrame {
  frameData: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  pixelFormat: PixelFormat;
  originalPixelFormat: PixelFormat;
  colorPrimariesString?: string;
  colorTransferString?: string;
  colorMatrixString?: string;
  colorRangeFull: boolean;
  scanType: string;
}

interface TurboResFrameLike {
  readonly isLocked: boolean;
  clear(): unknown;
}

interface TurboResDecoderLike {
  readonly useSharedMemory: boolean;
  readonly concurrency: number;
  readonly decodeQueueSize: number;
  decode(packet: Uint8Array, frame: TurboResFrameLike): Promise<DecodedTurboResFrame | Error>;
  close(): Promise<void>;
}

interface TurboResModuleLike {
  Decoder: {
    canUseSharedMemory(): boolean;
    create(options: {
      proresFourCc: TurboResProResFourCC;
      useSharedMemory: boolean;
      concurrency: number;
      allowedOutputFormats: PixelFormat[];
    }): Promise<TurboResDecoderLike | Error>;
  };
  Frame: new () => TurboResFrameLike;
}

export interface TurboResFrameProviderOptions {
  sourceId: string;
  file: File;
  fourCC: TurboResProResFourCC;
  policy?: DecodeSessionPolicy;
  useSharedMemory?: boolean;
  concurrency?: number;
  allowedOutputFormats?: PixelFormat[];
  loadTimeoutMs?: number;
  onFrame?: () => void;
  onError?: (error: Error) => void;
  packetSourceFactory?: (
    file: File,
    expectedFourCC: TurboResProResFourCC,
  ) => Promise<TurboResPacketReader>;
  moduleLoader?: () => Promise<TurboResModuleLike>;
  outputFormatProbe?: (fourCC: TurboResProResFourCC) => PixelFormat[];
}

const DEFAULT_LOAD_TIMEOUT_MS = 8_000;

async function loadWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
  releaseLateValue?: (value: T) => void | Promise<void>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(`TurboRes ${stage} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  void promise.then((value) => {
    if (timedOut) void releaseLateValue?.(value);
  }).catch(() => undefined);
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function closeVideoFrame(frame: VideoFrame | null): void {
  try { frame?.close(); } catch { /* already closed */ }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function packetDurationInit(packet: TurboResPacket): Pick<VideoFrameBufferInit, 'duration'> | object {
  return packet.microsecondDuration > 0
    ? { duration: packet.microsecondDuration }
    : {};
}

export class TurboResFrameProvider implements RuntimeFrameProvider {
  readonly backend = 'turbores' as const;
  currentTime = 0;
  isPlaying = false;

  private readonly options: TurboResFrameProviderOptions;
  private packetSource: TurboResPacketReader | null = null;
  private decoder: TurboResDecoderLike | null = null;
  private decodeFrame: TurboResFrameLike | null = null;
  private currentFrame: VideoFrame | null = null;
  private currentFrameTimeSeconds: number | null = null;
  private currentPacket: TurboResPacket | null = null;
  private bufferedFutureFrame: VideoFrame | null = null;
  private bufferedFuturePacket: TurboResPacket | null = null;
  private emittedPixelFormat: PixelFormat | null = null;
  private originalPixelFormat: PixelFormat | null = null;
  private ready = false;
  private destroyed = false;
  private pendingTime: number | null = null;
  private activeRequest: FrameRequest | null = null;
  private pendingRequest: FrameRequest | null = null;
  private drainPromise: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private requestSequence = 0;
  private requestEpoch = 0;
  private lastSatisfiedRequestSequence = 0;
  private decodedFrameCount = 0;
  private prefetchedFrameCount = 0;
  private discardedFrameCount = 0;
  private decodeErrorCount = 0;
  private lastDecodeError: string | null = null;
  private lastDecodeLatencyMs = 0;
  private useSharedMemory = false;
  private concurrency = 1;

  constructor(options: TurboResFrameProviderOptions) {
    this.options = options;
  }

  async load(): Promise<void> {
    if (this.destroyed) throw new Error('TurboRes provider is destroyed');
    if (this.ready) return;

    const sourceFactory = this.options.packetSourceFactory
      ?? ((file, fourCC) => TurboResPacketSource.create(file, fourCC));
    const moduleLoader = this.options.moduleLoader
      ?? (async () => await import('turbores') as unknown as TurboResModuleLike);
    const outputFormatProbe = this.options.outputFormatProbe
      ?? probeTurboResVideoFrameFormats;

    try {
      const loadTimeoutMs = Math.max(1, this.options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);
      const packetSource = await loadWithTimeout(
        sourceFactory(this.options.file, this.options.fourCC),
        loadTimeoutMs,
        'demux initialization',
        (lateSource) => lateSource.dispose(),
      );
      this.packetSource = packetSource;
      const turboRes = await loadWithTimeout(
        moduleLoader(),
        loadTimeoutMs,
        'module initialization',
      );

      const allowedOutputFormats = this.options.allowedOutputFormats
        ?? outputFormatProbe(this.options.fourCC);
      if (allowedOutputFormats.length === 0) {
        throw new Error(`Browser accepts no alpha-safe TurboRes output for ${this.options.fourCC}`);
      }

      const sharedMemoryAvailable = turboRes.Decoder.canUseSharedMemory();
      const policy = planTurboResRuntimePolicy(
        this.options.policy ?? 'interactive',
        this.options.useSharedMemory ?? sharedMemoryAvailable,
      );
      this.useSharedMemory = policy.useSharedMemory;
      this.concurrency = this.options.concurrency === undefined
        ? policy.concurrency
        : Math.max(0, Math.min(4, Math.floor(this.options.concurrency)));

      const decoder = await loadWithTimeout(
        turboRes.Decoder.create({
          proresFourCc: this.options.fourCC,
          useSharedMemory: this.useSharedMemory,
          concurrency: this.concurrency,
          allowedOutputFormats,
        }),
        loadTimeoutMs,
        'decoder worker initialization',
        async (lateDecoder) => {
          if (!(lateDecoder instanceof Error)) await lateDecoder.close();
        },
      );
      if (decoder instanceof Error) throw decoder;

      this.decoder = decoder;
      this.decodeFrame = new turboRes.Frame();
      this.ready = true;
    } catch (error) {
      await this.releaseResources();
      throw normalizeError(error);
    }
  }

  isFullMode(): boolean {
    return this.ready && !this.destroyed;
  }

  isSimpleMode(): boolean {
    return false;
  }

  getCurrentFrame(): VideoFrame | null {
    return this.currentFrameIsUsable() ? this.currentFrame : null;
  }

  getFrameRate(): number {
    return this.packetSource?.metadata.fps ?? 0;
  }

  getPendingSeekTime(): number | null {
    return this.pendingTime;
  }

  isSeeking(): boolean {
    return this.pendingTime !== null;
  }

  isDecodePending(): boolean {
    return this.activeRequest !== null || this.pendingRequest !== null || this.drainPromise !== null;
  }

  hasFrame(): boolean {
    return this.currentFrameIsUsable();
  }

  hasBufferedFutureFrame(): boolean {
    return this.bufferedFutureFrame !== null;
  }

  getDebugInfo() {
    const fps = this.getFrameRate();
    return {
      codec: `turbores:${this.options.fourCC}`,
      hwAccel: this.useSharedMemory ? 'wasm-shared-memory' : 'wasm-worker',
      decodeQueueSize: this.decoder?.decodeQueueSize ?? (this.isDecodePending() ? 1 : 0),
      samplesLoaded: this.ready ? 1 : 0,
      sampleIndex: Math.round(this.currentTime * Math.max(fps, 1)),
      frameBufferSize: this.currentFrame ? 1 : 0,
      decoderState: this.destroyed ? 'closed' : this.ready ? 'configured' : 'unconfigured',
      currentFrameTimestampSeconds: this.currentFrameTimeSeconds,
      pendingSeekKind: this.activeRequest?.mode ?? this.pendingRequest?.mode ?? null,
      pendingSeekTargetSeconds: this.pendingTime,
      decodeErrorCount: this.decodeErrorCount,
      lastDecodeError: this.lastDecodeError,
      decodedFrameCount: this.decodedFrameCount,
      prefetchedFrameCount: this.prefetchedFrameCount,
      lastDecodedFrameTimestampSeconds: this.currentFrameTimeSeconds,
      reverseFrameCacheSize: 0,
      emittedPixelFormat: this.emittedPixelFormat,
      originalPixelFormat: this.originalPixelFormat,
      discardedFrameCount: this.discardedFrameCount,
      lastDecodeLatencyMs: this.lastDecodeLatencyMs,
      concurrency: this.concurrency,
    };
  }

  advanceToTime(timeSeconds: number): void {
    this.isPlaying = true;
    this.queueRequest('advance', timeSeconds);
  }

  advanceReverseToTime(timeSeconds: number): void {
    this.isPlaying = true;
    this.queueRequest('reverse', timeSeconds);
  }

  seek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueRequest('seek', timeSeconds);
  }

  scrubSeek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueRequest('scrub', timeSeconds);
  }

  fastSeek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueRequest('fast', timeSeconds);
  }

  async seekExact(timeSeconds: number): Promise<void> {
    this.isPlaying = false;
    const requestSequence = this.queueRequest('seek', timeSeconds);
    if (requestSequence === null) {
      throw new Error('TurboRes provider is not ready for exact seek');
    }
    const drainPromise = this.drainPromise;
    await drainPromise;
    if (this.destroyed) {
      throw new Error('TurboRes provider was destroyed during exact seek');
    }
    if (
      this.lastSatisfiedRequestSequence !== requestSequence
      || !this.currentPacket
      || !this.packetContainsTime(this.currentPacket, this.clampToMediaRange(timeSeconds))
      || !this.currentFrameIsUsable()
    ) {
      throw new Error(
        this.lastDecodeError
          ?? `TurboRes exact seek to ${timeSeconds.toFixed(3)}s was superseded or produced no matching frame`,
      );
    }
  }

  getSourceRotationDegrees(): 0 | 90 | 180 | 270 {
    const rotation = this.packetSource?.metadata.rotation ?? 0;
    return rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
  }

  pause(): void {
    this.isPlaying = false;
    if (this.activeRequest?.mode === 'advance' || this.activeRequest?.mode === 'reverse') {
      this.requestEpoch += 1;
    }
    if (this.pendingRequest?.mode === 'advance' || this.pendingRequest?.mode === 'reverse') {
      this.pendingRequest = null;
      this.pendingTime = null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ready = false;
    this.requestEpoch += 1;
    this.pendingRequest = null;
    this.pendingTime = null;
    closeVideoFrame(this.currentFrame);
    this.currentFrame = null;
    this.currentFrameTimeSeconds = null;
    this.currentPacket = null;
    this.clearBufferedFutureFrame();
    this.destroyPromise = (this.drainPromise ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.releaseResources());
  }

  async destroyAsync(): Promise<void> {
    this.destroy();
    await this.destroyPromise;
  }

  /**
   * Requests at or beyond the media end (an exact seek to the timeline end,
   * a reversed clip anchored at outPoint == duration) clamp into the last
   * packet's half-open interval, matching the packet source's own clamp.
   */
  private clampToMediaRange(timeSeconds: number): number {
    const safe = Math.max(0, timeSeconds);
    const duration = this.packetSource?.metadata.duration ?? 0;
    return duration > 0 ? Math.min(safe, Math.max(0, duration - 1e-6)) : safe;
  }

  private queueRequest(mode: RequestMode, timeSeconds: number): number | null {
    if (!this.ready || this.destroyed || !Number.isFinite(timeSeconds)) return null;
    const safeTime = this.clampToMediaRange(timeSeconds);
    if (
      mode !== 'advance'
      || (this.currentFrameTimeSeconds !== null && safeTime < this.currentFrameTimeSeconds)
    ) {
      this.clearBufferedFutureFrame();
    }
    this.currentTime = safeTime;
    this.pendingTime = safeTime;
    this.requestSequence += 1;
    this.pendingRequest = {
      sequence: this.requestSequence,
      epoch: this.requestEpoch,
      mode,
      timeSeconds: safeTime,
    };
    if (!this.drainPromise) {
      this.drainPromise = this.drainRequests().finally(() => {
        this.drainPromise = null;
      });
    }
    return this.requestSequence;
  }

  private currentFrameIsUsable(): boolean {
    if (!this.currentFrame || this.currentFrameTimeSeconds === null) return false;
    if (this.pendingTime === null) return true;
    if (this.currentPacket && this.packetContainsTime(this.currentPacket, this.pendingTime)) return true;
    const fps = this.getFrameRate() || 30;
    const tolerance = Math.max(0.06, Math.min(0.18, 4 / fps));
    return Math.abs(this.currentFrameTimeSeconds - this.pendingTime) <= tolerance;
  }

  private packetContainsTime(packet: TurboResPacket, timeSeconds: number): boolean {
    const duration = packet.duration > 0 ? packet.duration : 1 / (this.getFrameRate() || 30);
    // Keep the interval half-open while tolerating only floating-point noise.
    // A duration-scaled epsilon breaks valid mixed-rate export requests: at 24 fps,
    // 1 / 24 lands 41.7us before a 23.976 fps packet boundary and still belongs
    // to the preceding source packet.
    const epsilon = 1e-9;
    return timeSeconds + epsilon >= packet.timestamp
      && timeSeconds < packet.timestamp + duration - epsilon;
  }

  private canKeepPrefetchForPendingAdvance(
    request: FrameRequest,
    currentPacket: TurboResPacket,
    nextPacket: TurboResPacket,
  ): boolean {
    const pending = this.pendingRequest;
    if (!pending) return true;
    return pending.mode === 'advance'
      && pending.epoch === request.epoch
      && (
        this.packetContainsTime(currentPacket, pending.timeSeconds)
        || this.packetContainsTime(nextPacket, pending.timeSeconds)
      );
  }

  private clearBufferedFutureFrame(): void {
    closeVideoFrame(this.bufferedFutureFrame);
    this.bufferedFutureFrame = null;
    this.bufferedFuturePacket = null;
  }

  private async drainRequests(): Promise<void> {
    while (!this.destroyed && this.pendingRequest) {
      const request = this.pendingRequest;
      this.pendingRequest = null;
      this.activeRequest = request;
      try {
        await this.decodeRequest(request);
      } catch (error) {
        const normalized = normalizeError(error);
        this.decodeErrorCount += 1;
        this.lastDecodeError = normalized.message;
        this.options.onError?.(normalized);
      } finally {
        if (this.activeRequest === request) this.activeRequest = null;
        if (!this.pendingRequest) this.pendingTime = null;
      }
    }
  }

  private async decodeRequest(request: FrameRequest): Promise<void> {
    const packetSource = this.packetSource;
    if (!packetSource || !this.decoder || !this.decodeFrame) {
      throw new Error('TurboRes provider is not loaded');
    }

    if (this.currentPacket && this.packetContainsTime(this.currentPacket, request.timeSeconds)) {
      this.currentTime = request.timeSeconds;
      this.pendingTime = null;
      this.lastSatisfiedRequestSequence = request.sequence;
      return;
    }

    if (
      request.mode === 'advance'
      && this.bufferedFutureFrame
      && this.bufferedFuturePacket
      && this.packetContainsTime(this.bufferedFuturePacket, request.timeSeconds)
    ) {
      const bufferedFrame = this.bufferedFutureFrame;
      const bufferedPacket = this.bufferedFuturePacket;
      this.bufferedFutureFrame = null;
      this.bufferedFuturePacket = null;
      this.publishFrame(bufferedFrame, bufferedPacket, request);
      await this.prefetchNextFrame(bufferedPacket, request);
      return;
    }

    if (this.bufferedFuturePacket) this.clearBufferedFutureFrame();
    const packet = await packetSource.getPacketAt(request.timeSeconds);
    if (!packet) throw new Error(`No ProRes packet at ${request.timeSeconds.toFixed(3)}s`);

    const outputFrame = await this.decodePacket(packet);
    const newerRequestWaiting = this.pendingRequest !== null
      && this.pendingRequest.sequence > request.sequence;
    if (this.destroyed || request.epoch !== this.requestEpoch || newerRequestWaiting) {
      this.discardedFrameCount += 1;
      closeVideoFrame(outputFrame);
      return;
    }

    this.publishFrame(outputFrame, packet, request);
    await this.prefetchNextFrame(packet, request);
  }

  private async decodePacket(packet: TurboResPacket): Promise<VideoFrame> {
    const decoder = this.decoder;
    const decodeFrame = this.decodeFrame;
    if (!decoder || !decodeFrame) throw new Error('TurboRes decoder is unavailable');

    const decodeStartedAt = performance.now();
    const decoded = await decoder.decode(packet.data, decodeFrame);
    this.lastDecodeLatencyMs = performance.now() - decodeStartedAt;
    if (decoded instanceof Error) throw decoded;

    if (decoded.scanType !== 'progressive') {
      throw new Error(`Interlaced ProRes is not enabled (${decoded.scanType})`);
    }
    const colorSpace: VideoColorSpaceInit = {
      primaries: decoded.colorPrimariesString as VideoColorSpaceInit['primaries'],
      transfer: decoded.colorTransferString as VideoColorSpaceInit['transfer'],
      matrix: decoded.colorMatrixString as VideoColorSpaceInit['matrix'],
      fullRange: decoded.colorRangeFull,
    };
    const outputFrame = new VideoFrame(decoded.frameData, {
      format: decoded.pixelFormat as VideoPixelFormat,
      codedWidth: decoded.codedWidth,
      codedHeight: decoded.codedHeight,
      visibleRect: {
        x: 0,
        y: 0,
        width: decoded.visibleWidth,
        height: decoded.visibleHeight,
      },
      colorSpace,
      timestamp: packet.microsecondTimestamp,
      ...packetDurationInit(packet),
    });
    this.decodedFrameCount += 1;
    this.emittedPixelFormat = decoded.pixelFormat;
    this.originalPixelFormat = decoded.originalPixelFormat;
    return outputFrame;
  }

  private publishFrame(
    outputFrame: VideoFrame,
    packet: TurboResPacket,
    request: FrameRequest,
  ): void {
    closeVideoFrame(this.currentFrame);
    this.currentFrame = outputFrame;
    this.currentPacket = packet;
    this.currentFrameTimeSeconds = packet.timestamp;
    this.currentTime = request.timeSeconds;
    this.pendingTime = null;
    this.lastSatisfiedRequestSequence = request.sequence;
    this.lastDecodeError = null;
    this.options.onFrame?.();
  }

  private async prefetchNextFrame(packet: TurboResPacket, request: FrameRequest): Promise<void> {
    const packetSource = this.packetSource;
    if (
      request.mode !== 'advance'
      || !packetSource?.getNextPacket
      || this.destroyed
      || request.epoch !== this.requestEpoch
    ) return;

    try {
      const nextPacket = await packetSource.getNextPacket(packet);
      if (
        !nextPacket
        || this.destroyed
        || request.epoch !== this.requestEpoch
        || !this.canKeepPrefetchForPendingAdvance(request, packet, nextPacket)
      ) return;
      const nextFrame = await this.decodePacket(nextPacket);
      if (
        this.destroyed
        || request.epoch !== this.requestEpoch
        || !this.canKeepPrefetchForPendingAdvance(request, packet, nextPacket)
      ) {
        this.discardedFrameCount += 1;
        closeVideoFrame(nextFrame);
        return;
      }
      this.clearBufferedFutureFrame();
      this.bufferedFutureFrame = nextFrame;
      this.bufferedFuturePacket = nextPacket;
      this.prefetchedFrameCount += 1;
    } catch (error) {
      const normalized = normalizeError(error);
      this.decodeErrorCount += 1;
      this.lastDecodeError = normalized.message;
      this.options.onError?.(normalized);
    }
  }

  private async releaseResources(): Promise<void> {
    const decoder = this.decoder;
    const frame = this.decodeFrame;
    const packetSource = this.packetSource;
    this.decoder = null;
    this.decodeFrame = null;
    this.packetSource = null;

    if (frame && !frame.isLocked) {
      try { frame.clear(); } catch { /* already cleared */ }
    }
    if (decoder) {
      try { await decoder.close(); } catch { /* best-effort close */ }
    }
    try { packetSource?.dispose(); } catch { /* best-effort dispose */ }
  }
}

export async function createTurboResFrameProvider(
  options: TurboResFrameProviderOptions,
): Promise<TurboResFrameProvider | null> {
  const provider = new TurboResFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
