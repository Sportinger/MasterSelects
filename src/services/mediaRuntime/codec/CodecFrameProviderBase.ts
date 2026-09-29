// Shared RuntimeFrameProvider engine for codec-specific backends (TurboRes,
// HAP, ...): latest-wins request queue with epoch-based cancellation, one-packet
// prefetch for forward playback, half-open packet intervals and an exact-seek
// contract. Subclasses supply the packet source and the packet -> VideoFrame
// decode; everything else lives here so a new backend is only its decoder.

import type { DecodeSessionPolicy, RuntimeFrameProvider, RuntimeFrameProviderBackend } from '../types';

export type CodecRequestMode = 'advance' | 'reverse' | 'seek' | 'scrub' | 'fast';

interface FrameRequest {
  sequence: number;
  epoch: number;
  mode: CodecRequestMode;
  timeSeconds: number;
}

export interface CodecPacket {
  readonly data: Uint8Array;
  readonly timestamp: number;
  readonly duration: number;
  readonly microsecondTimestamp: number;
  readonly microsecondDuration: number;
}

export interface CodecPacketSourceMetadata {
  duration: number;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  rotation: number;
  fps: number;
}

export interface CodecPacketReader<TPacket extends CodecPacket = CodecPacket> {
  readonly metadata: CodecPacketSourceMetadata;
  getPacketAt(timeSeconds: number): Promise<TPacket | null>;
  getNextPacket?(packet: TPacket): Promise<TPacket | null>;
  dispose(): void;
}

export interface CodecFrameProviderBaseOptions {
  sourceId: string;
  file: File;
  policy?: DecodeSessionPolicy;
  loadTimeoutMs?: number;
  onFrame?: () => void;
  onError?: (error: Error) => void;
}

export const DEFAULT_CODEC_LOAD_TIMEOUT_MS = 8_000;

export function closeVideoFrame(frame: VideoFrame | null): void {
  try { frame?.close(); } catch { /* already closed */ }
}

export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export abstract class CodecFrameProviderBase<
  TPacket extends CodecPacket,
  TOptions extends CodecFrameProviderBaseOptions,
> implements RuntimeFrameProvider {
  abstract readonly backend: RuntimeFrameProviderBackend;
  currentTime = 0;
  isPlaying = false;

  protected readonly options: TOptions;
  protected packetSource: CodecPacketReader<TPacket> | null = null;
  protected ready = false;
  protected destroyed = false;
  protected decodedFrameCount = 0;
  protected lastDecodeLatencyMs = 0;

  private currentFrame: VideoFrame | null = null;
  private currentFrameTimeSeconds: number | null = null;
  private currentPacket: TPacket | null = null;
  private bufferedFutureFrame: VideoFrame | null = null;
  private bufferedFuturePacket: TPacket | null = null;
  private pendingTime: number | null = null;
  private activeRequest: FrameRequest | null = null;
  private pendingRequest: FrameRequest | null = null;
  private drainPromise: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private requestSequence = 0;
  private requestEpoch = 0;
  private lastSatisfiedRequestSequence = 0;
  private prefetchedFrameCount = 0;
  private discardedFrameCount = 0;
  private decodeErrorCount = 0;
  private lastDecodeError: string | null = null;

  constructor(options: TOptions) {
    this.options = options;
  }

  /** Human label used in error messages, e.g. "TurboRes" or "HAP". */
  protected abstract readonly label: string;
  /** Noun for "No <x> at 1.000s" errors, e.g. "ProRes packet". */
  protected abstract readonly packetLabel: string;

  /** Opens demux + decoder; returns the packet reader. Subclass keeps its own decoder handles. */
  protected abstract initializeResources(): Promise<CodecPacketReader<TPacket>>;
  /** Whether the decoder created by initializeResources is available. */
  protected abstract hasDecoder(): boolean;
  /** Decodes one packet to a VideoFrame stamped with the packet timestamp. */
  protected abstract decodePacketToFrame(packet: TPacket): Promise<VideoFrame>;
  /** Releases decoder-specific resources (workers, WASM). Packet source is disposed by the base. */
  protected abstract releaseDecoderResources(): Promise<void>;
  /** Codec/backend specific debug fields merged into getDebugInfo(). */
  protected abstract getBackendDebugInfo(): {
    codec: string;
    hwAccel: string;
    decodeQueueSize: number;
  } & Record<string, unknown>;

  /**
   * Bounds a startup step. If it resolves after the timeout, `releaseLateValue`
   * gets the orphaned value so nothing leaks.
   */
  protected async withLoadTimeout<T>(
    promise: Promise<T>,
    stage: string,
    releaseLateValue?: (value: T) => void | Promise<void>,
  ): Promise<T> {
    const timeoutMs = Math.max(1, this.options.loadTimeoutMs ?? DEFAULT_CODEC_LOAD_TIMEOUT_MS);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error(`${this.label} ${stage} timed out after ${timeoutMs}ms`));
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

  async load(): Promise<void> {
    if (this.destroyed) throw new Error(`${this.label} provider is destroyed`);
    if (this.ready) return;
    try {
      this.packetSource = await this.initializeResources();
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
      lastDecodedFrameTimestampSeconds: this.currentFrameTimeSeconds,
      reverseFrameCacheSize: 0,
      prefetchedFrameCount: this.prefetchedFrameCount,
      discardedFrameCount: this.discardedFrameCount,
      lastDecodeLatencyMs: this.lastDecodeLatencyMs,
      ...this.getBackendDebugInfo(),
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
      throw new Error(`${this.label} provider is not ready for exact seek`);
    }
    const drainPromise = this.drainPromise;
    await drainPromise;
    if (this.destroyed) {
      throw new Error(`${this.label} provider was destroyed during exact seek`);
    }
    if (
      this.lastSatisfiedRequestSequence !== requestSequence
      || !this.currentPacket
      || !this.packetContainsTime(this.currentPacket, this.clampToMediaRange(timeSeconds))
      || !this.currentFrameIsUsable()
    ) {
      throw new Error(
        this.lastDecodeError
          ?? `${this.label} exact seek to ${timeSeconds.toFixed(3)}s was superseded or produced no matching frame`,
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

  private queueRequest(mode: CodecRequestMode, timeSeconds: number): number | null {
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

  private packetContainsTime(packet: TPacket, timeSeconds: number): boolean {
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
    currentPacket: TPacket,
    nextPacket: TPacket,
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

  private recordDecodeError(error: unknown): void {
    const normalized = normalizeError(error);
    this.decodeErrorCount += 1;
    this.lastDecodeError = normalized.message;
    this.options.onError?.(normalized);
  }

  private async drainRequests(): Promise<void> {
    while (!this.destroyed && this.pendingRequest) {
      const request = this.pendingRequest;
      this.pendingRequest = null;
      this.activeRequest = request;
      try {
        await this.decodeRequest(request);
      } catch (error) {
        this.recordDecodeError(error);
      } finally {
        if (this.activeRequest === request) this.activeRequest = null;
        if (!this.pendingRequest) this.pendingTime = null;
      }
    }
  }

  private async decodeRequest(request: FrameRequest): Promise<void> {
    const packetSource = this.packetSource;
    if (!packetSource || !this.hasDecoder()) {
      throw new Error(`${this.label} provider is not loaded`);
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
    if (!packet) throw new Error(`No ${this.packetLabel} at ${request.timeSeconds.toFixed(3)}s`);

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

  private async decodePacket(packet: TPacket): Promise<VideoFrame> {
    const decodeStartedAt = performance.now();
    const frame = await this.decodePacketToFrame(packet);
    this.lastDecodeLatencyMs = performance.now() - decodeStartedAt;
    this.decodedFrameCount += 1;
    return frame;
  }

  private publishFrame(outputFrame: VideoFrame, packet: TPacket, request: FrameRequest): void {
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

  private async prefetchNextFrame(packet: TPacket, request: FrameRequest): Promise<void> {
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
      this.recordDecodeError(error);
    }
  }

  private async releaseResources(): Promise<void> {
    const packetSource = this.packetSource;
    this.packetSource = null;
    try { await this.releaseDecoderResources(); } catch { /* best-effort */ }
    try { packetSource?.dispose(); } catch { /* best-effort dispose */ }
  }
}
