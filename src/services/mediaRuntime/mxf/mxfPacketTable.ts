// Edit-unit addressing for MXF essence: display order <-> stored (decode) order,
// stream offset -> file offset, and resolution of one edit unit to its picture
// element bytes. Handles VBE/CBE index tables, frame- and clip-wrapped essence,
// and a one-time KLV scan when a file has no usable index.

import type { MxfByteSource } from '../../mediaMetadata/mxf/mxfByteSource';
import type { MxfIndexSegment } from '../../mediaMetadata/mxf/mxfIndex';
import {
  isPartitionPackKey,
  isRandomIndexPackKey,
  parseKlvHeader,
} from '../../mediaMetadata/mxf/mxfKlv';
import type { MxfMetadata } from '../../mediaMetadata/mxf/mxfMetadata';

export interface MxfResolvedUnit {
  /** Stored (decode-order) position. */
  storedIndex: number;
  /** Display-order position (presentation timestamp in edit units). */
  displayIndex: number;
  /** File offset of the element KLV key; for clip-wrapped essence, of the unit's bytes. */
  position: number;
  valueOffset: number;
  size: number;
  isKeyframe: boolean;
}

const KLV_PROBE_SIZE = 32;
const MAX_ELEMENT_WALK = 64;
/** Essence element keys: 06.0e.2b.34.01.02.01.xx.0d.01.03.01 + 4-byte track number. */
function isEssenceElementKey(key: string): boolean {
  return key.startsWith('060e2b340102010') && key.slice(16, 24) === '0d010301';
}

function elementTrackNumber(key: string): number {
  return parseInt(key.slice(24, 32), 16) >>> 0;
}

export class MxfPacketTable {
  readonly frameCount: number;
  private readonly segments: MxfIndexSegment[];
  private readonly scannedUnits: { keyOffset: number; valueOffset: number; size: number }[] | null;
  private readonly clipValueOffset: number | null;
  private readonly clipValueEnd: number;
  private readonly storedToDisplay: Int32Array;
  private readonly displayToStored: Int32Array;
  private readonly resolved = new Map<number, MxfResolvedUnit>();
  private readonly source: MxfByteSource;
  private readonly meta: MxfMetadata;

  private constructor(
    source: MxfByteSource,
    meta: MxfMetadata,
    init: {
      frameCount: number;
      segments: MxfIndexSegment[];
      scannedUnits: { keyOffset: number; valueOffset: number; size: number }[] | null;
      clipValueOffset: number | null;
      clipValueEnd: number;
    },
  ) {
    this.source = source;
    this.meta = meta;
    this.frameCount = init.frameCount;
    this.segments = init.segments;
    this.scannedUnits = init.scannedUnits;
    this.clipValueOffset = init.clipValueOffset;
    this.clipValueEnd = init.clipValueEnd;
    this.storedToDisplay = new Int32Array(this.frameCount);
    this.displayToStored = new Int32Array(this.frameCount);
    for (let i = 0; i < this.frameCount; i += 1) {
      this.storedToDisplay[i] = i;
      this.displayToStored[i] = i;
    }
    // Index entry x carries the temporal offset of display unit x: it is stored at x + offset.
    for (let x = 0; x < this.frameCount; x += 1) {
      const stored = x + (this.entryAt(x)?.temporalOffset ?? 0);
      if (stored >= 0 && stored < this.frameCount) {
        this.storedToDisplay[stored] = x;
        this.displayToStored[x] = stored;
      }
    }
  }

  static async create(source: MxfByteSource, meta: MxfMetadata): Promise<MxfPacketTable> {
    const video = meta.video;
    if (!video) throw new Error('MXF file has no picture essence');
    const bodySid = meta.videoBodySid || meta.essencePartitions[0]?.bodySid || 0;
    const segments = meta.indexSegments
      .filter((s) => (meta.videoIndexSid ? s.indexSid === meta.videoIndexSid : true)
        && (s.bodySid === 0 || s.bodySid === bodySid))
      .toSorted((a, b) => a.startPosition - b.startPosition);
    const partitions = meta.essencePartitions
      .filter((p) => p.bodySid === bodySid)
      .toSorted((a, b) => a.bodyOffset - b.bodyOffset);
    if (partitions.length === 0) throw new Error('MXF file has no essence partition for the picture track');

    const first = await findFirstElement(source, partitions[0]!.essenceOffset, video.trackNumber);
    if (!first) throw new Error('MXF picture essence element not found');
    const frameCount = Math.max(1, meta.durationFrames);
    const essenceBytes = source.size - partitions[0]!.essenceOffset;
    // Clip wrapping: one KLV holds every edit unit. Label bytes are unreliable (FFmpeg OP-Atom
    // writes the frame-wrapped label), so decide from the element size: a clip-wrapped element
    // spans most of the essence, while a long-GOP I-frame is only a few times the average unit.
    const clipWrapped = frameCount > 1 && first.length > essenceBytes / 2;
    const hasIndex = segments.some((s) => s.editUnitByteCount > 0 || s.entries.length > 0);

    let scannedUnits: { keyOffset: number; valueOffset: number; size: number }[] | null = null;
    if (!hasIndex && !clipWrapped) {
      scannedUnits = await scanElements(source, partitions.map((p) => p.essenceOffset), video.trackNumber);
    } else if (!hasIndex) {
      throw new Error('Clip-wrapped MXF essence without an index table is not supported');
    }
    return new MxfPacketTable(source, meta, {
      frameCount: scannedUnits ? Math.max(1, scannedUnits.length) : frameCount,
      segments,
      scannedUnits,
      clipValueOffset: clipWrapped ? first.valueOffset : null,
      clipValueEnd: clipWrapped ? first.valueOffset + first.length : 0,
    });
  }

  get clipWrapped(): boolean {
    return this.clipValueOffset !== null;
  }

  displayToStoredIndex(displayIndex: number): number {
    return this.displayToStored[this.clampIndex(displayIndex)]!;
  }

  storedToDisplayIndex(storedIndex: number): number {
    return this.storedToDisplay[this.clampIndex(storedIndex)]!;
  }

  isKeyframe(storedIndex: number): boolean {
    if (this.scannedUnits) return this.meta.intraOnly !== false;
    const entry = this.entryAt(storedIndex);
    // CBE indexes have no entries and only describe intra-only essence.
    if (!entry) return true;
    return entry.keyFrameOffset === 0 && (entry.flags & 0x30) === 0;
  }

  /** Stored index of the closest key frame at or before `storedIndex`. */
  keyframeAtOrBefore(storedIndex: number): number {
    let i = this.clampIndex(storedIndex);
    const entry = this.entryAt(i);
    if (entry && entry.keyFrameOffset < 0) i = Math.max(0, i + entry.keyFrameOffset);
    while (i > 0 && !this.isKeyframe(i)) i -= 1;
    return i;
  }

  async resolve(storedIndex: number): Promise<MxfResolvedUnit> {
    const index = this.clampIndex(storedIndex);
    const cached = this.resolved.get(index);
    if (cached) return cached;
    const unit = await this.resolveUncached(index);
    this.resolved.set(index, unit);
    return unit;
  }

  private clampIndex(index: number): number {
    return Math.max(0, Math.min(this.frameCount - 1, Math.floor(index)));
  }

  private segmentFor(index: number): MxfIndexSegment | null {
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const segment = this.segments[i]!;
      if (index >= segment.startPosition) return segment;
    }
    return null;
  }

  private entryAt(index: number) {
    const segment = this.segmentFor(index);
    if (!segment || segment.entries.length === 0) return null;
    return segment.entries[index - segment.startPosition] ?? null;
  }

  private streamOffset(index: number): number {
    const segment = this.segmentFor(index);
    if (!segment) throw new Error(`No MXF index segment for edit unit ${index}`);
    if (segment.editUnitByteCount > 0) return index * segment.editUnitByteCount;
    const entry = segment.entries[index - segment.startPosition];
    if (!entry) throw new Error(`MXF index has no entry for edit unit ${index}`);
    return entry.streamOffset;
  }

  private fileOffsetForStream(streamOffset: number): number {
    const partitions = this.meta.essencePartitions
      .filter((p) => p.bodySid === (this.meta.videoBodySid || p.bodySid))
      .toSorted((a, b) => a.bodyOffset - b.bodyOffset);
    let match = partitions[0]!;
    for (const partition of partitions) {
      if (partition.bodyOffset <= streamOffset) match = partition;
    }
    return match.essenceOffset + (streamOffset - match.bodyOffset);
  }

  private async resolveUncached(index: number): Promise<MxfResolvedUnit> {
    const base = {
      storedIndex: index,
      displayIndex: this.storedToDisplay[index]!,
      isKeyframe: this.isKeyframe(index),
    };
    if (this.scannedUnits) {
      const unit = this.scannedUnits[index]!;
      return { ...base, position: unit.keyOffset, valueOffset: unit.valueOffset, size: unit.size };
    }
    if (this.clipValueOffset !== null) {
      const start = this.clipValueOffset + this.streamOffset(index);
      const end = index + 1 < this.frameCount
        ? this.clipValueOffset + this.streamOffset(index + 1)
        : this.clipValueEnd;
      return { ...base, position: start, valueOffset: start, size: Math.max(0, Math.min(end, this.clipValueEnd) - start) };
    }
    const element = await findFirstElement(
      this.source,
      this.fileOffsetForStream(this.streamOffset(index)),
      this.meta.video!.trackNumber,
    );
    if (!element) throw new Error(`MXF picture element for edit unit ${index} not found`);
    return { ...base, position: element.keyOffset, valueOffset: element.valueOffset, size: element.length };
  }
}

interface ElementLocation {
  keyOffset: number;
  valueOffset: number;
  length: number;
}

/** Walks KLVs from `offset` to the first essence element of the track (content packages are short). */
async function findFirstElement(
  source: MxfByteSource,
  offset: number,
  trackNumber: number,
): Promise<ElementLocation | null> {
  let at = offset;
  for (let n = 0; n < MAX_ELEMENT_WALK && at < source.size; n += 1) {
    const probe = await source.read(at, KLV_PROBE_SIZE);
    const klv = parseKlvHeader(probe, 0, at);
    if (!klv) return null;
    if (isPartitionPackKey(klv.key) || isRandomIndexPackKey(klv.key)) return null;
    if (isEssenceElementKey(klv.key) && (trackNumber === 0 || elementTrackNumber(klv.key) === trackNumber)) {
      return { keyOffset: at, valueOffset: klv.valueOffset, length: klv.length };
    }
    at = klv.end;
  }
  return null;
}

/** Index-less fallback: one pass over every essence partition, collecting frame-wrapped elements. */
async function scanElements(
  source: MxfByteSource,
  starts: number[],
  trackNumber: number,
): Promise<{ keyOffset: number; valueOffset: number; size: number }[]> {
  const units: { keyOffset: number; valueOffset: number; size: number }[] = [];
  for (const start of starts) {
    let at = start;
    while (at < source.size) {
      const probe = await source.read(at, KLV_PROBE_SIZE);
      const klv = parseKlvHeader(probe, 0, at);
      if (!klv || isPartitionPackKey(klv.key) || isRandomIndexPackKey(klv.key)) break;
      if (isEssenceElementKey(klv.key) && (trackNumber === 0 || elementTrackNumber(klv.key) === trackNumber)) {
        units.push({ keyOffset: at, valueOffset: klv.valueOffset, size: klv.length });
      }
      at = klv.end;
    }
  }
  return units;
}
