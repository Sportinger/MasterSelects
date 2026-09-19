// Range-backed Mediabunny demux for HAP MOV/MP4 sources.
// Structural sibling of TurboResPacketSource: EncodedPacketSink pulls raw
// HAP samples for any FourCC; decode happens in the HAP frame provider.

import {
  BlobSource,
  EncodedPacketSink,
  Input,
  MP4,
  QTFF,
  type InputVideoTrack,
} from 'mediabunny';
import {
  getHapVideoFourCC,
  type HapVideoFourCC,
} from '../../hap/hapCodecIdentity';

const MAX_HAP_DIMENSION = 16_384;
const HAP_BLOB_CACHE_BYTES = 32 * 1024 * 1024;

export interface HapPacket {
  readonly data: Uint8Array;
  readonly timestamp: number;
  readonly duration: number;
  readonly microsecondTimestamp: number;
  readonly microsecondDuration: number;
}

export interface HapPacketSourceMetadata {
  fourCC: HapVideoFourCC;
  duration: number;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  rotation: number;
  fps: number;
}

export interface HapPacketReader {
  readonly metadata: HapPacketSourceMetadata;
  getPacketAt(timeSeconds: number): Promise<HapPacket | null>;
  getNextPacket?(packet: HapPacket): Promise<HapPacket | null>;
  dispose(): void;
}

function requireDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_HAP_DIMENSION) {
    throw new Error(`Invalid HAP ${label}: ${value}`);
  }
  return value;
}

async function readFrameRate(track: InputVideoTrack): Promise<number> {
  try {
    const stats = await track.computePacketStats(200);
    return stats.averagePacketRate > 0 ? stats.averagePacketRate : 0;
  } catch {
    return 0;
  }
}

export class HapPacketSource implements HapPacketReader {
  readonly metadata: HapPacketSourceMetadata;

  private readonly input: Input<BlobSource>;
  private readonly sink: EncodedPacketSink;
  private disposed = false;

  private constructor(
    input: Input<BlobSource>,
    track: InputVideoTrack,
    metadata: HapPacketSourceMetadata,
  ) {
    this.input = input;
    this.sink = new EncodedPacketSink(track);
    this.metadata = metadata;
  }

  static async create(
    file: File,
    expectedFourCC?: HapVideoFourCC,
  ): Promise<HapPacketSource> {
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error('HAP provider requires a non-empty File source');
    }

    const input = new Input({
      formats: [MP4, QTFF],
      source: new BlobSource(file, { maxCacheSize: HAP_BLOB_CACHE_BYTES }),
    });

    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('Media source has no video track');

      const fourCC = getHapVideoFourCC(track.internalCodecId);
      if (!fourCC) {
        throw new Error(`Unsupported HAP codec identifier: ${String(track.internalCodecId ?? 'unknown')}`);
      }
      if (expectedFourCC && fourCC !== expectedFourCC) {
        throw new Error(`HAP codec changed from ${expectedFourCC} to ${fourCC}`);
      }

      const [durationResult, fps] = await Promise.all([
        input.computeDuration(),
        readFrameRate(track),
      ]);
      const duration = Number.isFinite(durationResult) && durationResult > 0
        ? durationResult
        : 0;
      const metadata: HapPacketSourceMetadata = {
        fourCC,
        duration,
        width: requireDimension(track.displayWidth, 'display width'),
        height: requireDimension(track.displayHeight, 'display height'),
        codedWidth: requireDimension(track.codedWidth, 'coded width'),
        codedHeight: requireDimension(track.codedHeight, 'coded height'),
        rotation: Number.isFinite(track.rotation) ? track.rotation : 0,
        fps,
      };
      return new HapPacketSource(input, track, metadata);
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  async getPacketAt(timeSeconds: number): Promise<HapPacket | null> {
    if (this.disposed) throw new Error('HAP packet source is disposed');
    const maxTime = this.metadata.duration > 0
      ? Math.max(0, this.metadata.duration - Number.EPSILON)
      : Number.POSITIVE_INFINITY;
    const targetTime = Math.min(maxTime, Math.max(0, timeSeconds));
    const packet = await this.sink.getPacket(targetTime)
      ?? await this.sink.getFirstPacket();
    return packet as HapPacket | null;
  }

  async getNextPacket(packet: HapPacket): Promise<HapPacket | null> {
    if (this.disposed) throw new Error('HAP packet source is disposed');
    return (await this.sink.getNextPacket(
      packet as Parameters<EncodedPacketSink['getNextPacket']>[0],
    )) as HapPacket | null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
  }
}
