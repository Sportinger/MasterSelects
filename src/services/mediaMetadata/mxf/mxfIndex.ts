// Index table segments (SMPTE 377M §11): edit unit -> stream offset, key frame and
// temporal reordering information.

import {
  TAG_INDEX,
  type MxfSet,
  propI64,
  propRational,
  propU32,
  propU8,
} from './mxfHeaderMetadata';
import { readU32, readU64 } from './mxfKlv';

export interface MxfDeltaEntry {
  posTableIndex: number;
  slice: number;
  elementDelta: number;
}

export interface MxfIndexEntry {
  /** Display-order offset of this edit unit relative to its decode position. */
  temporalOffset: number;
  /** Negative distance in edit units to the previous key frame (0 = this is one). */
  keyFrameOffset: number;
  flags: number;
  streamOffset: number;
  sliceOffsets: number[];
}

export interface MxfIndexSegment {
  indexSid: number;
  bodySid: number;
  editRate: { num: number; den: number };
  startPosition: number;
  duration: number;
  /** Constant bytes per edit unit (CBE); 0 for variable byte-per-edit-unit (VBE). */
  editUnitByteCount: number;
  sliceCount: number;
  deltaEntries: MxfDeltaEntry[];
  entries: MxfIndexEntry[];
}

const int8 = (v: number): number => (v > 127 ? v - 256 : v);

export function parseIndexSegment(set: MxfSet): MxfIndexSegment {
  const sliceCount = propU8(set, TAG_INDEX.sliceCount) ?? 0;
  const posTableCount = propU8(set, TAG_INDEX.posTableCount) ?? 0;
  const deltaEntries: MxfDeltaEntry[] = [];
  const deltas = set.props.get(TAG_INDEX.deltaEntryArray);
  if (deltas && deltas.length >= 8) {
    const count = readU32(deltas, 0);
    const size = readU32(deltas, 4);
    for (let i = 0; i < count && size >= 6 && 8 + (i + 1) * size <= deltas.length; i += 1) {
      const at = 8 + i * size;
      deltaEntries.push({
        posTableIndex: int8(deltas[at]!),
        slice: deltas[at + 1]!,
        elementDelta: readU32(deltas, at + 2),
      });
    }
  }
  const entries: MxfIndexEntry[] = [];
  const raw = set.props.get(TAG_INDEX.indexEntryArray);
  if (raw && raw.length >= 8) {
    const count = readU32(raw, 0);
    const size = readU32(raw, 4);
    const minSize = 11 + 4 * sliceCount + 8 * posTableCount;
    for (let i = 0; i < count && size >= minSize && 8 + (i + 1) * size <= raw.length; i += 1) {
      const at = 8 + i * size;
      const sliceOffsets: number[] = [];
      for (let s = 0; s < sliceCount; s += 1) sliceOffsets.push(readU32(raw, at + 11 + 4 * s));
      entries.push({
        temporalOffset: int8(raw[at]!),
        keyFrameOffset: int8(raw[at + 1]!),
        flags: raw[at + 2]!,
        streamOffset: readU64(raw, at + 3),
        sliceOffsets,
      });
    }
  }
  return {
    indexSid: propU32(set, TAG_INDEX.indexSid) ?? 0,
    bodySid: propU32(set, TAG_INDEX.bodySid) ?? 0,
    editRate: propRational(set, TAG_INDEX.indexEditRate) ?? { num: 0, den: 1 },
    startPosition: propI64(set, TAG_INDEX.indexStartPosition) ?? 0,
    duration: propI64(set, TAG_INDEX.indexDuration) ?? 0,
    editUnitByteCount: propU32(set, TAG_INDEX.editUnitByteCount) ?? 0,
    sliceCount,
    deltaEntries,
    entries,
  };
}

/**
 * True when every indexed edit unit is independently decodable. CBE indexes carry
 * no entries and only occur with intra-only essence.
 */
export function isIntraOnlyIndex(segments: readonly MxfIndexSegment[]): boolean | null {
  if (segments.length === 0) return null;
  let sawEntries = false;
  for (const segment of segments) {
    if (segment.entries.length === 0 && segment.editUnitByteCount > 0) continue;
    for (const entry of segment.entries) {
      sawEntries = true;
      if (entry.keyFrameOffset !== 0) return false;
    }
  }
  return sawEntries || segments.every((s) => s.editUnitByteCount > 0) ? true : null;
}
