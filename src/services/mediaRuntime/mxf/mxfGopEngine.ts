// Long-GOP decode engine: turns "give me display frame N" into stored-order
// packet feeding. A request decodes forward from the previous key frame,
// reorders by timestamp and keeps a few upcoming frames, so forward playback
// and monotonic exact seeks continue without a decoder reset. Runs on the main
// thread or inside a decode worker; the decoder plugs in through GopDecoder.

import { closeVideoFrame, normalizeError } from '../codec/CodecFrameProviderBase';
import type { MxfPacket, MxfPacketSource } from './MxfPacketSource';

export interface GopDecoder {
  readonly queueSize: number;
  /** Queues one stored-order packet. Outputs arrive through the output callback. */
  decode(packet: MxfPacket): void;
  /** Resolves when the decoder can take another packet. */
  waitForCapacity(): Promise<void>;
  /** Emits every buffered frame; afterwards the next packet must be a key frame. */
  flush(): Promise<void>;
  /** Drops decoder state; the next packet must be a key frame. */
  reset(): void;
  close(): void;
}

export interface GopDecoderCallbacks {
  output(frame: VideoFrame): void;
  error(error: Error): void;
}

export interface MxfGopEngineStats {
  decodeQueueSize: number;
  readyFrameCount: number;
  decoderResets: number;
  /** Why the engine restarted at a key frame (diagnostics). */
  restartReasons: Record<string, number>;
  requests: number;
  readyHits: number;
  packetsFed: number;
  flushes: number;
  stalls: number;
}

/**
 * Frame budget (zero-copy): decoder outputs are GPU surfaces from a fixed pool
 * that also holds the decoder's reference pictures. Chrome's hardware H.264
 * decoder has 10 at 4K and stops dead when they are all in use (measured: 6 held
 * -> 225 fps, 10 held -> stall; the DPB takes ~4-5). Ready frames here plus the
 * consumer's current/prefetched frame must stay within the remainder.
 */
const MAX_READY_FRAMES = 5;
/**
 * Packets allowed inside the decoder at once (queued or held for reordering).
 * Enough for B-frame reordering; more only produces frames nobody asked for yet,
 * which then overflow the ready window and force restarts when requested.
 */
const MAX_IN_DECODER = 4;
/**
 * After serving a request the engine keeps decoding until this many frames are
 * ready or still inside the decoder, so forward playback finds them decoded.
 */
const READY_AHEAD = 2;
/** Re-check interval while waiting for decoder capacity (never wait unbounded). */
const CAPACITY_WAIT_MS = 100;
/**
 * Capacity waits without progress before held frames are released (last resort:
 * releasing ready frames forces restarts, so only after ~2 s of a real stall).
 */
const STALL_WAITS_BEFORE_RELEASE = 20;
/** Keep at most this many packets queued inside the decoder. */
export const MAX_GOP_DECODE_QUEUE = 4;
/** Jumping further than this many stored units ahead restarts from the target's key frame. */
const MAX_FORWARD_FEED = 48;
/** Across a key frame, decode through up to this many units (~1 s) instead of resetting. */
const MAX_DECODE_THROUGH = 25;

interface PendingTarget {
  displayIndex: number;
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
}

export class MxfGopEngine {
  private readonly source: MxfPacketSource;
  private readonly label: string;
  private decoder: GopDecoder | null = null;
  /** Next stored index the decoder expects; -1 = must restart at a key frame. */
  private nextStored = -1;
  /** Highest display index the decoder has emitted since the last reset. */
  private lastEmittedDisplay = -1;
  private readonly readyFrames = new Map<number, VideoFrame>();
  private pending: PendingTarget | null = null;
  private decoderError: Error | null = null;
  private resetCount = 0;
  private readonly restartReasons: Record<string, number> = {};
  private requests = 0;
  private readyHits = 0;
  private packetsFed = 0;
  private flushes = 0;
  private stalls = 0;
  private closed = false;
  /** Incremented on every restart; packets read for an older generation are dropped. */
  private generation = 0;
  private pumpActive = false;
  /** Packets fed minus frames output since the last reset: frames still inside the decoder. */
  private inDecoder = 0;
  private outputWaiters: (() => void)[] = [];
  /** Requests are served one at a time; callers may still issue them concurrently. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(source: MxfPacketSource, label: string) {
    this.source = source;
    this.label = label;
  }

  async attachDecoder(create: (callbacks: GopDecoderCallbacks) => Promise<GopDecoder>): Promise<void> {
    this.decoder = await create({
      output: (frame) => this.onOutput(frame),
      error: (error) => {
        this.decoderError = error;
        this.nextStored = -1;
        this.failPending(error);
      },
    });
  }

  get stats(): MxfGopEngineStats {
    return {
      decodeQueueSize: this.decoder?.queueSize ?? 0,
      readyFrameCount: this.readyFrames.size,
      decoderResets: this.resetCount,
      restartReasons: { ...this.restartReasons },
      requests: this.requests,
      readyHits: this.readyHits,
      packetsFed: this.packetsFed,
      flushes: this.flushes,
      stalls: this.stalls,
    };
  }

  /** Decodes the frame displayed at `displayIndex`; the caller owns the returned frame. */
  decodeFrame(displayIndex: number): Promise<VideoFrame> {
    const run = this.queue.then(() => this.decodeFrameNow(displayIndex));
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failPending(new Error(`${this.label} decoder closed`));
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    const decoder = this.decoder;
    this.decoder = null;
    try { decoder?.close(); } catch { /* best-effort */ }
  }

  private async decodeFrameNow(target: number): Promise<VideoFrame> {
    const decoder = this.decoder;
    if (this.closed || !decoder) throw new Error(`${this.label} decoder is unavailable`);

    this.requests += 1;
    const ready = this.takeReadyFrame(target);
    if (ready) {
      this.readyHits += 1;
      return ready;
    }

    const targetStored = this.source.displayToStoredIndex(target);
    const keyStored = this.source.keyframeStoredIndexFor(target);
    const feedDistance = targetStored - this.nextStored;
    // Forward playback that fell a little behind lands in the next GOP: decoding
    // straight through is far cheaper than a decoder reset plus a GOP re-decode, and
    // restarting there is what turned slow frames into a restart-per-frame spiral.
    const canContinue = !this.decoderError
      && this.nextStored >= 0
      && target > this.lastEmittedDisplay
      && (keyStored <= this.nextStored || feedDistance <= MAX_DECODE_THROUGH)
      && feedDistance <= MAX_FORWARD_FEED;
    if (!canContinue) {
      const reason = this.decoderError ? 'error'
        : this.nextStored < 0 ? 'not-started'
          : target <= this.lastEmittedDisplay ? 'behind-output'
            : feedDistance > MAX_FORWARD_FEED ? 'far-ahead'
              : 'next-gop';
      this.restartReasons[reason] = (this.restartReasons[reason] ?? 0) + 1;
      this.restartAt(keyStored, decoder);
    }

    const framePromise = new Promise<VideoFrame>((resolve, reject) => {
      this.pending = { displayIndex: target, resolve, reject };
    });
    void framePromise.catch(() => undefined);
    this.ensurePump();
    return framePromise;
  }

  private restartAt(keyStored: number, decoder: GopDecoder): void {
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    decoder.reset();
    this.generation += 1;
    this.inDecoder = 0;
    for (const wake of this.outputWaiters.splice(0)) wake();
    this.decoderError = null;
    this.nextStored = keyStored;
    this.lastEmittedDisplay = -1;
    this.resetCount += 1;
  }

  private displayIndexOf(frame: VideoFrame): number {
    return Math.round((frame.timestamp / 1e6) * (this.source.metadata.fps || 25));
  }

  private onOutput(frame: VideoFrame): void {
    if (this.closed) {
      closeVideoFrame(frame);
      return;
    }
    const display = this.displayIndexOf(frame);
    this.inDecoder = Math.max(0, this.inDecoder - 1);
    for (const wake of this.outputWaiters.splice(0)) wake();
    this.lastEmittedDisplay = Math.max(this.lastEmittedDisplay, display);
    const pending = this.pending;
    if (pending && display === pending.displayIndex) {
      this.pending = null;
      pending.resolve(frame);
      return;
    }
    if (pending && display < pending.displayIndex) {
      closeVideoFrame(frame);
      return;
    }
    const previous = this.readyFrames.get(display);
    if (previous) closeVideoFrame(previous);
    this.readyFrames.set(display, frame);
    if (this.readyFrames.size > MAX_READY_FRAMES) {
      const farthest = Math.max(...this.readyFrames.keys());
      closeVideoFrame(this.readyFrames.get(farthest)!);
      this.readyFrames.delete(farthest);
    }
  }

  private takeReadyFrame(display: number): VideoFrame | null {
    const frame = this.readyFrames.get(display) ?? null;
    if (!frame) return null;
    this.readyFrames.delete(display);
    // Frames before the target are no longer useful for forward playback.
    for (const [index, stale] of this.readyFrames) {
      if (index < display) {
        closeVideoFrame(stale);
        this.readyFrames.delete(index);
      }
    }
    return frame;
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private async drainToEnd(decoder: GopDecoder): Promise<void> {
    this.flushes += 1;
    await decoder.flush();
    this.inDecoder = 0;
    this.nextStored = -1;
    if (this.pending) throw new Error(`${this.label} frame ${this.pending.displayIndex} was not produced`);
  }

  /**
   * One feeding loop per engine. It serves the pending request and then keeps the
   * ready window filled, so forward playback finds frames already decoded.
   */
  private ensurePump(): void {
    if (this.pumpActive || this.closed) return;
    this.pumpActive = true;
    void this.pump()
      .catch((error) => this.failPending(normalizeError(error)))
      .finally(() => {
        this.pumpActive = false;
        if (this.pending && !this.closed) this.ensurePump();
      });
  }

  private wantsMoreFrames(): boolean {
    if (this.pending) return true;
    return this.nextStored >= 0 && this.readyFrames.size + this.inDecoder < READY_AHEAD;
  }

  private async pump(): Promise<void> {
    let fedPastTarget = 0;
    let stalledWaits = 0;
    while (!this.closed && this.decoder && this.wantsMoreFrames()) {
      const decoder = this.decoder;
      if (this.decoderError) {
        if (this.pending) throw this.decoderError;
        return;
      }
      if (this.nextStored < 0) return;
      if (this.nextStored >= this.source.frameCount) {
        await this.drainToEnd(decoder);
        return;
      }
      if (this.inDecoder >= MAX_IN_DECODER) {
        // Enough in flight for reordering: wait for the next output instead of overfeeding.
        const progressed = await Promise.race([
          new Promise<boolean>((resolve) => this.outputWaiters.push(() => resolve(true))),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CAPACITY_WAIT_MS)),
        ]);
        if (!progressed) {
          this.stalls += 1;
          stalledWaits += 1;
          // A decoder that needs more input to release a frame (deep reorder) must not deadlock.
          if (stalledWaits >= 3) this.inDecoder = Math.max(0, MAX_IN_DECODER - 1);
        } else {
          stalledWaits = 0;
        }
        continue;
      }
      if (decoder.queueSize >= MAX_GOP_DECODE_QUEUE) {
        const progressed = await Promise.race([
          decoder.waitForCapacity().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CAPACITY_WAIT_MS)),
        ]);
        stalledWaits = progressed ? 0 : stalledWaits + 1;
        if (!progressed) this.stalls += 1;
        if (stalledWaits >= STALL_WAITS_BEFORE_RELEASE) {
          // Starved of output surfaces. Without a request waiting, just stop filling;
          // with one, give back the frames we hold so the decoder can continue.
          if (!this.pending) return;
          for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
          this.readyFrames.clear();
          stalledWaits = 0;
        }
        continue;
      }
      const generation = this.generation;
      const index = this.nextStored;
      this.nextStored += 1;
      const packet = await this.source.getPacketByStoredIndex(index);
      // A restart while reading moved the decoder elsewhere: this packet is stale.
      if (generation !== this.generation || this.closed) continue;
      if (!packet) throw new Error(`${this.label} packet ${index} is missing`);
      decoder.decode(packet);
      this.packetsFed += 1;
      this.inDecoder += 1;
      if (this.pending && packet.displayIndex >= this.pending.displayIndex) {
        fedPastTarget += 1;
        // Reordering never needs more than a GOP of look-ahead; then force the output out.
        if (fedPastTarget > MAX_FORWARD_FEED) {
          await this.drainToEnd(decoder);
          return;
        }
      } else {
        fedPastTarget = 0;
      }
      // Let output callbacks run before feeding more.
      await Promise.resolve();
    }
  }
}
