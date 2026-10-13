// Intra MXF essence (DNxHD/DNxHR, MPEG-2 Intra/IMX) decoded by the LGPL
// libavcodec WASM build in a worker pool. Every edit unit is independently
// decodable, so forward playback decodes upcoming frames on the other workers
// in parallel while the base class keeps request ordering and exact seeks.

import type { DecodeSessionPolicy } from '../types';
import {
  CodecFrameProviderBase,
  closeVideoFrame,
  normalizeError,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import type {
  LibavWorkerCodec,
} from '../../../workers/libavDecodeWorker';
import { MxfPacketSource, type MxfPacket } from './MxfPacketSource';

export type MxfLibavIntraCodecId = 'mxf:dnxhd' | 'mxf:mpeg2-intra';

export interface MxfLibavFrameProviderOptions extends CodecFrameProviderBaseOptions {
  codecId: MxfLibavIntraCodecId;
  /** 8-bit output for Canvas2D consumers (thumbnails); 10-bit renders black there. */
  eightBit?: boolean;
  workerCount?: number;
  packetSourceFactory?: (file: File, codecId: string) => Promise<MxfPacketSource>;
}

const CODEC_FOR_ID: Record<MxfLibavIntraCodecId, LibavWorkerCodec> = {
  'mxf:dnxhd': 'dnxhd',
  'mxf:mpeg2-intra': 'mpeg2video',
};

import { LibavWorker, type LibavOpenRequest } from '../codec/LibavWorker';
export { LibavWorker, type LibavOpenRequest } from '../codec/LibavWorker';

/** Worker open parameters derived from the MXF picture descriptor. */
export function createLibavOpenRequest(
  source: MxfPacketSource,
  codec: LibavWorkerCodec,
  eightBit: boolean,
): LibavOpenRequest {
  const video = source.mxf.video!;
  const visibleRect = video.displayYOffset > 0 || video.height !== video.codedHeight
    ? { x: 0, y: video.displayYOffset, width: video.width, height: video.height }
    : null;
  return {
    type: 'open',
    codec,
    eightBit,
    visibleRect,
    colorMatrix: video.height <= 576 ? 'smpte170m' : 'bt709',
    frameDurationUs: Math.round(1e6 / (video.fps || 25)),
    deinterlace: true,
  };
}

/** Workers per policy (plan: interactive/export up to 4, background up to 2), bounded by cores. */
export function planLibavWorkerCount(policy: DecodeSessionPolicy, width: number, height: number): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const heavy = width * height > 2_500_000;
  const wanted = policy === 'background'
    ? (heavy ? 2 : 1)
    : (heavy ? 4 : 2);
  return Math.max(1, Math.min(wanted, cores - 1));
}


export class MxfLibavFrameProvider extends CodecFrameProviderBase<MxfPacket, MxfLibavFrameProviderOptions> {
  readonly backend = 'mxf-libav' as const;
  protected readonly label = 'MXF libavcodec';
  protected readonly packetLabel = 'MXF packet';

  private source: MxfPacketSource | null = null;
  private workers: LibavWorker[] = [];
  private nextWorker = 0;
  private nextRequestId = 1;
  /** Decodes started ahead of playback, keyed by display index. */
  private readonly lookahead = new Map<number, Promise<VideoFrame>>();
  private lastTarget = -1;

  protected async initializeResources(): Promise<CodecPacketReader<MxfPacket>> {
    const factory = this.options.packetSourceFactory
      ?? ((file, codecId) => MxfPacketSource.create(file, codecId));
    const source = await this.withLoadTimeout(
      factory(this.options.file, this.options.codecId),
      'demux initialization',
      (late) => late.dispose(),
    );
    this.source = source;
    const video = source.mxf.video!;
    const open = createLibavOpenRequest(source, CODEC_FOR_ID[this.options.codecId], this.options.eightBit === true);
    const count = this.options.workerCount
      ?? planLibavWorkerCount(this.options.policy ?? 'interactive', video.width, video.height);
    this.workers = Array.from({ length: count }, () => new LibavWorker(open));
    await this.withLoadTimeout(Promise.all(this.workers.map((w) => w.ready())), 'decoder worker initialization');
    return source;
  }

  protected hasDecoder(): boolean {
    return this.workers.length > 0;
  }

  protected getBackendDebugInfo() {
    return {
      codec: `mxf-libav:${this.options.codecId}`,
      hwAccel: 'wasm-worker',
      decodeQueueSize: this.workers.reduce((sum, w) => sum + w.queueSize, 0),
      workerCount: this.workers.length,
      lookaheadCount: this.lookahead.size,
    };
  }

  protected async decodePacketToFrame(packet: MxfPacket): Promise<VideoFrame> {
    const target = packet.displayIndex;
    const sequential = target === this.lastTarget + 1;
    this.lastTarget = target;
    this.dropLookahead((index) => index < target || (!sequential && index !== target));
    const pending = this.lookahead.get(target) ?? this.dispatch(packet);
    this.lookahead.delete(target);
    if (sequential) void this.fillLookahead(packet);
    return pending;
  }

  protected async releaseDecoderResources(): Promise<void> {
    this.dropLookahead(() => true);
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.source = null;
  }

  private dispatch(packet: MxfPacket): Promise<VideoFrame> {
    const worker = this.workers[this.nextWorker % this.workers.length]!;
    this.nextWorker += 1;
    const promise = worker.decode(this.nextRequestId++, packet);
    void promise.catch(() => undefined);
    return promise;
  }

  /** Starts decoding the next frames on idle workers (one per extra worker). */
  private async fillLookahead(from: MxfPacket): Promise<void> {
    const source = this.source;
    if (!source || this.workers.length < 2) return;
    let packet: MxfPacket | null = from;
    for (let ahead = 1; ahead < this.workers.length && packet; ahead += 1) {
      packet = await source.getNextPacket(packet);
      if (!packet || this.destroyed) return;
      if (!this.lookahead.has(packet.displayIndex) && packet.displayIndex > this.lastTarget) {
        this.lookahead.set(packet.displayIndex, this.dispatch(packet));
      }
    }
  }

  private dropLookahead(shouldDrop: (index: number) => boolean): void {
    for (const [index, promise] of this.lookahead) {
      if (!shouldDrop(index)) continue;
      this.lookahead.delete(index);
      void promise.then(closeVideoFrame, () => undefined);
    }
  }
}

export async function createMxfLibavFrameProvider(
  options: MxfLibavFrameProviderOptions,
): Promise<MxfLibavFrameProvider | null> {
  const provider = new MxfLibavFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
