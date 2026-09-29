// H.264 essence from MXF (XAVC-I / XAVC Long GOP / AVC-Intra) decoded with
// WebCodecs. Long GOP: a request decodes forward from the previous key frame in
// stored order, reorders by timestamp and keeps a few upcoming frames, so forward
// playback and monotonic exact seeks (export, proxy) continue without a reset.

import {
  CodecFrameProviderBase,
  closeVideoFrame,
  normalizeError,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import { MxfPacketSource, type MxfPacket } from './MxfPacketSource';
import { getAvcCodecStringFromAnnexB } from './avcCodecString';

export interface MxfAvcFrameProviderOptions extends CodecFrameProviderBaseOptions {
  codecId: string;
  packetSourceFactory?: (file: File, codecId: string) => Promise<MxfPacketSource>;
}

/** Decoded frames kept ahead of the current target (bounded: hardware decoders own few surfaces). */
const MAX_READY_FRAMES = 6;
/** Keep at most this many chunks queued inside the decoder. */
const MAX_DECODE_QUEUE = 4;
/** Jumping further than this many stored units ahead restarts from the target's key frame. */
const MAX_FORWARD_FEED = 48;

interface PendingTarget {
  displayIndex: number;
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
}

export class MxfAvcFrameProvider extends CodecFrameProviderBase<MxfPacket, MxfAvcFrameProviderOptions> {
  readonly backend = 'mxf-avc' as const;
  protected readonly label = 'MXF AVC';
  protected readonly packetLabel = 'MXF AVC packet';

  private source: MxfPacketSource | null = null;
  private decoder: VideoDecoder | null = null;
  private config: VideoDecoderConfig | null = null;
  /** Next stored index the decoder expects; -1 = must restart at a key frame. */
  private nextStored = -1;
  /** Highest display index the decoder has emitted since the last reset. */
  private lastEmittedDisplay = -1;
  private readonly readyFrames = new Map<number, VideoFrame>();
  private pending: PendingTarget | null = null;
  private decoderError: Error | null = null;
  private resetCount = 0;

  protected async initializeResources(): Promise<CodecPacketReader<MxfPacket>> {
    if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs VideoDecoder is unavailable');
    const factory = this.options.packetSourceFactory
      ?? ((file, codecId) => MxfPacketSource.create(file, codecId));
    const source = await this.withLoadTimeout(
      factory(this.options.file, this.options.codecId),
      'demux initialization',
      (late) => late.dispose(),
    );
    this.source = source;
    const firstKey = await source.getPacketByStoredIndex(source.keyframeStoredIndexFor(0));
    const codec = firstKey ? getAvcCodecStringFromAnnexB(firstKey.data) : null;
    if (!codec) throw new Error('MXF AVC essence carries no in-band SPS');
    const meta = source.metadata;
    const config: VideoDecoderConfig = {
      codec,
      codedWidth: meta.codedWidth || meta.width,
      codedHeight: meta.codedHeight || meta.height,
      optimizeForLatency: true,
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`Browser cannot decode ${codec} (${meta.width}x${meta.height})`);
    this.config = support.config ?? config;
    this.createDecoder();
    return source;
  }

  protected hasDecoder(): boolean {
    return this.decoder !== null || this.config !== null;
  }

  protected getBackendDebugInfo() {
    return {
      codec: `mxf-avc:${this.config?.codec ?? this.options.codecId}`,
      hwAccel: 'webcodecs',
      decodeQueueSize: this.decoder?.decodeQueueSize ?? 0,
      readyFrameCount: this.readyFrames.size,
      decoderResets: this.resetCount,
    };
  }

  protected async decodePacketToFrame(packet: MxfPacket): Promise<VideoFrame> {
    const source = this.source;
    if (!source) throw new Error('MXF AVC source is unavailable');
    const target = packet.displayIndex;

    const ready = this.takeReadyFrame(target);
    if (ready) return ready;

    const keyStored = source.keyframeStoredIndexFor(target);
    const canContinue = this.decoder?.state === 'configured'
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
      await this.feedUntilResolved(source);
    } catch (error) {
      this.failPending(normalizeError(error));
    }
    return framePromise;
  }

  protected async releaseDecoderResources(): Promise<void> {
    this.failPending(new Error('MXF AVC provider released'));
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    const decoder = this.decoder;
    this.decoder = null;
    this.config = null;
    this.source = null;
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* best-effort */ }
  }

  private createDecoder(): void {
    this.decoder = new VideoDecoder({
      output: (frame) => this.onOutput(frame),
      error: (error) => {
        this.decoderError = normalizeError(error);
        this.nextStored = -1;
        this.failPending(this.decoderError);
      },
    });
    this.decoder.configure(this.config!);
    this.decoderError = null;
  }

  private restartAt(keyStored: number): void {
    for (const frame of this.readyFrames.values()) closeVideoFrame(frame);
    this.readyFrames.clear();
    if (!this.decoder || this.decoder.state === 'closed') {
      this.createDecoder();
    } else {
      this.decoder.reset();
      this.decoder.configure(this.config!);
    }
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

  private async feedUntilResolved(source: MxfPacketSource): Promise<void> {
    const decoder = this.decoder!;
    const frameCount = source.frameCount;
    let fedPastTarget = 0;
    while (this.pending && !this.destroyed) {
      if (this.decoderError) throw this.decoderError;
      if (this.nextStored >= frameCount) {
        // End of stream: drain the reorder buffer.
        await decoder.flush();
        this.nextStored = -1;
        if (this.pending) throw new Error(`MXF AVC frame ${this.pending.displayIndex} was not produced`);
        return;
      }
      if (decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
        await new Promise<void>((resolve) => decoder.addEventListener('dequeue', () => resolve(), { once: true }));
        continue;
      }
      const packet = await source.getPacketByStoredIndex(this.nextStored);
      if (!packet) throw new Error(`MXF AVC packet ${this.nextStored} is missing`);
      decoder.decode(new EncodedVideoChunk({
        type: packet.isKeyframe ? 'key' : 'delta',
        timestamp: packet.microsecondTimestamp,
        duration: packet.microsecondDuration,
        data: packet.data,
      }));
      this.nextStored += 1;
      if (this.pending && packet.displayIndex >= this.pending.displayIndex) fedPastTarget += 1;
      // Reordering never needs more than a GOP of look-ahead; then force the output out.
      if (fedPastTarget > MAX_FORWARD_FEED) {
        await decoder.flush();
        this.nextStored = -1;
        if (this.pending) throw new Error(`MXF AVC frame ${this.pending.displayIndex} was not produced`);
      }
      // Let output callbacks run before feeding more.
      await Promise.resolve();
    }
  }
}

export async function createMxfAvcFrameProvider(
  options: MxfAvcFrameProviderOptions,
): Promise<MxfAvcFrameProvider | null> {
  const provider = new MxfAvcFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
