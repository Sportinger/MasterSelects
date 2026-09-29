// Public entry point: parses MXF partitions, header metadata and index tables
// into the media metadata MasterSelects needs at import (no essence decoding).

import type { MxfByteSource } from './mxfByteSource';
import { createCachedByteSource } from './mxfByteSource';
import {
  describeOperationalPattern,
  identifyMxfCodec,
  isD10EssenceContainer,
  type MxfCodecFamily,
  type MxfUnsupportedReason,
} from './mxfCodecIdentity';
import {
  TAG,
  propI64,
  propRational,
  propRef,
  propRefBatch,
  propU16,
  propU32,
  propU8,
  propUl,
  type MxfHeaderMetadata,
  type MxfSet,
} from './mxfHeaderMetadata';
import { isIntraOnlyIndex, type MxfIndexSegment } from './mxfIndex';
import { isPartitionPackKey, parseKlvHeader } from './mxfKlv';
import { readPartitionAt, readRandomIndexPack, type MxfPartition } from './mxfPartitions';
import { scanPartition } from './mxfScan';

export interface MxfRational {
  num: number;
  den: number;
}

export interface MxfVideoInfo {
  trackId: number;
  /** Track number of the file-package track; the last 4 bytes of its essence element keys. */
  trackNumber: number;
  family: MxfCodecFamily;
  /** Media codec id (ProRes FourCC or `mxf:*`), null when unsupported. */
  codecId: string | null;
  unsupportedReason?: MxfUnsupportedReason;
  pictureCodingUl: string;
  essenceContainerUl: string;
  /** Full-frame visible size (display rectangle; field layouts doubled in height). */
  width: number;
  height: number;
  /** Full-frame stored/coded size, e.g. 1088 for macroblock-aligned 1080 essence. */
  codedWidth: number;
  codedHeight: number;
  storedWidth: number;
  storedHeight: number;
  displayWidth: number;
  displayHeight: number;
  frameLayout: number;
  interlaced: boolean;
  topFieldFirst: boolean;
  editRate: MxfRational;
  fps: number;
  bitDepth: number;
  chroma: '4:2:0' | '4:2:2' | '4:4:4' | 'unknown';
  aspectRatio: MxfRational | null;
  avcProfileIdc?: number;
  avcLevelIdc?: number;
}

export interface MxfAudioInfo {
  trackId: number;
  channels: number;
  sampleRate: number;
  bitDepth: number;
  essenceContainerUl: string;
  /** Channels are AES3-wrapped inside the picture element (SMPTE 386M / D-10). */
  aes3InPicture: boolean;
}

export interface MxfTimecode {
  startFrame: number;
  base: number;
  dropFrame: boolean;
}

/** Where one partition's essence container data starts (first essence KLV). */
export interface MxfEssencePartition {
  partitionOffset: number;
  bodySid: number;
  bodyOffset: number;
  essenceOffset: number;
}

export interface MxfMetadata {
  operationalPattern: string;
  /** BodySID/IndexSID of the video essence container (EssenceContainerData), 0 when unknown. */
  videoBodySid: number;
  videoIndexSid: number;
  essencePartitions: readonly MxfEssencePartition[];
  video: MxfVideoInfo | null;
  audio: MxfAudioInfo[];
  timecode: MxfTimecode | null;
  /** Duration in edit units of the video track (or container duration). */
  durationFrames: number;
  durationSeconds: number;
  /** Whether every edit unit is a key frame; null when the index was not readable. */
  intraOnly: boolean | null;
  indexSegments: readonly MxfIndexSegment[];
  partitions: readonly MxfPartition[];
}

const SET_CLASS = {
  sourcePackage: '3700',
  materialPackage: '3600',
  timecode: '1400',
  track: '3b00',
  prefaceLast: '2f00',
  essenceContainerData: '2300',
  avcSubDescriptor: '6e00',
} as const;

const AVC_TAG = { profile: 0x8201, level: 0x8202 } as const;
const ESSENCE_CONTAINER_DATA_TAG = { linkedPackageUid: 0x2701, indexSid: 0x3f06, bodySid: 0x3f07 } as const;

/** Package UIDs are 32-byte UMIDs; compare the full value. */
function packageUidMatches(ecd: MxfSet, pkg: MxfSet): boolean {
  const a = ecd.props.get(ESSENCE_CONTAINER_DATA_TAG.linkedPackageUid);
  const b = pkg.props.get(TAG.packageUid);
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
const FIELD_DOMINANCE_TAG = 0x3212;

function setClass(set: MxfSet): string {
  return set.key.slice(28, 32);
}

function ratio(value: MxfRational | undefined): number {
  return value && value.den > 0 ? value.num / value.den : 0;
}

function setsOfClass(md: MxfHeaderMetadata, cls: string): MxfSet[] {
  return [...md.sets.values()].filter((s) => setClass(s) === cls);
}

/** Descriptor tree of a file source package: the descriptor itself plus its sub-descriptors. */
function collectDescriptors(md: MxfHeaderMetadata, rootUid: string): MxfSet[] {
  const out: MxfSet[] = [];
  const visit = (uid: string, depth: number): void => {
    const set = md.sets.get(uid);
    if (!set || depth > 4) return;
    out.push(set);
    for (const child of propRefBatch(set, TAG.subDescriptors)) visit(child, depth + 1);
  };
  visit(rootUid, 0);
  return out;
}

function chromaOf(h: number | undefined, v: number | undefined): MxfVideoInfo['chroma'] {
  if (h === 2 && v === 2) return '4:2:0';
  if (h === 2 && v === 1) return '4:2:2';
  if (h === 1 && v === 1) return '4:4:4';
  return 'unknown';
}

function buildVideoInfo(
  descriptor: MxfSet,
  descriptors: MxfSet[],
  intraOnly: boolean | null,
): MxfVideoInfo {
  const identity = identifyMxfCodec(propUl(descriptor, TAG.pictureCoding));
  const essenceContainerUl = propUl(descriptor, TAG.essenceContainer) ?? '';
  const storedWidth = propU32(descriptor, TAG.storedWidth) ?? 0;
  const storedHeight = propU32(descriptor, TAG.storedHeight) ?? 0;
  const displayWidth = propU32(descriptor, TAG.displayWidth) ?? storedWidth;
  const displayHeight = propU32(descriptor, TAG.displayHeight) ?? storedHeight;
  const frameLayout = propU8(descriptor, TAG.frameLayout) ?? 0;
  const interlaced = frameLayout === 1 || frameLayout === 3;
  const sampleRate = propRational(descriptor, TAG.sampleRate) ?? { num: 0, den: 1 };
  const dominance = propU8(descriptor, FIELD_DOMINANCE_TAG);
  const avc = descriptors.find((d) => setClass(d) === SET_CLASS.avcSubDescriptor);

  let codecId = identity.codecId;
  if (identity.family === 'mpeg2') {
    const intra = isD10EssenceContainer(essenceContainerUl) || intraOnly === true;
    codecId = intra ? 'mxf:mpeg2-intra' : 'mxf:mpeg2-lgop';
  } else if (identity.family === 'avc') {
    codecId = intraOnly === true ? 'mxf:avc-intra' : 'mxf:avc-lgop';
  }

  return {
    trackId: propU32(descriptor, TAG.linkedTrackId) ?? 0,
    trackNumber: 0,
    family: identity.family,
    codecId,
    ...(identity.unsupportedReason ? { unsupportedReason: identity.unsupportedReason } : {}),
    pictureCodingUl: propUl(descriptor, TAG.pictureCoding) ?? '',
    essenceContainerUl,
    width: displayWidth,
    height: displayHeight * (interlaced ? 2 : 1),
    codedWidth: storedWidth,
    codedHeight: storedHeight * (interlaced ? 2 : 1),
    storedWidth,
    storedHeight,
    displayWidth,
    displayHeight,
    frameLayout,
    interlaced,
    topFieldFirst: dominance !== 2,
    editRate: sampleRate,
    fps: ratio(sampleRate),
    bitDepth: propU32(descriptor, TAG.componentDepth) ?? 8,
    chroma: chromaOf(propU32(descriptor, TAG.horizontalSubsampling), propU32(descriptor, TAG.verticalSubsampling)),
    aspectRatio: propRational(descriptor, TAG.aspectRatio) ?? null,
    ...(avc ? { avcProfileIdc: propU8(avc, AVC_TAG.profile), avcLevelIdc: propU8(avc, AVC_TAG.level) } : {}),
  };
}

function buildAudioInfo(descriptor: MxfSet): MxfAudioInfo {
  const container = propUl(descriptor, TAG.essenceContainer) ?? '';
  return {
    trackId: propU32(descriptor, TAG.linkedTrackId) ?? 0,
    channels: propU32(descriptor, TAG.channelCount) ?? 0,
    sampleRate: ratio(propRational(descriptor, TAG.audioSamplingRate)),
    bitDepth: propU32(descriptor, TAG.quantizationBits) ?? 0,
    essenceContainerUl: container,
    aes3InPicture: isD10EssenceContainer(container),
  };
}

function findTimecode(md: MxfHeaderMetadata): MxfTimecode | null {
  const materialTracks = new Set(
    setsOfClass(md, SET_CLASS.materialPackage).flatMap((p) => propRefBatch(p, TAG.packageTracks)),
  );
  const candidates: { tc: MxfSet; fromMaterial: boolean }[] = [];
  for (const track of setsOfClass(md, SET_CLASS.track)) {
    const seqUid = propRef(track, TAG.trackSequence);
    const seq = seqUid ? md.sets.get(seqUid) : undefined;
    if (!seq) continue;
    for (const childUid of propRefBatch(seq, TAG.structuralComponents)) {
      const child = md.sets.get(childUid);
      if (child && setClass(child) === SET_CLASS.timecode) {
        candidates.push({ tc: child, fromMaterial: materialTracks.has(track.instanceUid) });
      }
    }
  }
  const pick = candidates.find((c) => c.fromMaterial) ?? candidates[0];
  if (!pick) return null;
  return {
    startFrame: propI64(pick.tc, TAG.startTimecode) ?? 0,
    base: propU16(pick.tc, TAG.roundedTimecodeBase) ?? 0,
    dropFrame: (propU8(pick.tc, TAG.dropFrame) ?? 0) !== 0,
  };
}

function findTrack(md: MxfHeaderMetadata, packageSet: MxfSet, trackId: number): MxfSet | null {
  for (const trackUid of propRefBatch(packageSet, TAG.packageTracks)) {
    const track = md.sets.get(trackUid);
    if (track && propU32(track, TAG.trackId) === trackId) return track;
  }
  return null;
}

function trackDuration(md: MxfHeaderMetadata, packageSet: MxfSet, trackId: number): number | null {
  for (const trackUid of propRefBatch(packageSet, TAG.packageTracks)) {
    const track = md.sets.get(trackUid);
    if (!track || propU32(track, TAG.trackId) !== trackId) continue;
    const seqUid = propRef(track, TAG.trackSequence);
    const seq = seqUid ? md.sets.get(seqUid) : undefined;
    const duration = seq ? propI64(seq, TAG.duration) : undefined;
    if (duration !== undefined && duration > 0) return duration;
  }
  return null;
}

async function readPartitionList(source: MxfByteSource, header: MxfPartition): Promise<MxfPartition[]> {
  const partitions: MxfPartition[] = [header];
  const seen = new Set<number>([header.offset]);
  const offsets: number[] = [];
  const rip = await readRandomIndexPack(source);
  if (rip) offsets.push(...rip.map((e) => e.byteOffset));
  if (header.footerPartition > 0) offsets.push(header.footerPartition);
  for (const offset of offsets) {
    if (seen.has(offset) || offset >= source.size) continue;
    seen.add(offset);
    const partition = await readPartitionAt(source, offset);
    if (partition) partitions.push(partition);
  }
  return partitions.toSorted((a, b) => a.offset - b.offset);
}

export class MxfParseError extends Error {}

/** Sniffs a partition pack key at byte 0 (the optional run-in before it is not supported). */
export async function isMxfSource(source: MxfByteSource): Promise<boolean> {
  const bytes = await source.read(0, 32);
  const klv = parseKlvHeader(bytes, 0);
  return !!klv && isPartitionPackKey(klv.key);
}

export async function readMxfMetadata(rawSource: MxfByteSource): Promise<MxfMetadata> {
  const source = createCachedByteSource(rawSource);
  const header = await readPartitionAt(source, 0);
  if (!header || header.kind !== 'header') throw new MxfParseError('Not an MXF file (no header partition)');
  const partitions = await readPartitionList(source, header);

  let metadata: MxfHeaderMetadata | null = null;
  const indexSegments: MxfIndexSegment[] = [];
  const essencePartitions: MxfEssencePartition[] = [];
  for (const partition of partitions) {
    const scan = await scanPartition(source, partition);
    indexSegments.push(...scan.indexSegments);
    if (partition.bodySid > 0) {
      essencePartitions.push({
        partitionOffset: partition.offset,
        bodySid: partition.bodySid,
        bodyOffset: partition.bodyOffset,
        essenceOffset: scan.endOffset,
      });
    }
    const hasPreface = [...scan.metadata.sets.values()].some((s) => setClass(s) === SET_CLASS.prefaceLast);
    // The header copy is preferred; the footer only fills in for open/incomplete headers.
    if (hasPreface && !metadata) metadata = scan.metadata;
  }
  if (!metadata) throw new MxfParseError('MXF header metadata not found');

  const md = metadata;
  const intraOnly = isIntraOnlyIndex(indexSegments);
  const filePackages = setsOfClass(md, SET_CLASS.sourcePackage).filter((p) => propRef(p, TAG.packageDescriptor));

  let video: MxfVideoInfo | null = null;
  const audio: MxfAudioInfo[] = [];
  let durationFrames = 0;
  let videoBodySid = 0;
  let videoIndexSid = 0;
  for (const pkg of filePackages) {
    const descriptors = collectDescriptors(md, propRef(pkg, TAG.packageDescriptor)!);
    for (const descriptor of descriptors) {
      if (propU32(descriptor, TAG.storedWidth) !== undefined && !video) {
        video = buildVideoInfo(descriptor, descriptors, intraOnly);
        const track = findTrack(md, pkg, video.trackId);
        video.trackNumber = track ? propU32(track, TAG.trackNumber) ?? 0 : 0;
        durationFrames = trackDuration(md, pkg, video.trackId) ?? propI64(descriptor, TAG.containerDuration) ?? 0;
        const containerData = setsOfClass(md, SET_CLASS.essenceContainerData)
          .find((ecd) => packageUidMatches(ecd, pkg));
        videoBodySid = containerData ? propU32(containerData, ESSENCE_CONTAINER_DATA_TAG.bodySid) ?? 0 : 0;
        videoIndexSid = containerData ? propU32(containerData, ESSENCE_CONTAINER_DATA_TAG.indexSid) ?? 0 : 0;
      } else if (propU32(descriptor, TAG.channelCount) !== undefined) {
        audio.push(buildAudioInfo(descriptor));
      }
    }
  }
  const fps = video?.fps ?? 0;
  return {
    operationalPattern: describeOperationalPattern(header.operationalPattern),
    videoBodySid,
    videoIndexSid,
    essencePartitions,
    video,
    audio,
    timecode: findTimecode(md),
    durationFrames,
    durationSeconds: fps > 0 ? durationFrames / fps : 0,
    intraOnly,
    indexSegments,
    partitions,
  };
}
