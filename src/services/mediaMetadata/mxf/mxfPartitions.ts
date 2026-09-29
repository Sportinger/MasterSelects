// Partition packs (SMPTE 377M §7) and the Random Index Pack.

import type { MxfByteSource } from './mxfByteSource';
import {
  KLV_KEY_SIZE,
  isPartitionPackKey,
  isRandomIndexPackKey,
  parseKlvHeader,
  partitionKind,
  readU32,
  readU64,
  toHex,
} from './mxfKlv';

export interface MxfPartition {
  kind: 'header' | 'body' | 'footer';
  /** Byte offset of the partition pack key. */
  offset: number;
  /** Offset of the first byte after the partition pack. */
  packEnd: number;
  closed: boolean;
  complete: boolean;
  kagSize: number;
  thisPartition: number;
  previousPartition: number;
  footerPartition: number;
  headerByteCount: number;
  indexByteCount: number;
  indexSid: number;
  bodyOffset: number;
  bodySid: number;
  /** Hex of the operational-pattern UL. */
  operationalPattern: string;
  essenceContainers: string[];
}

export interface MxfRandomIndexEntry {
  bodySid: number;
  byteOffset: number;
}

const PARTITION_READ_SIZE = 4096;

export async function readPartitionAt(source: MxfByteSource, offset: number): Promise<MxfPartition | null> {
  const bytes = await source.read(offset, PARTITION_READ_SIZE);
  const klv = parseKlvHeader(bytes, 0, offset);
  if (!klv || !isPartitionPackKey(klv.key)) return null;
  const v = klv.valueOffset - offset;
  if (klv.length < 88 || v + 88 > bytes.length) return null;
  const status = parseInt(klv.key.slice(28, 30), 16);
  const containerCount = readU32(bytes, v + 80);
  const containerSize = readU32(bytes, v + 84);
  const essenceContainers: string[] = [];
  for (let i = 0; i < containerCount && containerSize === 16; i += 1) {
    const at = v + 88 + i * 16;
    if (at + 16 > bytes.length) break;
    essenceContainers.push(toHex(bytes, at, at + 16));
  }
  return {
    kind: partitionKind(klv.key),
    offset,
    packEnd: klv.end,
    closed: status === 0x02 || status === 0x04,
    complete: status === 0x03 || status === 0x04,
    kagSize: readU32(bytes, v + 4),
    thisPartition: readU64(bytes, v + 8),
    previousPartition: readU64(bytes, v + 16),
    footerPartition: readU64(bytes, v + 24),
    headerByteCount: readU64(bytes, v + 32),
    indexByteCount: readU64(bytes, v + 40),
    indexSid: readU32(bytes, v + 48),
    bodyOffset: readU64(bytes, v + 52),
    bodySid: readU32(bytes, v + 60),
    operationalPattern: toHex(bytes, v + 64, v + 80),
    essenceContainers,
  };
}

/** Reads the Random Index Pack from the file tail; null if absent. */
export async function readRandomIndexPack(source: MxfByteSource): Promise<MxfRandomIndexEntry[] | null> {
  if (source.size < 4 + KLV_KEY_SIZE) return null;
  const tail = await source.read(source.size - 4, 4);
  const ripLength = readU32(tail, 0);
  if (ripLength < KLV_KEY_SIZE + 1 + 4 || ripLength > source.size || ripLength > 16 * 1024 * 1024) return null;
  const bytes = await source.read(source.size - ripLength, ripLength);
  const klv = parseKlvHeader(bytes, 0, source.size - ripLength);
  if (!klv || !isRandomIndexPackKey(klv.key)) return null;
  const entries: MxfRandomIndexEntry[] = [];
  const first = klv.valueOffset - (source.size - ripLength);
  const count = Math.floor((klv.length - 4) / 12);
  for (let i = 0; i < count; i += 1) {
    const at = first + i * 12;
    entries.push({ bodySid: readU32(bytes, at), byteOffset: readU64(bytes, at + 4) });
  }
  return entries;
}
