// HAP RuntimeFrameProvider: latest-wins request queue with epoch-based
// cancellation and one-packet prefetch, mirroring TurboResFrameProvider.
// Decode (section parse + Snappy + BC unpack) runs in a dedicated worker;
// the provider publishes ordinary RGBA VideoFrames to the existing runtime.

import type { DecodeSessionPolicy, RuntimeFrameProvider } from '../types';
import type {
  HapDecodeWorkerRequest,
  HapDecodeWorkerResponse,
} from '../../../workers/hapDecodeWorker';
import type { HapVideoFourCC } from '../../hap/hapCodecIdentity';
import {
  HapPacketSource,
  type HapPacket,
  type HapPacketReader,
} from './HapPacketSource';

type RequestMode = 'advance' | 'reverse' | 'seek' | 'scrub' | 'fast';

interface FrameRequest {
  sequence: number;
  epoch: number;
  mode: RequestMode;
  timeSeconds: number;
}

export interface HapFrameProviderOptions {
  sourceId: string;
  file: File;
  fourCC: HapVideoFourCC;
  policy?: DecodeSessionPolicy;
  loadTimeoutMs?: number;
  onFrame?: () => void;
  onError?: (error: Error) => void;
  packetSourceFactory?: (
    file: File,
    expectedFourCC: HapVideoFourCC,
  ) => Promise<HapPacketReader>;
}

const DEFAULT_LOAD_TIMEOUT_MS = 8_000;

function closeVideoFrame(frame: VideoFrame | null): void {
  try { frame?.close(); } catch { /* already closed */ }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Request/response client for the decode worker. Session-owned. */
class HapDecodeWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (value: { rgba: Uint8Array; hasAlpha: boolean }) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('../../../workers/hapDecodeWorker.ts', import.meta.url), {
      type: 'module',
      name: 'hap-decode',
    });
    this.worker.onmessage = (event: MessageEvent<HapDecodeWorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) {
        entry.resolve({ rgba: new Uint8Array(response.rgba), hasAlpha: response.hasAlpha });
      } else {
        entry.reject(new Error(response.error));
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(`HAP decode worker error: ${event.message}`);
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  get queueSize(): number {
    return this.pending.size;
  }

  decode(
    packet: Uint8Array,
    fourCC: HapVideoFourCC,
    width: number,
    height: number,
  ): Promise<{ rgba: Uint8Array; hasAlpha: boolean }> {
    if (this.terminated) return Promise.reject(new Error('HAP decode worker is terminated'));
    const id = this.nextId++;
    // The demuxer may reuse packet storage; copy so the transfer stays safe.
    const copy = packet.slice();
    const request: HapDecodeWorkerRequest = {
      id,
      packet: copy.buffer as ArrayBuffer,
      fourCC,
      width,
      height,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request, [request.packet]);
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    const error = new Error('HAP decode worker terminated');
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}

export class HapFrameProvider implements RuntimeFrameProvider {
  readonly backend = 'hap' as const;
  currentTime = 0;
  isPlaying = false;

  private readonly options: HapFrameProviderOptions;
  private packetSource: HapPacketReader | null = null;
  private decoder: HapDecodeWorkerClient | null = null;
  private currentFrame: VideoFrame | null = null;
  private currentFrameTimeSeconds: number | null = null;
  private currentPacket: HapPacket | null = null;
  private bufferedFutureFrame: VideoFrame | null = null;
  private bufferedFuturePacket: HapPacket | null = null;
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
  private lastFrameHadAlpha = false;

  constructor(options: HapFrameProviderOptions) {
    this.options = options;
  }

  async load(): Promise<void> {
    if (this.destroyed) throw new Error('HAP provider is destroyed');
    if (this.ready) return;

    const sourceFactory = this.options.packetSourceFactory
      ?? ((file, fourCC) => HapPacketSource.create(file, fourCC));
    const loadTimeoutMs = Math.max(1, this.options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const sourcePromise = sourceFactory(this.options.file, this.options.fourCC);
      void sourcePromise.then((lateSource) => {
        if (timedOut) lateSource.dispose();
      }).catch(() => undefined);
      const packetSource = await Promise.race([
        sourcePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`HAP demux initialization timed out after ${loadTimeoutMs}ms`));
          }, loadTimeoutMs);
        }),
      ]);
      this.packetSource = packetSource;
      this.decoder = new HapDecodeWorkerClient();
      this.ready = true;
    } catch (error) {
      await this.releaseResources();
      throw normalizeError(error);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
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
      codec: `hap:${this.options.fourCC}`,
      hwAccel: 'cpu-worker',
      decodeQueueSize: this.decoder?.queueSize ?? 0,
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
      lastFrameHadAlpha: this.lastFrameHadAlpha,
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
      throw new Error('HAP provider is not ready for exact seek');
    }
    const drainPromise = this.drainPromise;
    await drainPromise;
    if (this.destroyed) {
      throw new Error('HAP provider was destroyed during exact seek');
    }
    if (
      this.lastSatisfiedRequestSequence !== requestSequence
      || !this.currentPacket
      || !this.packetContainsTime(this.currentPacket, this.clampToMediaRange(timeSeconds))
      || !this.currentFrameIsUsable()
    ) {
      throw new Error(
        this.lastDecodeError
          ?? `HAP exact seek to ${timeSeconds.toFixed(3)}s was superseded or produced no matching frame`,
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

  private packetContainsTime(packet: HapPacket, timeSeconds: number): boolean {
    const duration = packet.duration > 0 ? packet.duration : 1 / (this.getFrameRate() || 30);
    // Half-open interval with only floating-point tolerance (see TurboRes note
    // about mixed-rate export requests near packet boundaries).
    const epsilon = 1e-9;
    return timeSeconds + epsilon >= packet.timestamp
      && timeSeconds < packet.timestamp + duration - epsilon;
  }

  private canKeepPrefetchForPendingAdvance(
    request: FrameRequest,
    currentPacket: HapPacket,
    nextPacket: HapPacket,
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
    if (!packetSource || !this.decoder) {
      throw new Error('HAP provider is not loaded');
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
    if (!packet) throw new Error(`No HAP packet at ${request.timeSeconds.toFixed(3)}s`);

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

  private async decodePacket(packet: HapPacket): Promise<VideoFrame> {
    const decoder = this.decoder;
    const metadata = this.packetSource?.metadata;
    if (!decoder || !metadata) throw new Error('HAP decoder is unavailable');

    const decodeStartedAt = performance.now();
    const decoded = await decoder.decode(
      packet.data,
      this.options.fourCC,
      metadata.width,
      metadata.height,
    );
    this.lastDecodeLatencyMs = performance.now() - decodeStartedAt;

    const outputFrame = new VideoFrame(decoded.rgba, {
      format: 'RGBA',
      codedWidth: metadata.width,
      codedHeight: metadata.height,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
      timestamp: packet.microsecondTimestamp,
      ...(packet.microsecondDuration > 0 ? { duration: packet.microsecondDuration } : {}),
    });
    this.decodedFrameCount += 1;
    this.lastFrameHadAlpha = decoded.hasAlpha;
    return outputFrame;
  }

  private publishFrame(
    outputFrame: VideoFrame,
    packet: HapPacket,
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

  private async prefetchNextFrame(packet: HapPacket, request: FrameRequest): Promise<void> {
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
    const packetSource = this.packetSource;
    this.decoder = null;
    this.packetSource = null;
    try { decoder?.terminate(); } catch { /* best-effort */ }
    try { packetSource?.dispose(); } catch { /* best-effort */ }
  }
}

export async function createHapFrameProvider(
  options: HapFrameProviderOptions,
): Promise<HapFrameProvider | null> {
  const provider = new HapFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
