// Long-GOP MXF essence on CodecFrameProviderBase. The provider only drives
// request timing (from data-less packet descriptions); a GopFrameSource turns
// "display frame N" into a decoded VideoFrame. That source is MxfGopEngine on
// this thread, or a decode worker that owns reads and decoding.

import {
  CodecFrameProviderBase,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import type { MxfGopEngineStats } from './mxfGopEngine';
import { gopThumbnailSeekTime, gopThumbnailStrideSeconds } from '../codec/gopThumbnails';
import { MxfPacketSource, type MxfPacket } from './MxfPacketSource';

export type { GopDecoder, GopDecoderCallbacks } from './mxfGopEngine';

export interface GopFrameSource {
  readonly stats: MxfGopEngineStats;
  /** Decodes the frame displayed at `displayIndex`; the caller owns the returned frame. */
  decodeFrame(displayIndex: number): Promise<VideoFrame>;
  close(): void;
}

export interface MxfGopFrameProviderOptions extends CodecFrameProviderBaseOptions {
  codecId: string;
  packetSourceFactory?: (file: File, codecId: string) => Promise<MxfPacketSource>;
}

export abstract class MxfGopFrameProvider<
  TOptions extends MxfGopFrameProviderOptions,
> extends CodecFrameProviderBase<MxfPacket, TOptions> {
  /**
   * No cached clones: hardware long-GOP decoding has ~10 output surfaces at 4K and
   * the decoder already holds ~5 as references; runtime cache clones stalled it.
   */
  readonly frameCacheLimit = 0;
  protected source: MxfPacketSource | null = null;
  private frames: GopFrameSource | null = null;

  /** Creates the frame source once the packet source (and thus the essence) is known. */
  protected abstract createFrameSource(source: MxfPacketSource): Promise<GopFrameSource>;
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
    this.frames = await this.withLoadTimeout(
      this.createFrameSource(source),
      'decoder initialization',
      (late) => late.close(),
    );
    // Timing only: packet data is read by the frame source, never here.
    return {
      metadata: source.metadata,
      getPacketAt: async (timeSeconds) => source.describePacketAt(timeSeconds),
      getNextPacket: async (packet) => source.describeNextPacket(packet),
      dispose: () => source.dispose(),
    };
  }

  getThumbnailSeekTime(timeSeconds: number): number {
    return gopThumbnailSeekTime(this.source, timeSeconds);
  }

  getThumbnailStrideSeconds(durationSeconds: number): number {
    return gopThumbnailStrideSeconds(durationSeconds);
  }

  protected hasDecoder(): boolean {
    return this.frames !== null;
  }

  protected getBackendDebugInfo() {
    return {
      ...this.describeDecoder(),
      ...(this.frames?.stats ?? { decodeQueueSize: 0, readyFrameCount: 0, decoderResets: 0 }),
    };
  }

  protected decodePacketToFrame(packet: MxfPacket): Promise<VideoFrame> {
    const frames = this.frames;
    if (!frames) return Promise.reject(new Error(`${this.label} decoder is unavailable`));
    return frames.decodeFrame(packet.displayIndex);
  }

  protected async releaseDecoderResources(): Promise<void> {
    const frames = this.frames;
    this.frames = null;
    this.source = null;
    try { frames?.close(); } catch { /* best-effort */ }
  }
}
