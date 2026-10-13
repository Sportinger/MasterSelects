import { BlobSource, EncodedPacketSink, Input, MP4, QTFF, type EncodedPacket } from 'mediabunny';
import type { CodecPacketReader, CodecPacketSourceMetadata } from '../codec/CodecFrameProviderBase';
import type { GopPacket, GopPacketSource } from '../codec/GopPacketSource';

/** MP4-Pakete bleiben komprimiert auf Platte; nur der Zeitindex liegt im Speicher. */
export class HevcPacketSource implements CodecPacketReader<GopPacket>, GopPacketSource {
  private disposed = false;
  private readonly byTimestamp = new Map<number, number>();
  private readonly displayOrder: number[];
  private readonly displayIndices: number[];
  private readonly keyIndices: number[];
  readonly frameCount: number;

  private readonly input: Input<BlobSource>;
  private readonly sink: EncodedPacketSink;
  private readonly packets: EncodedPacket[];
  readonly metadata: CodecPacketSourceMetadata;
  readonly config: VideoDecoderConfig;

  private constructor(input: Input<BlobSource>, sink: EncodedPacketSink, packets: EncodedPacket[],
    metadata: CodecPacketSourceMetadata, config: VideoDecoderConfig) {
    this.input = input; this.sink = sink; this.packets = packets;
    this.metadata = metadata; this.config = config;
    this.frameCount = packets.length;
    this.displayOrder = packets.map((_, i) => i).toSorted((a, b) => packets[a].timestamp - packets[b].timestamp || a - b);
    this.displayIndices = new Array(packets.length);
    this.displayOrder.forEach((stored, display) => {
      this.displayIndices[stored] = display;
      this.byTimestamp.set(packets[stored].microsecondTimestamp, display);
    });
    let key = 0;
    this.keyIndices = packets.map((packet, stored) => {
      if (packet.type === 'key') key = stored;
      return key;
    });
  }

  static async create(file: File): Promise<HevcPacketSource> {
    const input = new Input({ formats: [MP4, QTFF], source: new BlobSource(file, { maxCacheSize: 16 * 1024 * 1024 }) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || track.codec !== 'hevc') throw new Error('Die Quelle enthält kein HEVC-Video.');
      const config = await track.getDecoderConfig();
      if (!config) throw new Error('Die HEVC-Decoder-Konfiguration fehlt.');
      const sink = new EncodedPacketSink(track);
      const packets: EncodedPacket[] = [];
      for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) packets.push(packet);
      if (!packets.length || !packets.some(packet => packet.type === 'key')) throw new Error('HEVC enthält keine dekodierbaren Videopakete.');
      const duration = await track.computeDuration();
      const metadata = {
        duration, width: track.displayWidth, height: track.displayHeight,
        codedWidth: track.codedWidth, codedHeight: track.codedHeight,
        rotation: track.rotation, fps: duration > 0 ? packets.length / duration : 30,
      };
      return new HevcPacketSource(input, sink, packets, metadata, config);
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  displayToStoredIndex(index: number): number { return this.displayOrder[index] ?? -1; }
  storedToDisplayIndex(index: number): number { return this.displayIndices[index] ?? -1; }
  keyframeStoredIndexFor(display: number): number { return this.keyIndices[this.displayToStoredIndex(display)] ?? 0; }
  timestampToDisplayIndex(timestampUs: number): number { return this.byTimestamp.get(timestampUs) ?? -1; }

  private describe(stored: number, data: Uint8Array = new Uint8Array(0)): GopPacket | null {
    const packet = this.packets[stored];
    if (!packet || this.disposed) return null;
    const displayIndex = this.displayIndices[stored];
    const next = this.packets[this.displayOrder[displayIndex + 1]];
    const duration = next ? next.timestamp - packet.timestamp : Math.max(packet.duration, this.metadata.duration - packet.timestamp);
    return {
      data, storedIndex: stored, displayIndex, isKeyframe: packet.type === 'key',
      timestamp: packet.timestamp, duration,
      microsecondTimestamp: packet.microsecondTimestamp, microsecondDuration: Math.round(duration * 1e6),
    };
  }

  async getPacketAt(time: number): Promise<GopPacket | null> {
    if (!Number.isFinite(time) || this.disposed) return null;
    let lo = 0, hi = this.displayOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.packets[this.displayOrder[mid]].timestamp <= time + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return this.describe(this.displayOrder[Math.max(0, lo - 1)]);
  }

  async getNextPacket(packet: GopPacket): Promise<GopPacket | null> {
    let next = packet.displayIndex + 1;
    // Gleiche PTS gehören zur gleichen Anzeigezeit, nicht zu einem künstlichen fps-Raster.
    while (next < this.frameCount && this.packets[this.displayOrder[next]].timestamp <= packet.timestamp) next++;
    while (next + 1 < this.frameCount && this.packets[this.displayOrder[next + 1]].timestamp === this.packets[this.displayOrder[next]].timestamp) next++;
    return this.describe(this.displayOrder[next]);
  }

  async getPacketByStoredIndex(index: number): Promise<GopPacket | null> {
    if (this.disposed || index < 0 || index >= this.frameCount) return null;
    const packet = index === 0 ? await this.sink.getFirstPacket()
      : await this.sink.getNextPacket(this.packets[index - 1]);
    return packet ? this.describe(index, packet.data) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
  }
}
