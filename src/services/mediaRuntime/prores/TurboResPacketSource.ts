import {
  BlobSource,
  EncodedPacketSink,
  Input,
  MP4,
  QTFF,
  type InputVideoTrack,
} from 'mediabunny';
import { TURBORES_BLOB_CACHE_BYTES } from './turboResResourceEstimate';
import {
  getTurboResProResFourCC,
  type TurboResProResFourCC,
} from './turboResCodecIdentity';

const MAX_PRORES_DIMENSION = 16_384;

export interface TurboResPacket {
  readonly data: Uint8Array;
  readonly timestamp: number;
  readonly duration: number;
  readonly microsecondTimestamp: number;
  readonly microsecondDuration: number;
}

export interface TurboResPacketSourceMetadata {
  fourCC: TurboResProResFourCC;
  duration: number;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  rotation: number;
  fps: number;
}

export interface TurboResPacketReader {
  readonly metadata: TurboResPacketSourceMetadata;
  getPacketAt(timeSeconds: number): Promise<TurboResPacket | null>;
  getNextPacket?(packet: TurboResPacket): Promise<TurboResPacket | null>;
  dispose(): void;
}

function requireDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PRORES_DIMENSION) {
    throw new Error(`Invalid ProRes ${label}: ${value}`);
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

export class TurboResPacketSource implements TurboResPacketReader {
  readonly metadata: TurboResPacketSourceMetadata;

  private readonly input: Input<BlobSource>;
  private readonly sink: EncodedPacketSink;
  private disposed = false;

  private constructor(
    input: Input<BlobSource>,
    track: InputVideoTrack,
    metadata: TurboResPacketSourceMetadata,
  ) {
    this.input = input;
    this.sink = new EncodedPacketSink(track);
    this.metadata = metadata;
  }

  static async create(
    file: File,
    expectedFourCC?: TurboResProResFourCC,
  ): Promise<TurboResPacketSource> {
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error('TurboRes requires a non-empty File source');
    }

    const input = new Input({
      formats: [MP4, QTFF],
      source: new BlobSource(file, { maxCacheSize: TURBORES_BLOB_CACHE_BYTES }),
    });

    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('Media source has no video track');

      const fourCC = getTurboResProResFourCC(track.internalCodecId);
      if (!fourCC) {
        throw new Error(`Unsupported ProRes codec identifier: ${String(track.internalCodecId ?? 'unknown')}`);
      }
      if (expectedFourCC && fourCC !== expectedFourCC) {
        throw new Error(`ProRes codec changed from ${expectedFourCC} to ${fourCC}`);
      }

      const [durationResult, fps] = await Promise.all([
        input.computeDuration(),
        readFrameRate(track),
      ]);
      const duration = Number.isFinite(durationResult) && durationResult > 0
        ? durationResult
        : 0;
      const metadata: TurboResPacketSourceMetadata = {
        fourCC,
        duration,
        width: requireDimension(track.displayWidth, 'display width'),
        height: requireDimension(track.displayHeight, 'display height'),
        codedWidth: requireDimension(track.codedWidth, 'coded width'),
        codedHeight: requireDimension(track.codedHeight, 'coded height'),
        rotation: Number.isFinite(track.rotation) ? track.rotation : 0,
        fps,
      };
      return new TurboResPacketSource(input, track, metadata);
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  async getPacketAt(timeSeconds: number): Promise<TurboResPacket | null> {
    if (this.disposed) throw new Error('TurboRes packet source is disposed');
    const maxTime = this.metadata.duration > 0
      ? Math.max(0, this.metadata.duration - Number.EPSILON)
      : Number.POSITIVE_INFINITY;
    const targetTime = Math.min(maxTime, Math.max(0, timeSeconds));
    const packet = await this.sink.getPacket(targetTime)
      ?? await this.sink.getFirstPacket();
    return packet as TurboResPacket | null;
  }

  async getNextPacket(packet: TurboResPacket): Promise<TurboResPacket | null> {
    if (this.disposed) throw new Error('TurboRes packet source is disposed');
    return (await this.sink.getNextPacket(
      packet as Parameters<EncodedPacketSink['getNextPacket']>[0],
    )) as TurboResPacket | null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
  }
}
