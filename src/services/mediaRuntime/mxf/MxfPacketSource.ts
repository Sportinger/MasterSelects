// File-backed MXF packet reader. Implements the codec packet-reader contract
// (getPacketAt / getNextPacket / dispose) so codec providers consume MXF the
// same way they consume MOV/MP4 via Mediabunny. Offsets are cached per session
// inside this object only, never in stores.

import {
  createCachedByteSource,
  createFileByteSource,
  type MxfByteSource,
} from '../../mediaMetadata/mxf/mxfByteSource';
import { readMxfMetadata, type MxfMetadata } from '../../mediaMetadata/mxf/mxfMetadata';
import type { CodecPacket, CodecPacketSourceMetadata } from '../codec/CodecFrameProviderBase';
import { MxfPacketTable } from './mxfPacketTable';

export interface MxfPacket extends CodecPacket {
  readonly isKeyframe: boolean;
  /** Stored (decode-order) edit unit. */
  readonly storedIndex: number;
  /** Display-order edit unit. */
  readonly displayIndex: number;
}

export interface MxfPacketSourceMetadata extends CodecPacketSourceMetadata {
  codecId: string;
}

export class MxfPacketSource {
  readonly metadata: MxfPacketSourceMetadata;
  readonly mxf: MxfMetadata;
  private readonly source: MxfByteSource;
  private readonly table: MxfPacketTable;
  private disposed = false;

  private constructor(source: MxfByteSource, table: MxfPacketTable, mxf: MxfMetadata) {
    this.source = source;
    this.table = table;
    this.mxf = mxf;
    const video = mxf.video!;
    this.metadata = {
      codecId: video.codecId ?? '',
      duration: table.frameCount / (video.fps || 25),
      width: video.width,
      height: video.height,
      codedWidth: video.codedWidth,
      codedHeight: video.codedHeight,
      rotation: 0,
      fps: video.fps,
    };
  }

  static async create(file: Blob, expectedCodecId?: string): Promise<MxfPacketSource> {
    return MxfPacketSource.createFromSource(createFileByteSource(file), expectedCodecId);
  }

  static async createFromSource(raw: MxfByteSource, expectedCodecId?: string): Promise<MxfPacketSource> {
    const source = createCachedByteSource(raw, 64 * 1024);
    const mxf = await readMxfMetadata(source);
    const video = mxf.video;
    if (!video?.codecId) {
      throw new Error('MXF file has no supported picture essence');
    }
    if (expectedCodecId && video.codecId !== expectedCodecId) {
      throw new Error(`MXF picture essence is ${video.codecId}, expected ${expectedCodecId}`);
    }
    if (!(video.fps > 0) || video.width <= 0 || video.height <= 0) {
      throw new Error('MXF picture descriptor has no usable size or edit rate');
    }
    const table = await MxfPacketTable.create(source, mxf);
    return new MxfPacketSource(raw, table, mxf);
  }

  get frameCount(): number {
    return this.table.frameCount;
  }

  /** Packet whose display interval contains `timeSeconds` (clamped to the media range). */
  async getPacketAt(timeSeconds: number): Promise<MxfPacket | null> {
    if (this.disposed || !Number.isFinite(timeSeconds)) return null;
    const displayIndex = Math.floor(Math.max(0, timeSeconds) * this.metadata.fps + 1e-6);
    return this.getPacketByStoredIndex(this.table.displayToStoredIndex(displayIndex));
  }

  /** Next packet in display order (intra essence: identical to stored order). */
  async getNextPacket(packet: MxfPacket): Promise<MxfPacket | null> {
    if (this.disposed) return null;
    const next = packet.displayIndex + 1;
    if (next >= this.table.frameCount) return null;
    return this.getPacketByStoredIndex(this.table.displayToStoredIndex(next));
  }

  /** Stored index of the key frame to start decoding from for `displayIndex`. */
  keyframeStoredIndexFor(displayIndex: number): number {
    return this.table.keyframeAtOrBefore(this.table.displayToStoredIndex(displayIndex));
  }

  async getPacketByStoredIndex(storedIndex: number): Promise<MxfPacket | null> {
    if (this.disposed) return null;
    const unit = await this.table.resolve(storedIndex);
    const data = new Uint8Array(await this.source.read(unit.valueOffset, unit.size));
    if (data.length !== unit.size) throw new Error(`MXF edit unit ${storedIndex} is truncated`);
    const frameDuration = 1 / this.metadata.fps;
    const timestamp = unit.displayIndex * frameDuration;
    return {
      data,
      timestamp,
      duration: frameDuration,
      microsecondTimestamp: Math.round(timestamp * 1e6),
      microsecondDuration: Math.round(frameDuration * 1e6),
      isKeyframe: unit.isKeyframe,
      storedIndex: unit.storedIndex,
      displayIndex: unit.displayIndex,
    };
  }

  /** Position/size/keyframe of a stored unit without reading its bytes (tests, diagnostics). */
  describeStoredUnit(storedIndex: number) {
    return this.table.resolve(storedIndex);
  }

  /** See MxfPacketTable.contentPackageSpan (used by the PCM reader). */
  contentPackageSpan(storedIndex: number) {
    return this.table.contentPackageSpan(storedIndex);
  }

  /** Raw byte read for callers that parse essence themselves (PCM). */
  readBytes(offset: number, length: number): Promise<Uint8Array> {
    return this.source.read(offset, length);
  }

  dispose(): void {
    this.disposed = true;
  }
}
