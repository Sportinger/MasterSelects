// Long-GOP MXF essence on CodecFrameProviderBase. A request decodes forward
// from the previous key frame in stored order, reorders by timestamp and keeps
// a few upcoming frames, so forward playback and monotonic exact seeks (export,
// proxy) continue without a reset. The actual decoder (WebCodecs, libavcodec
// worker) plugs in through GopDecoder.

import {
  CodecFrameProviderBase,
  closeVideoFrame,
  normalizeError,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import { MxfPacketSource, type MxfPacket } from './MxfPacketSource';

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

export interface MxfGopFrameProviderOptions extends CodecFrameProviderBaseOptions {
  codecId: string;
  packetSourceFactory?: (file: File, codecId: string) => Promise<MxfPacketSource>;
}

/** Decoded frames kept ahead of the current target (bounded: hardware decoders own few surfaces). */
const MAX_READY_FRAMES = 6;
/** Keep at most this many packets queued inside the decoder. */
export const MAX_GOP_DECODE_QUEUE = 4;
/** Jumping further than this many stored units ahead restarts from the target's key frame. */
const MAX_FORWARD_FEED = 48;

interface PendingTarget {
  displayIndex: number;
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
}

export abstract class MxfGopFrameProvider<
  TOptions extends MxfGopFrameProviderOptions,
> extends CodecFrameProviderBase<MxfPacket, TOptions> {
  protected source: MxfPacketSource | null = null;
  private decoder: GopDecoder | null = null;
  /** Next stored index the decoder expects; -1 = must restart at a key frame. */
  private nextStored = -1;
  /** Highest display index the decoder has emitted since the last reset. */
  private lastEmittedDisplay = -1;
  private readonly readyFrames = new Map<number, VideoFrame>();
  private pending: PendingTarget | null = null;
  private decoderError: Error | null = null;
  private resetCount = 0;

  /** Creates the decoder once the packet source (and thus the essence) is known. */
  protected abstract createGopDecoder(source: MxfPacketSource, callbacks: GopDecoderCallbacks): Promise<GopDecoder>;
  protected abstract describeDecoder(): { codec: string; hwAccel: string };

  protected async initializeResources(): Promise<CodecPacketReader<MxfPacket>> {
    const factory = this.options.packetSourceFactory
      ?? ((file, codecId) => MxfPacketSource.create(file, codecId));
    const source = await this.withLoadTimeout(
      factory(this.options.file, this.options.codecId),
      'demux initialization',
      (late) => late.dispose(),
    );
    this.source = source;
    this.decoder = await this.withLoadTimeout(
      this.createGopDecoder(source, {
        output: (frame) => this.onOutput(frame),
        error: (error) => {
          this.decoderError = error;
          this.nextStored = -1;
          this.failPending(error);
        },
      }),
      'decoder initialization',
      (late) => late.close(),
    );
    return source;
  }

  protected hasDecoder(): boolean {
    return this.decoder !== null;
  }

  protected getBackendDebugInfo() {
    return {
      ...this.describeDecoder(),
      decodeQueueSize: this.decoder?.queueSize ?? 0,
      readyFrameCount: this.readyFrames.size,
      decoderResets: this.resetCount,
    };
  }

  protected async decodePacketToFrame(packet: MxfPacket): Promise<VideoFrame> {
    const source = this.source;
    if (!source || !this.decoder) throw new Error(`${this.label} decoder is unavailable`);
    const target = packet.displayIndex;

    const ready = this.takeReadyFrame(target);
    if (ready) return ready;

    const keyStored = source.keyframeStoredIndexFor(target);
    const canContinue = !this.decoderError
      && this.nextStored >= 0
      && target > this.lastEmittedDisplay
      && keyStored <= this.nextStored
      && packet.storedIndex - this.nextStored <= MAX_FORWARD_FEED;
    if (!canContinue) this.restartAt(keyStored);

    const framePromise = new Promise<VideoFrame>((resolve, reject) => {
      this.pending = { displayIndex: target, resolve, reject };
    });
    void framePromise.catch(() => undefined);
    try {
      await this.feedUntilResolved(source, this.decoder);
    } catch (error) {
      this.failPending(normalizeError(error));
    }
    return framePromise;
  }

  protected async releaseDecoderResources(): Promise<void> {
    this.failPending(new Error(`${this.label} provider released`));
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    const decoder = this.decoder;
    this.decoder = null;
    this.source = null;
    try { decoder?.close(); } catch { /* best-effort */ }
  }

  private restartAt(keyStored: number): void {
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    this.decoder!.reset();
    this.decoderError = null;
    this.nextStored = keyStored;
    this.lastEmittedDisplay = -1;
    this.resetCount += 1;
  }

  private displayIndexOf(frame: VideoFrame): number {
    return Math.round((frame.timestamp / 1e6) * (this.source?.metadata.fps ?? 25));
  }

  private onOutput(frame: VideoFrame): void {
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

  private async feedUntilResolved(source: MxfPacketSource, decoder: GopDecoder): Promise<void> {
    const frameCount = source.frameCount;
    let fedPastTarget = 0;
    while (this.pending && !this.destroyed) {
      if (this.decoderError) throw this.decoderError;
      if (this.nextStored >= frameCount) {
        await this.drainToEnd(decoder);
        return;
      }
      if (decoder.queueSize >= MAX_GOP_DECODE_QUEUE) {
        await decoder.waitForCapacity();
        continue;
      }
      const packet = await source.getPacketByStoredIndex(this.nextStored);
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
