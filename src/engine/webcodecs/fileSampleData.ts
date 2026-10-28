// Sample bytes of an MP4/MOV read from the file on demand instead of one whole-file ArrayBuffer.
// Chromium refuses Blob.arrayBuffer() for files of several GB ("NotReadableError ... could not be
// read"), and a phone recording easily exceeds that. FAST export therefore reads only the boxes it
// needs to parse (ftyp, moov) and fetches sample bytes window by window while the decoder
// consumes them; loaded bytes beyond a budget are dropped again, oldest first.

import type { Sample } from '../webCodecsTypes';

export interface Mp4TopLevelBox {
  type: string;
  start: number;
  size: number;
}

/** The file cannot be read on demand (fragmented, no moov, implausible box sizes). */
export class StreamedMp4UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamedMp4UnsupportedError';
  }
}

const BOX_HEADER_BYTES = 16;

/** Walks the top-level boxes by reading only their headers. */
export async function scanMp4TopLevelBoxes(file: Blob): Promise<Mp4TopLevelBox[]> {
  const boxes: Mp4TopLevelBox[] = [];
  let position = 0;
  while (position + 8 <= file.size) {
    const header = new DataView(
      await file.slice(position, Math.min(file.size, position + BOX_HEADER_BYTES)).arrayBuffer(),
    );
    const type = String.fromCharCode(header.getUint8(4), header.getUint8(5), header.getUint8(6), header.getUint8(7));
    let size = header.getUint32(0);
    if (size === 1) {
      if (header.byteLength < BOX_HEADER_BYTES) {
        throw new StreamedMp4UnsupportedError(`Truncated 64-bit "${type}" box header at byte ${position}`);
      }
      size = Number(header.getBigUint64(8));
    } else if (size === 0) {
      size = file.size - position;
    }
    if (size < 8) {
      throw new StreamedMp4UnsupportedError(`Invalid "${type}" box size ${size} at byte ${position}`);
    }
    // A recording that stopped early can end inside its last box; keep what is there.
    boxes.push({ type, start: position, size: Math.min(size, file.size - position) });
    position += size;
  }
  return boxes;
}

export interface FileSampleDataOptions {
  /** Loaded sample bytes kept before older samples are dropped again. */
  maxBufferedBytes?: number;
  /** Bytes read ahead of the requested window, so consecutive windows share one read. */
  readAheadBytes?: number;
  /** Largest single read inside a requested window. */
  maxReadBytes?: number;
  /** Bytes of other tracks between two samples that are still read in one go. */
  maxGapBytes?: number;
}

export const EMPTY_SAMPLE_DATA = new ArrayBuffer(0);
const MIB = 1024 * 1024;

function sampleOffset(sample: Sample): number {
  if (sample.offset === undefined) {
    throw new Error(`Sample ${sample.number} has no file offset and cannot be read on demand`);
  }
  return sample.offset;
}

export class FileSampleData {
  private readonly file: Blob;
  private readonly samples: Sample[];
  private readonly loaded = new Set<number>();
  private bufferedBytes = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly maxBufferedBytes: number;
  private readonly readAheadBytes: number;
  private readonly maxReadBytes: number;
  private readonly maxGapBytes: number;

  constructor(file: Blob, samples: Sample[], options: FileSampleDataOptions = {}) {
    this.file = file;
    this.samples = samples;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 256 * MIB;
    this.maxReadBytes = options.maxReadBytes ?? 32 * MIB;
    this.readAheadBytes = Math.min(options.readAheadBytes ?? 8 * MIB, this.maxReadBytes);
    this.maxGapBytes = options.maxGapBytes ?? MIB;
    for (const sample of samples) {
      sample.data = EMPTY_SAMPLE_DATA;
    }
  }

  get loadedBytes(): number {
    return this.bufferedBytes;
  }

  isLoaded(index: number): boolean {
    return this.loaded.has(index);
  }

  /** Loads the bytes of samples [startIndex, endIndexExclusive). Calls run one after another. */
  ensure(startIndex: number, endIndexExclusive: number): Promise<void> {
    const run = this.queue.then(() => this.load(startIndex, endIndexExclusive));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(startIndex: number, endIndexExclusive: number): Promise<void> {
    const from = Math.max(0, startIndex);
    const to = Math.min(this.samples.length, endIndexExclusive);
    let index = from;
    while (index < to) {
      if (this.loaded.has(index)) {
        index++;
        continue;
      }
      const members = [index];
      const groupStart = sampleOffset(this.samples[index]);
      let groupEnd = groupStart + this.samples[index].size;
      let next = index + 1;
      while (next < this.samples.length && !this.loaded.has(next)) {
        const nextStart = sampleOffset(this.samples[next]);
        const nextEnd = Math.max(groupEnd, nextStart + this.samples[next].size);
        const limit = next < to ? this.maxReadBytes : this.readAheadBytes;
        if (nextStart < groupStart || nextStart - groupEnd > this.maxGapBytes || nextEnd - groupStart > limit) {
          break;
        }
        members.push(next);
        groupEnd = nextEnd;
        next++;
      }
      await this.read(groupStart, groupEnd, members);
      index = next;
    }
    this.trim(from, to);
  }

  private async read(groupStart: number, groupEnd: number, members: number[]): Promise<void> {
    const bytes = await this.file.slice(groupStart, groupEnd).arrayBuffer();
    if (bytes.byteLength < groupEnd - groupStart) {
      throw new Error(`Source file ends at byte ${groupStart + bytes.byteLength}; samples need bytes up to ${groupEnd}`);
    }
    for (const member of members) {
      const sample = this.samples[member];
      const at = sampleOffset(sample) - groupStart;
      sample.data = bytes.slice(at, at + sample.size);
      this.loaded.add(member);
      this.bufferedBytes += sample.size;
    }
  }

  /** Over budget, drop samples before the window first, then the ones furthest ahead. */
  private trim(from: number, to: number): void {
    if (this.bufferedBytes <= this.maxBufferedBytes) return;
    const indices = [...this.loaded].toSorted((a, b) => a - b);
    for (const index of indices) {
      if (index >= from || this.bufferedBytes <= this.maxBufferedBytes) break;
      this.drop(index);
    }
    for (const index of indices.toReversed()) {
      if (index < to || this.bufferedBytes <= this.maxBufferedBytes) break;
      this.drop(index);
    }
  }

  private drop(index: number): void {
    const sample = this.samples[index];
    this.bufferedBytes -= sample.size;
    sample.data = EMPTY_SAMPLE_DATA;
    this.loaded.delete(index);
  }
}
