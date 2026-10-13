import type { CodecPacket, CodecPacketSourceMetadata } from './CodecFrameProviderBase';

/** Paketidentität bleibt auch bei variablen Bildraten und B-Frames erhalten. */
export interface GopPacket extends CodecPacket {
  readonly isKeyframe: boolean;
  readonly storedIndex: number;
  readonly displayIndex: number;
}

export interface GopPacketSource {
  readonly metadata: CodecPacketSourceMetadata;
  readonly frameCount: number;
  readonly readStats?: { runReads?: number; singleReads?: number };
  displayToStoredIndex(displayIndex: number): number;
  storedToDisplayIndex(storedIndex: number): number;
  keyframeStoredIndexFor(displayIndex: number): number;
  timestampToDisplayIndex?(timestampUs: number): number;
  getPacketByStoredIndex(index: number): Promise<GopPacket | null>;
}
