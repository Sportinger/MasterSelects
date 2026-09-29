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
}

/**
 * Decoded frames kept ahead of the current target. Hardware decoders own only a
 * few output surfaces (4K on D3D11: often 4-5); frames we keep alive stall them.
 */
const MAX_READY_FRAMES = 3;
/** Re-check interval while waiting for decoder capacity (never wait unbounded). */
const CAPACITY_WAIT_MS = 100;
/** Capacity waits without progress before held frames are released to unstall the decoder. */
const STALL_WAITS_BEFORE_RELEASE = 5;
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
  private closed = false;
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

    const ready = this.takeReadyFrame(target);
    if (ready) return ready;

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
    if (!canContinue) this.restartAt(keyStored, decoder);

    const framePromise = new Promise<VideoFrame>((resolve, reject) => {
      this.pending = { displayIndex: target, resolve, reject };
    });
    void framePromise.catch(() => undefined);
    try {
      await this.feedUntilResolved(decoder);
    } catch (error) {
      this.failPending(normalizeError(error));
    }
    return framePromise;
  }

  private restartAt(keyStored: number, decoder: GopDecoder): void {
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    decoder.reset();
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
    await decoder.flush();
    this.nextStored = -1;
    if (this.pending) throw new Error(`${this.label} frame ${this.pending.displayIndex} was not produced`);
  }

  private async feedUntilResolved(decoder: GopDecoder): Promise<void> {
    const frameCount = this.source.frameCount;
    let fedPastTarget = 0;
    let stalledWaits = 0;
    while (this.pending && !this.closed) {
      if (this.decoderError) throw this.decoderError;
      if (this.nextStored >= frameCount) {
        await this.drainToEnd(decoder);
        return;
      }
      if (decoder.queueSize >= MAX_GOP_DECODE_QUEUE) {
        const progressed = await Promise.race([
          decoder.waitForCapacity().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CAPACITY_WAIT_MS)),
        ]);
        stalledWaits = progressed ? 0 : stalledWaits + 1;
        if (stalledWaits >= STALL_WAITS_BEFORE_RELEASE) {
          // The decoder is starved of output surfaces: give back the frames we hold.
          for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
          this.readyFrames.clear();
          stalledWaits = 0;
        }
        continue;
      }
      const packet = await this.source.getPacketByStoredIndex(this.nextStored);
      if (!packet) throw new Error(`${this.label} packet ${this.nextStored} is missing`);
      decoder.decode(packet);
      this.nextStored += 1;
      if (this.pending && packet.displayIndex >= this.pending.displayIndex) fedPastTarget += 1;
      // Reordering never needs more than a GOP of look-ahead; then force the output out.
      if (fedPastTarget > MAX_FORWARD_FEED) {
        await this.drainToEnd(decoder);
        return;
      }
      // Let output callbacks run before feeding more.
      await Promise.resolve();
    }
  }
}
