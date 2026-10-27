// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebCodecsExportMode, type ExportModePlayer } from '../../src/engine/WebCodecsExportMode';
import {
  FileSampleData,
  StreamedMp4UnsupportedError,
  scanMp4TopLevelBoxes,
} from '../../src/engine/webcodecs/fileSampleData';
import { loadMp4FileOnDemand, loadMp4ForWebCodecs } from '../../src/engine/webcodecs/mp4DemuxLoader';
import type { Sample } from '../../src/engine/webCodecsTypes';

function box(type: string, payloadBytes: number, size = 8 + payloadBytes): Uint8Array {
  const bytes = new Uint8Array(8 + payloadBytes);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set([...type].map((char) => char.charCodeAt(0)), 4);
  return bytes;
}

function largeBox(type: string, payloadBytes: number): Uint8Array {
  const bytes = new Uint8Array(16 + payloadBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1);
  bytes.set([...type].map((char) => char.charCodeAt(0)), 4);
  view.setBigUint64(8, BigInt(16 + payloadBytes));
  return bytes;
}

/** A Blob whose slice() calls are counted. */
function countedBlob(bytes: Uint8Array): { blob: Blob; reads: Array<[number, number]> } {
  const real = new Blob([bytes]);
  const reads: Array<[number, number]> = [];
  const blob = {
    size: real.size,
    slice: (start: number, end: number) => {
      reads.push([start, end]);
      return real.slice(start, end);
    },
  } as unknown as Blob;
  return { blob, reads };
}

/** Samples of `size` bytes each at the given offsets; byte value = sample index. */
function samplesAt(offsets: number[], size: number): { bytes: Uint8Array; samples: Sample[] } {
  const bytes = new Uint8Array(Math.max(...offsets) + size + 64);
  const samples = offsets.map((offset, index) => {
    bytes.fill(index, offset, offset + size);
    return {
      number: index, track_id: 1, data: new ArrayBuffer(0), size, cts: index, dts: index,
      duration: 1, is_sync: index % 10 === 0, timescale: 30, offset,
    };
  });
  return { bytes, samples };
}

const sampleByte = (sample: Sample) => new Uint8Array(sample.data)[0];

describe('scanMp4TopLevelBoxes', () => {
  it('walks 32-bit, 64-bit and to-end-of-file boxes without reading their payload', async () => {
    const parts = [box('ftyp', 8), largeBox('mdat', 40), box('moov', 24, 0)];
    const { blob, reads } = countedBlob(new Uint8Array(parts.flatMap((part) => [...part])));
    await expect(scanMp4TopLevelBoxes(blob)).resolves.toEqual([
      { type: 'ftyp', start: 0, size: 16 },
      { type: 'mdat', start: 16, size: 56 },
      { type: 'moov', start: 72, size: 32 },
    ]);
    expect(reads.every(([start, end]) => end - start <= 16)).toBe(true);
  });

  it('keeps a last box that a stopped recording cut short, and refuses impossible sizes', async () => {
    const truncated = [...box('ftyp', 8), ...box('mdat', 10, 4000)];
    await expect(scanMp4TopLevelBoxes(new Blob([new Uint8Array(truncated)]))).resolves.toEqual([
      { type: 'ftyp', start: 0, size: 16 },
      { type: 'mdat', start: 16, size: 18 },
    ]);
    const broken = box('ftyp', 8, 4);
    await expect(scanMp4TopLevelBoxes(new Blob([broken]))).rejects.toBeInstanceOf(StreamedMp4UnsupportedError);
  });
});

describe('FileSampleData', () => {
  it('reads a window in one coalesced read, reads ahead, and skips a large gap', async () => {
    // Samples 0-3 back to back, then 4 after small interleaved data, then 5 far away.
    const { bytes, samples } = samplesAt([0, 100, 200, 300, 450, 5000], 100);
    const { blob, reads } = countedBlob(bytes);
    const data = new FileSampleData(blob, samples, { maxGapBytes: 64, readAheadBytes: 400, maxReadBytes: 1000 });

    await data.ensure(0, 2);
    expect(reads).toEqual([[0, 400]]);
    expect(samples.slice(0, 4).map(sampleByte)).toEqual([0, 1, 2, 3]);
    expect(data.isLoaded(4)).toBe(false);

    await data.ensure(3, 6);
    expect(reads).toEqual([[0, 400], [450, 550], [5000, 5100]]);
    expect(samples.map(sampleByte)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(data.loadedBytes).toBe(600);
  });

  it('drops the oldest samples once over budget and keeps the requested window', async () => {
    const { bytes, samples } = samplesAt(Array.from({ length: 10 }, (_, index) => index * 100), 100);
    const data = new FileSampleData(new Blob([bytes]), samples, { maxBufferedBytes: 300, readAheadBytes: 100 });

    await data.ensure(0, 3);
    await data.ensure(5, 8);
    expect([5, 6, 7].every((index) => data.isLoaded(index))).toBe(true);
    expect([0, 1, 2].some((index) => data.isLoaded(index))).toBe(false);
    expect(samples[0].data.byteLength).toBe(0);
    expect(data.loadedBytes).toBeLessThanOrEqual(300);

    // A dropped sample is read again when it is needed again.
    await data.ensure(0, 1);
    expect(sampleByte(samples[0])).toBe(0);
  });

  it('serializes overlapping requests so every byte range is read once', async () => {
    const { bytes, samples } = samplesAt(Array.from({ length: 6 }, (_, index) => index * 100), 100);
    const { blob, reads } = countedBlob(bytes);
    const data = new FileSampleData(blob, samples, { readAheadBytes: 100 });
    await Promise.all([data.ensure(0, 4), data.ensure(2, 6)]);
    expect(reads).toEqual([[0, 400], [400, 600]]);
    expect(samples.map(sampleByte)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('fails clearly when the file ends before a sample', async () => {
    const { bytes, samples } = samplesAt([0, 100], 100);
    const data = new FileSampleData(new Blob([bytes.slice(0, 150)]), samples);
    await expect(data.ensure(0, 2)).rejects.toThrow(/Source file ends at byte 150/);
  });
});

describe('loadMp4FileOnDemand', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoDecoder', { isConfigSupported: async (config: VideoDecoderConfig) => ({ config, supported: true }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const callbacks = (onSamples: (samples: Sample[]) => void) => ({
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), time: () => vi.fn() },
    onMp4FileCreated: vi.fn(),
    onTrackReady: vi.fn(),
    onSamples,
    onConfigSupported: vi.fn(),
    onError: vi.fn(),
  });

  it('yields the same samples and bytes as the whole-file loader', async () => {
    const file = await readFile('public/masterselects_github.mp4');
    const whole: Sample[] = [];
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    await loadMp4ForWebCodecs(buffer, callbacks((samples) => whole.push(...samples)));

    const onDemand: Sample[] = [];
    const sampleData = await loadMp4FileOnDemand(new Blob([file]), callbacks((samples) => onDemand.push(...samples)));
    expect(onDemand.length).toBe(whole.length);
    // The first sample is there for decodeFirstFrame(); the rest is only read ahead (8 MiB).
    expect(sampleData.isLoaded(0)).toBe(true);
    expect(sampleData.loadedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);

    await sampleData.ensure(0, onDemand.length);
    for (let index = 0; index < whole.length; index++) {
      const expected = whole[index];
      const actual = onDemand[index];
      expect([actual.cts, actual.dts, actual.duration, actual.is_sync, actual.size, actual.timescale])
        .toEqual([expected.cts, expected.dts, expected.duration, expected.is_sync, expected.size, expected.timescale]);
      expect(Buffer.from(actual.data).equals(Buffer.from(expected.data))).toBe(true);
    }
  });

  it('refuses fragmented files, which keep their sample tables in moof boxes', async () => {
    const fragmented = new Blob([box('ftyp', 8), box('moov', 8), box('moof', 8), box('mdat', 8)]);
    await expect(loadMp4FileOnDemand(fragmented, callbacks(vi.fn()))).rejects.toBeInstanceOf(StreamedMp4UnsupportedError);
  });
});

describe('FAST export with sample bytes read on demand', () => {
  const decodedBytes: number[] = [];

  beforeEach(() => {
    decodedBytes.length = 0;
    (globalThis as Record<string, unknown>).EncodedVideoChunk = class {
      readonly timestamp: number;
      constructor(init: EncodedVideoChunkInit) {
        this.timestamp = init.timestamp;
        decodedBytes.push(new Uint8Array(init.data as ArrayBuffer)[0]);
      }
    };
  });

  it('feeds every window with its own bytes while older ones are dropped again', async () => {
    const { bytes, samples } = samplesAt(Array.from({ length: 120 }, (_, index) => index * 100), 100);
    const sampleData = new FileSampleData(new Blob([bytes]), samples, { maxBufferedBytes: 1500, readAheadBytes: 400 });
    let currentFrame: VideoFrame | null = null;
    const decoder = {
      state: 'configured',
      decodeQueueSize: 0,
      configure: vi.fn(),
      decode: vi.fn((chunk: { timestamp: number }) => {
        mode.handleDecoderOutput({ timestamp: chunk.timestamp, close: vi.fn() } as unknown as VideoFrame);
      }),
      flush: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    };
    const player: ExportModePlayer = {
      getDecoder: () => decoder as unknown as VideoDecoder,
      getSamples: () => samples,
      ensureSampleData: (start, end) => sampleData.ensure(start, end),
      getSampleIndex: () => 0,
      setSampleIndex: vi.fn(),
      getVideoTrackTimescale: () => 30,
      getCodecConfig: () => ({ codec: 'avc1.test' }),
      getFrameRate: () => 30,
      getCurrentFrame: () => currentFrame,
      setCurrentFrame: (frame) => {
        currentFrame = frame;
      },
      isSimpleMode: () => false,
      seekAsync: vi.fn(),
    };
    const mode = new WebCodecsExportMode(player);

    await mode.prepareForSequentialExport(0);
    for (let frame = 1; frame < 110; frame++) {
      await mode.seekDuringExport(frame / 30);
      expect(currentFrame?.timestamp).toBeCloseTo((frame / 30) * 1_000_000, -3);
    }

    // Every decoded chunk carried the bytes of its own sample, never an emptied buffer.
    expect(decodedBytes.length).toBeGreaterThanOrEqual(110);
    expect(decodedBytes.every((value, index) => value !== undefined && (index === 0 || value >= decodedBytes[index - 1]))).toBe(true);
    expect(sampleData.loadedBytes).toBeLessThanOrEqual(1500);
    expect(sampleData.isLoaded(0)).toBe(false);
  });
});
