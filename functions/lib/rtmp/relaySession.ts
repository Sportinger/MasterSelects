import { buildFlvAudioBody, buildFlvVideoBody } from './flv';
import { parseRtmpTarget, redactSecret } from './guards';
import { MediaQueue } from './mediaQueue';
import { RtmpClient } from './rtmpClient';
import type {
  MediaFrame,
  MediaKind,
  RelayLease,
  RtmpTarget,
  RtmpTransportFactory,
} from './types';

const MAX_BINARY_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_FRAME_BYTES = 64 * 1024;
const INGRESS_BYTES_PER_SECOND = 12_000_000 / 8;
const INGRESS_BURST_BYTES = INGRESS_BYTES_PER_SECOND * 2;
const SESSION_CAP_MS = 12 * 60 * 60 * 1_000;
const SESSION_RECHECK_MS = 15 * 60 * 1_000;
const LEASE_REFRESH_MS = 60 * 1_000;

interface VideoConfig {
  bitrateKbps: number;
  fps: number;
  height: number;
  width: number;
}

interface AudioConfig {
  bitrateKbps: number;
  channels: number;
  sampleRate: number;
}

interface StartCommand {
  audio: AudioConfig;
  cmd: 'rtmpStart';
  id: string;
  streamKey: string;
  url: string;
  video: VideoConfig;
}

export interface RelaySessionOptions {
  close(code: number, reason: string): void;
  debug?(message: string): void;
  lease: RelayLease;
  revalidateSession(): Promise<boolean>;
  sendJson(value: unknown): void;
  transportFactory: RtmpTransportFactory;
}

export class CloudRtmpRelaySession {
  private active: ActiveRelay | null = null;
  private closed = false;
  private readonly hardCapTimer: ReturnType<typeof setTimeout>;
  private readonly ingress = new TokenBucket(INGRESS_BYTES_PER_SECOND, INGRESS_BURST_BYTES);
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private revalidationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: RelaySessionOptions;

  constructor(options: RelaySessionOptions) {
    this.options = options;
    this.hardCapTimer = setTimeout(() => {
      void this.failAndClose('Streaming session limit reached');
    }, SESSION_CAP_MS);
  }

  sendHello(): void {
    this.options.sendJson({ ok: true, type: 'relay-hello' });
  }

  async handleText(text: string): Promise<void> {
    if (this.closed) return;
    if (new TextEncoder().encode(text).byteLength > MAX_TEXT_FRAME_BYTES) {
      await this.failAndClose('Text frame too large');
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.sendError('', 'RTMP_INVALID_COMMAND', 'Invalid RTMP command JSON');
      return;
    }
    if (!isRecord(value) || typeof value.cmd !== 'string') {
      this.sendError(readId(value), 'RTMP_INVALID_COMMAND', 'Invalid RTMP command');
      return;
    }

    if (value.cmd === 'rtmpStart') {
      await this.startRelay(value);
    } else if (value.cmd === 'rtmpStop') {
      await this.stopRelay(readId(value));
    } else {
      this.sendError(readId(value), 'RTMP_INVALID_COMMAND', 'Unsupported RTMP command');
    }
  }

  async handleBinary(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    if (bytes.byteLength > MAX_BINARY_FRAME_BYTES) {
      await this.failAndClose('Binary frame too large');
      return;
    }
    if (!this.ingress.consume(bytes.byteLength)) {
      await this.failAndClose('Bitrate limit exceeded');
      return;
    }
    if (!this.active) return;

    try {
      this.active.acceptMedia(parseMediaFrame(bytes));
    } catch (error) {
      await this.failAndClose(safeErrorMessage(error, 'Invalid RTMP media frame'));
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.hardCapTimer);
    this.clearRelayTimers();
    const active = this.active;
    this.active = null;
    if (active) await active.stop(true);
    await this.options.lease.release().catch(() => undefined);
  }

  private async startRelay(rawCommand: Record<string, unknown>): Promise<void> {
    const id = readId(rawCommand);
    if (this.active) {
      this.sendError(id, 'RTMP_ALREADY_ACTIVE', 'An RTMP relay is already active on this connection');
      return;
    }

    let command: StartCommand;
    let target: RtmpTarget;
    try {
      command = parseStartCommand(rawCommand);
      target = parseRtmpTarget(command.url, command.streamKey);
    } catch (error) {
      this.sendError(id, 'RTMP_INVALID_TARGET', safeErrorMessage(error, 'Invalid RTMP relay configuration'));
      return;
    }

    const acquired = await this.options.lease.acquire().catch(() => false);
    if (!acquired) {
      this.sendStatus(id, 'error', 'Too many active streams');
      this.sendError(id, 'RTMP_TOO_MANY_ACTIVE', 'Too many active streams');
      return;
    }

    const relay = new ActiveRelay({
      debug: this.options.debug,
      id: command.id,
      onFinished: (finished) => this.relayFinished(finished),
      sendJson: this.options.sendJson,
      streamKey: command.streamKey,
      target,
      transportFactory: this.options.transportFactory,
    });
    this.active = relay;
    this.startRelayTimers();
    this.options.sendJson({ id: command.id, ok: true, started: true });
    relay.start();
  }

  private async stopRelay(id: string): Promise<void> {
    const active = this.active;
    if (!active) {
      this.sendError(id, 'RTMP_NOT_ACTIVE', 'No RTMP relay is active on this connection');
      return;
    }
    await active.stop();
    this.options.sendJson({ id, ok: true, stopped: true });
  }

  private async relayFinished(relay: ActiveRelay): Promise<void> {
    if (this.active !== relay) return;
    this.active = null;
    this.clearRelayTimers();
    await this.options.lease.release().catch(() => undefined);
  }

  private startRelayTimers(): void {
    this.clearRelayTimers();
    this.leaseTimer = setInterval(() => {
      void this.options.lease.refresh().catch(() => undefined);
    }, LEASE_REFRESH_MS);
    this.revalidationTimer = setInterval(() => {
      void this.options.revalidateSession().then((valid) => {
        if (!valid) return this.failAndClose('Session expired');
        return undefined;
      }).catch(() => this.failAndClose('Session expired'));
    }, SESSION_RECHECK_MS);
  }

  private clearRelayTimers(): void {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    this.leaseTimer = null;
    this.revalidationTimer = null;
  }

  private async failAndClose(message: string): Promise<void> {
    if (this.closed) return;
    const id = this.active?.id;
    this.sendStatus(id, 'error', message);
    this.options.close(1008, message);
    await this.dispose();
  }

  private sendError(id: string, code: string, message: string): void {
    this.options.sendJson({ id, ok: false, error: { code, message } });
  }

  private sendStatus(id: string | undefined, state: string, message?: string): void {
    this.options.sendJson({
      ...(id ? { id } : {}),
      ...(message ? { message } : {}),
      ok: true,
      state,
      type: 'rtmp-status',
    });
  }
}

interface ActiveRelayOptions {
  debug?(message: string): void;
  id: string;
  onFinished(relay: ActiveRelay): Promise<void> | void;
  sendJson(value: unknown): void;
  streamKey: string;
  target: RtmpTarget;
  transportFactory: RtmpTransportFactory;
}

class ActiveRelay {
  private readonly abortController = new AbortController();
  private audioConfig: Uint8Array | null = null;
  private client: RtmpClient | null = null;
  private lastAudioTimestamp: number | null = null;
  private lastVideoTimestamp: number | null = null;
  private readonly queue = new MediaQueue();
  private pumpError: Error | null = null;
  private publishing = false;
  private runPromise: Promise<void> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly startedAt = Date.now();
  private videoConfig: Uint8Array | null = null;
  private readonly options: ActiveRelayOptions;

  constructor(options: ActiveRelayOptions) {
    this.options = options;
  }

  get id(): string {
    return this.options.id;
  }

  start(): void {
    this.runPromise = this.run();
  }

  acceptMedia(frame: MediaFrame): void {
    if (frame.kind === 1) {
      this.videoConfig = frame.payload.slice();
      if (this.publishing) this.queue.enqueue({ ...frame, timestampMs: 0 });
      return;
    }
    if (frame.kind === 2) {
      this.audioConfig = frame.payload.slice();
      if (this.publishing) this.queue.enqueue({ ...frame, timestampMs: 0 });
      return;
    }
    if (frame.kind === 3 && !this.videoConfig) {
      this.queue.dropFrame();
      return;
    }
    if (frame.kind === 4 && !this.audioConfig) {
      this.queue.dropFrame();
      return;
    }
    const last = frame.kind === 3 ? this.lastVideoTimestamp : this.lastAudioTimestamp;
    const timestampMs = monotonicTimestamp(last, frame.timestampMs);
    if (frame.kind === 3) this.lastVideoTimestamp = timestampMs;
    else this.lastAudioTimestamp = timestampMs;
    this.queue.enqueue({ ...frame, timestampMs });
  }

  async stop(suppressTerminalStatus = false): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      this.suppressTerminalStatus = suppressTerminalStatus;
      this.abortController.abort();
      await this.client?.close();
    }
    await this.runPromise?.catch(() => undefined);
  }

  private suppressTerminalStatus = false;

  private async run(): Promise<void> {
    this.sendStatus('connecting');
    try {
      const transport = await this.options.transportFactory(this.options.target, this.abortController.signal);
      if (this.abortController.signal.aborted) {
        await transport.close();
        return;
      }
      this.client = new RtmpClient(transport);
      await this.client.run(this.options.target, this.options.streamKey, {
        onDebug: (message) => this.options.debug?.(message),
        onConnected: () => this.sendStatus('connected'),
        onPublishing: () => this.beginPublishing(),
      }, this.abortController.signal);
      if (this.pumpError) throw this.pumpError;
      if (!this.stopped) throw new Error('RTMP server closed the connection');
      this.sendStatus('ended');
    } catch (error) {
      if (this.pumpError) {
        const message = redactSecret(this.pumpError.message, this.options.streamKey);
        this.sendStatus('error', message);
      } else if (this.stopped || this.abortController.signal.aborted) {
        if (!this.suppressTerminalStatus) this.sendStatus('ended');
      } else {
        const message = redactSecret(safeErrorMessage(error, 'RTMP relay failed'), this.options.streamKey);
        this.sendStatus('error', message);
      }
    } finally {
      this.stopStats();
      this.publishing = false;
      await this.options.onFinished(this);
    }
  }

  private async beginPublishing(): Promise<void> {
    this.sendStatus('publishing');
    this.publishing = true;
    if (this.videoConfig) {
      await this.client!.publishVideo(buildFlvVideoBody(this.videoConfig, true, true), 0);
    }
    if (this.audioConfig) {
      await this.client!.publishAudio(buildFlvAudioBody(this.audioConfig, true), 0);
    }
    this.startStats();
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.abortController.signal.aborted) {
        const frame = await this.queue.dequeue(this.abortController.signal);
        if (!frame) return;
        if (frame.kind === 1) {
          await this.client!.publishVideo(buildFlvVideoBody(frame.payload, true, true), 0);
        } else if (frame.kind === 2) {
          await this.client!.publishAudio(buildFlvAudioBody(frame.payload, true), 0);
        } else if (frame.kind === 3) {
          await this.client!.publishVideo(
            buildFlvVideoBody(frame.payload, frame.keyframe, false),
            frame.timestampMs,
          );
        } else {
          await this.client!.publishAudio(buildFlvAudioBody(frame.payload, false), frame.timestampMs);
        }
      }
    } catch (error) {
      this.pumpError = error instanceof Error ? error : new Error('RTMP media write failed');
      this.abortController.abort();
      await this.client?.close();
    }
  }

  private startStats(): void {
    this.stopStats();
    this.statsTimer = setInterval(() => {
      this.options.sendJson({
        droppedFrames: this.queue.droppedFrames,
        id: this.options.id,
        ok: true,
        queuedBytes: this.queue.queuedBytes,
        queuedMessages: this.queue.queuedMessages,
        sentBytes: this.client?.sentBytes ?? 0,
        type: 'rtmp-stats',
        uptimeMs: Date.now() - this.startedAt,
      });
    }, 1_000);
  }

  private stopStats(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private sendStatus(state: string, message?: string): void {
    this.options.sendJson({
      id: this.options.id,
      ...(message ? { message } : {}),
      ok: true,
      state,
      type: 'rtmp-status',
    });
  }
}

export function parseMediaFrame(bytes: Uint8Array): MediaFrame {
  if (bytes.byteLength < 12) throw new Error('RTMP media frame is shorter than its 12-byte header');
  const kind = bytes[0];
  if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4) {
    throw new Error('Unknown RTMP media frame kind');
  }
  const timestampUs = new DataView(bytes.buffer, bytes.byteOffset + 4, 8).getBigUint64(0, true);
  return {
    keyframe: (bytes[1]! & 1) !== 0,
    kind: kind as MediaKind,
    payload: bytes.slice(12),
    timestampMs: Number((timestampUs / 1_000n) & 0xffff_ffffn),
  };
}

export function monotonicTimestamp(last: number | null, received: number): number {
  if (last === null) return received >>> 0;
  const delta = (received - last) >>> 0;
  return delta === 0 || delta > 0x7fff_ffff ? (last + 1) >>> 0 : received >>> 0;
}

export class TokenBucket {
  private readonly bytesPerSecond: number;
  private readonly capacity: number;
  private lastRefillMs: number;
  private readonly now: () => number;
  private tokens: number;

  constructor(
    bytesPerSecond: number,
    capacity: number,
    now: () => number = Date.now,
  ) {
    this.bytesPerSecond = bytesPerSecond;
    this.capacity = capacity;
    this.now = now;
    this.lastRefillMs = now();
    this.tokens = capacity;
  }

  consume(bytes: number): boolean {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    this.lastRefillMs = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.bytesPerSecond / 1_000);
    if (bytes > this.tokens) return false;
    this.tokens -= bytes;
    return true;
  }
}

function parseStartCommand(value: Record<string, unknown>): StartCommand {
  const id = readId(value);
  if (!id || id.length > 256) throw new Error('Invalid RTMP command id');
  if (typeof value.url !== 'string' || typeof value.streamKey !== 'string') {
    throw new Error('Invalid RTMP start command');
  }
  if (!isVideoConfig(value.video) || !isAudioConfig(value.audio)) {
    throw new Error('Invalid RTMP encoding configuration');
  }
  return {
    audio: value.audio as unknown as AudioConfig,
    cmd: 'rtmpStart',
    id,
    streamKey: value.streamKey,
    url: value.url,
    video: value.video as unknown as VideoConfig,
  };
}

function isVideoConfig(value: unknown): value is VideoConfig {
  if (!isRecord(value)) return false;
  return isU32(value.width)
    && isU32(value.height)
    && typeof value.fps === 'number'
    && Number.isFinite(value.fps)
    && value.fps > 0
    && isU32(value.bitrateKbps);
}

function isAudioConfig(value: unknown): value is AudioConfig {
  if (!isRecord(value)) return false;
  return isU32(value.sampleRate)
    && Number.isInteger(value.channels)
    && typeof value.channels === 'number'
    && value.channels > 0
    && value.channels <= 0xff
    && isU32(value.bitrateKbps);
}

function isU32(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    && value <= 0xffff_ffff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(value: unknown): string {
  return isRecord(value) && typeof value.id === 'string' ? value.id : '';
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
