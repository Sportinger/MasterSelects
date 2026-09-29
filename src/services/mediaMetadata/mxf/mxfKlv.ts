// KLV primitives (SMPTE 336M): 16-byte keys with BER lengths.

export const KLV_KEY_SIZE = 16;

export function toHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  for (let i = start; i < end; i += 1) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

export function readU16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

export function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

export function readI32(b: Uint8Array, o: number): number {
  return (b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;
}

/** 64-bit big-endian as a JS number (safe below 2^53, ample for file offsets). */
export function readU64(b: Uint8Array, o: number): number {
  return readU32(b, o) * 0x1_0000_0000 + readU32(b, o + 4);
}

export interface KlvHeader {
  /** Hex of the 16-byte key. */
  key: string;
  /** Offset of the first value byte. */
  valueOffset: number;
  length: number;
  /** Offset of the byte after the value. */
  end: number;
}

/**
 * Parses key + BER length at `offset` inside `bytes` (which starts at
 * absolute `base`). Returns null when the buffer is too short.
 */
export function parseKlvHeader(bytes: Uint8Array, offset: number, base = 0): KlvHeader | null {
  if (offset + KLV_KEY_SIZE + 1 > bytes.length) return null;
  const first = bytes[offset + KLV_KEY_SIZE]!;
  let length: number;
  let lengthSize: number;
  if ((first & 0x80) === 0) {
    length = first;
    lengthSize = 1;
  } else {
    lengthSize = 1 + (first & 0x7f);
    if (lengthSize > 9 || offset + KLV_KEY_SIZE + lengthSize > bytes.length) return null;
    length = 0;
    for (let i = 1; i < lengthSize; i += 1) length = length * 256 + bytes[offset + KLV_KEY_SIZE + i]!;
  }
  const valueOffset = offset + KLV_KEY_SIZE + lengthSize;
  return {
    key: toHex(bytes, offset, offset + KLV_KEY_SIZE),
    valueOffset: base + valueOffset,
    length,
    end: base + valueOffset + length,
  };
}

// Keys (registry designator bytes 4-7 vary between files, so match by pattern).
const MXF_PREFIX = '060e2b34';

/** True for any MXF partition pack key (header/body/footer, open/closed). */
export function isPartitionPackKey(key: string): boolean {
  // 06.0e.2b.34.02.05.01.xx.0d.01.02.01.01.{02|03|04}.xx.00
  return key.startsWith(MXF_PREFIX)
    && key.slice(8, 12) === '0205'
    && key.slice(16, 26) === '0d01020101'
    && ['02', '03', '04'].includes(key.slice(26, 28));
}

export function partitionKind(key: string): 'header' | 'body' | 'footer' {
  const kind = key.slice(26, 28);
  return kind === '02' ? 'header' : kind === '03' ? 'body' : 'footer';
}

export function isFillKey(key: string): boolean {
  return key.startsWith(MXF_PREFIX) && key.slice(16, 32) === '0301021001000000';
}

export function isPrimerKey(key: string): boolean {
  return key.startsWith(MXF_PREFIX) && key.slice(16, 32) === '0d01020101050100';
}

export function isRandomIndexPackKey(key: string): boolean {
  return key.startsWith(MXF_PREFIX) && key.slice(16, 32) === '0d01020101110100';
}
