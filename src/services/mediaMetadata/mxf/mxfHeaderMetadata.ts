// Header metadata (SMPTE 377M §9): primer pack + local sets keyed by instance UID.

import {
  readU16,
  readU32,
  toHex,
} from './mxfKlv';

/** Tags whose local-tag numbers are fixed by SMPTE 377M (no primer lookup needed). */
export const TAG = {
  instanceUid: 0x3c0a,
  // Preface / ContentStorage / packages
  contentStorage: 0x3b03,
  packages: 0x1901,
  packageUid: 0x4401,
  packageName: 0x4402,
  packageTracks: 0x4403,
  packageDescriptor: 0x4701,
  // Track / Sequence / components
  trackId: 0x4801,
  trackName: 0x4802,
  trackSequence: 0x4803,
  trackNumber: 0x4804,
  editRate: 0x4b01,
  origin: 0x4b02,
  dataDefinition: 0x0201,
  duration: 0x0202,
  structuralComponents: 0x1001,
  sourcePackageId: 0x1101,
  sourceTrackId: 0x1102,
  startPosition: 0x1201,
  // Timecode component
  startTimecode: 0x1501,
  roundedTimecodeBase: 0x1502,
  dropFrame: 0x1503,
  // File descriptor
  linkedTrackId: 0x3006,
  sampleRate: 0x3001,
  containerDuration: 0x3002,
  essenceContainer: 0x3004,
  codec: 0x3005,
  subDescriptors: 0x3f01,
  // Picture descriptor
  pictureCoding: 0x3201,
  storedHeight: 0x3202,
  storedWidth: 0x3203,
  sampledHeight: 0x3204,
  sampledWidth: 0x3205,
  displayHeight: 0x3208,
  displayWidth: 0x3209,
  displayYOffset: 0x320b,
  frameLayout: 0x320c,
  videoLineMap: 0x320d,
  aspectRatio: 0x320e,
  componentDepth: 0x3301,
  horizontalSubsampling: 0x3302,
  verticalSubsampling: 0x3308,
  // Sound descriptor
  audioSamplingRate: 0x3d03,
  locked: 0x3d02,
  channelCount: 0x3d07,
  quantizationBits: 0x3d01,
  soundCoding: 0x3d06,
  blockAlign: 0x3d0a,
} as const;

/** Index table segment tags (fixed local tags per SMPTE 377M §11.2). */
export const TAG_INDEX = {
  indexEditRate: 0x3f0b,
  indexStartPosition: 0x3f0c,
  indexDuration: 0x3f0d,
  editUnitByteCount: 0x3f05,
  indexSid: 0x3f06,
  bodySid: 0x3f07,
  sliceCount: 0x3f08,
  posTableCount: 0x3f0e,
  deltaEntryArray: 0x3f09,
  indexEntryArray: 0x3f0a,
} as const;

export interface MxfSet {
  /** Hex of the 16-byte set key. */
  key: string;
  /** Hex of the InstanceUID (empty when the set has none). */
  instanceUid: string;
  props: Map<number, Uint8Array>;
}

export interface MxfHeaderMetadata {
  sets: Map<string, MxfSet>;
  /** Local tag -> UL hex, from the primer pack. */
  primer: Map<number, string>;
}

export function parsePrimerValue(bytes: Uint8Array, valueOffset: number, into: Map<number, string>): void {
  const count = readU32(bytes, valueOffset);
  const itemSize = readU32(bytes, valueOffset + 4);
  for (let i = 0; i < count && itemSize === 18; i += 1) {
    const at = valueOffset + 8 + i * 18;
    into.set(readU16(bytes, at), toHex(bytes, at + 2, at + 18));
  }
}

/** Header-metadata set keys are 06.0e.2b.34.02.53.* (16-bit tag / 16-bit length local sets). */
export function isMetadataSetKey(key: string): boolean {
  return key.startsWith('060e2b34') && key.slice(8, 12) === '0253';
}

/** Index table segments are sets too (0d.01.02.01.01.10.01.00) but are not header metadata. */
export function isIndexSegmentKey(key: string): boolean {
  return isMetadataSetKey(key) && key.slice(16, 32) === '0d01020101100100';
}

export function parseLocalSet(key: string, bytes: Uint8Array, start: number, end: number): MxfSet {
  const props = new Map<number, Uint8Array>();
  let at = start;
  while (at + 4 <= end) {
    const tag = readU16(bytes, at);
    const len = readU16(bytes, at + 2);
    if (at + 4 + len > end) break;
    props.set(tag, bytes.subarray(at + 4, at + 4 + len));
    at += 4 + len;
  }
  const uid = props.get(TAG.instanceUid);
  const instanceUid = uid ? toHex(uid) : '';
  return { key, instanceUid, props };
}

export class MxfHeaderMetadataBuilder {
  readonly sets = new Map<string, MxfSet>();
  readonly primer = new Map<number, string>();

  addSet(set: MxfSet): void {
    this.sets.set(set.instanceUid, set);
  }

  build(): MxfHeaderMetadata {
    return { sets: this.sets, primer: this.primer };
  }
}

// --- typed property accessors -------------------------------------------------

export function propU32(set: MxfSet, tag: number): number | undefined {
  const v = set.props.get(tag);
  return v && v.length >= 4 ? readU32(v, 0) : undefined;
}

export function propU8(set: MxfSet, tag: number): number | undefined {
  const v = set.props.get(tag);
  return v && v.length >= 1 ? v[0] : undefined;
}

export function propU16(set: MxfSet, tag: number): number | undefined {
  const v = set.props.get(tag);
  return v && v.length >= 2 ? readU16(v, 0) : undefined;
}

export function propI64(set: MxfSet, tag: number): number | undefined {
  const v = set.props.get(tag);
  if (!v || v.length < 8) return undefined;
  const hi = (v[0]! << 24) | (v[1]! << 16) | (v[2]! << 8) | v[3]!; // signed high word
  return hi * 0x1_0000_0000 + readU32(v, 4);
}

/** Rational stored as two int32 (numerator, denominator). */
export function propRational(set: MxfSet, tag: number): { num: number; den: number } | undefined {
  const v = set.props.get(tag);
  if (!v || v.length < 8) return undefined;
  const num = (v[0]! << 24) | (v[1]! << 16) | (v[2]! << 8) | v[3]!;
  const den = (v[4]! << 24) | (v[5]! << 16) | (v[6]! << 8) | v[7]!;
  return { num, den };
}

export function propUl(set: MxfSet, tag: number): string | undefined {
  const v = set.props.get(tag);
  return v && v.length >= 16 ? toHex(v, 0, 16) : undefined;
}

/** Strong-ref vector / batch of 16-byte UIDs (8-byte header: count + item size). */
export function propRefBatch(set: MxfSet, tag: number): string[] {
  const v = set.props.get(tag);
  if (!v || v.length < 8) return [];
  const count = readU32(v, 0);
  const size = readU32(v, 4);
  if (size !== 16) return [];
  const out: string[] = [];
  for (let i = 0; i < count && 8 + (i + 1) * 16 <= v.length; i += 1) {
    out.push(toHex(v, 8 + i * 16, 8 + (i + 1) * 16));
  }
  return out;
}

export function propRef(set: MxfSet, tag: number): string | undefined {
  const v = set.props.get(tag);
  return v && v.length >= 16 ? toHex(v, 0, 16) : undefined;
}
