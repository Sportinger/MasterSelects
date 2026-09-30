// File-backed MXF packet reader. Implements the codec packet-reader contract
// (getPacketAt / getNextPacket / dispose) so codec providers consume MXF the
// same way they consume MOV/MP4 via Mediabunny. Offsets are cached per session
// inside this object only, never in stores.

import {
  createCachedByteSource,
  createFileByteSource,
  type MxfByteSource,
} from '../../mediaMetadata/mxf/mxfByteSource';
import { readMxfMetadata, type MxfMetadata } from '../../mediaMetadata/mxf/mxfMetadata';
import type { CodecPacket, CodecPacketSourceMetadata } from '../codec/CodecFrameProviderBase';
import { MxfPacketTable, type MxfPictureRead } from './mxfPacketTable';

/**
 * Sequential access (playback, export, GOP decoding, PCM) reads runs of
 * consecutive content packages with one request each. Every File slice read
 * has a fixed browser cost of several milliseconds; per-frame reads of 4K Long
 * GOP left the decoder waiting on disk.
 */
const RUN_MAX_UNITS = 24;
const RUN_MAX_BYTES = 12 * 1024 * 1024;
/** Runs kept at once: the one being consumed and the prefetched next one. */
const MAX_RUNS = 2;

interface PendingRun {
  from: number;
  to: number;
  /** Null when the run read failed or was unusable; units then fall back to single reads. */
  units: Promise<MxfPictureRead[] | null>;
}

export interface MxfPacket extends CodecPacket {
  readonly isKeyframe: boolean;
  /** Stored (decode-order) edit unit. */
  readonly storedIndex: number;
  /** Display-order edit unit. */
  readonly displayIndex: number;
}

export interface MxfPacketSourceMetadata extends CodecPacketSourceMetadata {
  codecId: string;
}

const metadataCache = new WeakMap<Blob, Promise<MxfMetadata>>();
const EMPTY_PACKET_DATA = new Uint8Array(0);

function readMetadataCached(source: MxfByteSource, cacheKey: Blob | undefined): Promise<MxfMetadata> {
  if (!cacheKey) return readMxfMetadata(source);
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;
  const promise = readMxfMetadata(source);
  metadataCache.set(cacheKey, promise);
  promise.catch(() => metadataCache.delete(cacheKey));
  return promise;
}

export class MxfPacketSource {
  readonly metadata: MxfPacketSourceMetadata;
  readonly mxf: MxfMetadata;
  private readonly source: MxfByteSource;
  private readonly table: MxfPacketTable;
  private disposed = false;
  private lastReadIndex = -2;
  private runs: PendingRun[] = [];
  private runReads = 0;
  private singleReads = 0;

  private constructor(source: MxfByteSource, table: MxfPacketTable, mxf: MxfMetadata) {
    this.source = source;
    this.table = table;
    this.mxf = mxf;
    const video = mxf.video!;
    this.metadata = {
      codecId: video.codecId ?? '',
      duration: table.frameCount / (video.fps || 25),
      width: video.width,
      height: video.height,
      codedWidth: video.codedWidth,
      codedHeight: video.codedHeight,
      rotation: 0,
      fps: video.fps,
    };
  }

  static async create(file: Blob, expectedCodecId?: string): Promise<MxfPacketSource> {
    return MxfPacketSource.createFromSource(createFileByteSource(file), expectedCodecId, file);
  }

  /**
   * @param cacheKey Parsed metadata is shared per file for the session (several providers
   *   open the same camera file: preview, source monitor, thumbnails, proxy).
   */
  static async createFromSource(raw: MxfByteSource, expectedCodecId?: string, cacheKey?: Blob): Promise<MxfPacketSource> {
    const source = createCachedByteSource(raw, 64 * 1024);
    const mxf = await readMetadataCached(source, cacheKey);
    const video = mxf.video;
    if (!video?.codecId) {
      throw new Error('MXF file has no supported picture essence');
    }
    if (expectedCodecId && video.codecId !== expectedCodecId) {
      throw new Error(`MXF picture essence is ${video.codecId}, expected ${expectedCodecId}`);
    }
    if (!(video.fps > 0) || video.width <= 0 || video.height <= 0) {
      throw new Error('MXF picture descriptor has no usable size or edit rate');
    }
    const table = await MxfPacketTable.create(source, mxf);
    return new MxfPacketSource(raw, table, mxf);
  }

  get frameCount(): number {
    return this.table.frameCount;
  }

  /** Packet whose display interval contains `timeSeconds` (clamped to the media range). */
  async getPacketAt(timeSeconds: number): Promise<MxfPacket | null> {
    if (this.disposed || !Number.isFinite(timeSeconds)) return null;
    const displayIndex = Math.floor(Math.max(0, timeSeconds) * this.metadata.fps + 1e-6);
    return this.getPacketByStoredIndex(this.table.displayToStoredIndex(displayIndex));
  }

  /** Next packet in display order (intra essence: identical to stored order). */
  async getNextPacket(packet: MxfPacket): Promise<MxfPacket | null> {
    if (this.disposed) return null;
    const next = packet.displayIndex + 1;
    if (next >= this.table.frameCount) return null;
    return this.getPacketByStoredIndex(this.table.displayToStoredIndex(next));
  }

  displayToStoredIndex(displayIndex: number): number {
    return this.table.displayToStoredIndex(displayIndex);
  }

  /**
   * Timing-only packet (empty data) for the display unit containing `timeSeconds`.
   * Lets a provider drive request timing on the main thread while a decode worker
   * owns the file reads.
   */
  describePacketAt(timeSeconds: number): MxfPacket | null {
    if (this.disposed || !Number.isFinite(timeSeconds)) return null;
    const displayIndex = Math.floor(Math.max(0, timeSeconds) * this.metadata.fps + 1e-6);
    return this.describeDisplayUnit(displayIndex);
  }

  describeNextPacket(packet: MxfPacket): MxfPacket | null {
    if (this.disposed || packet.displayIndex + 1 >= this.table.frameCount) return null;
    return this.describeDisplayUnit(packet.displayIndex + 1);
  }

  private describeDisplayUnit(displayIndex: number): MxfPacket {
    const clamped = Math.max(0, Math.min(this.table.frameCount - 1, displayIndex));
    const storedIndex = this.table.displayToStoredIndex(clamped);
    const frameDuration = 1 / this.metadata.fps;
    const timestamp = clamped * frameDuration;
    return {
      data: EMPTY_PACKET_DATA,
      timestamp,
      duration: frameDuration,
      microsecondTimestamp: Math.round(timestamp * 1e6),
      microsecondDuration: Math.round(frameDuration * 1e6),
      isKeyframe: this.table.isKeyframe(storedIndex),
      storedIndex,
      displayIndex: clamped,
    };
  }

  storedToDisplayIndex(storedIndex: number): number {
    return this.table.storedToDisplayIndex(storedIndex);
  }

  /** Stored index of the key frame to start decoding from for `displayIndex`. */
  keyframeStoredIndexFor(displayIndex: number): number {
    return this.table.keyframeAtOrBefore(this.table.displayToStoredIndex(displayIndex));
  }

  /** Read counters (diagnostics): run reads cover many edit units, single reads one. */
  get readStats(): { runReads: number; singleReads: number } {
    return { runReads: this.runReads, singleReads: this.singleReads };
  }

  async getPacketByStoredIndex(storedIndex: number): Promise<MxfPacket | null> {
    if (this.disposed) return null;
    const index = Math.max(0, Math.min(this.table.frameCount - 1, Math.floor(storedIndex)));
    const sequential = index === this.lastReadIndex + 1;
    this.lastReadIndex = index;
    const { unit, data } = await this.readPicture(index, sequential);
    if (data.length !== unit.size) throw new Error(`MXF edit unit ${storedIndex} is truncated`);
    const frameDuration = 1 / this.metadata.fps;
    const timestamp = unit.displayIndex * frameDuration;
    return {
      data,
      timestamp,
      duration: frameDuration,
      microsecondTimestamp: Math.round(timestamp * 1e6),
      microsecondDuration: Math.round(frameDuration * 1e6),
      isKeyframe: unit.isKeyframe,
      storedIndex: unit.storedIndex,
      displayIndex: unit.displayIndex,
    };
  }

  /** Position/size/keyframe of a stored unit without reading its bytes (tests, diagnostics). */
  describeStoredUnit(storedIndex: number) {
    return this.table.resolve(storedIndex);
  }

  /** See MxfPacketTable.contentPackageSpan (used by the PCM reader). */
  contentPackageSpan(storedIndex: number) {
    return this.table.contentPackageSpan(storedIndex);
  }

  /** Raw byte read for callers that parse essence themselves (PCM). */
  readBytes(offset: number, length: number): Promise<Uint8Array> {
    return this.source.read(offset, length);
  }

  /**
   * Random access (a seek, a thumbnail) reads the one package it needs. The
   * first sequential step starts a run; the next run is prefetched once half of
   * the current one is consumed, so forward decoding never waits on a read.
   */
  private async readPicture(index: number, sequential: boolean): Promise<MxfPictureRead> {
    this.runs = this.runs.filter((run) => run.to > index);
    let run = this.runs.find((candidate) => index >= candidate.from && index < candidate.to);
    if (!run && sequential) run = this.startRun(index) ?? undefined;
    if (!run) return this.readUnit(index);
    if (index - run.from >= (run.to - run.from) / 2 && run.to < this.table.frameCount
      && !this.runs.some((candidate) => candidate.from === run!.to)) {
      this.startRun(run.to);
    }
    const units = await run.units;
    return units?.[index - run.from] ?? this.readUnit(index);
  }

  private startRun(from: number): PendingRun | null {
    const plan = this.table.planRun(from, RUN_MAX_UNITS, RUN_MAX_BYTES);
    if (!plan) return null;
    this.runReads += 1;
    const units = this.table.readRun(plan, (offset, length) => this.source.read(offset, length))
      .then((read) => (read.length > 0 ? read : null), () => null);
    const run: PendingRun = { from: plan.from, to: plan.to, units };
    this.runs = [...this.runs, run].slice(-MAX_RUNS);
    return run;
  }

  private readUnit(index: number): Promise<MxfPictureRead> {
    this.singleReads += 1;
    return this.table.readPictureElement(index, (offset, length) => this.source.read(offset, length));
  }

  dispose(): void {
    this.disposed = true;
    this.runs = [];
  }
}
