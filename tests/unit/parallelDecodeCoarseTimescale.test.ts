import { describe, expect, it, vi } from 'vitest';
import {
  derivePresentationGrid,
  findContainingSortedTimestamp,
} from '../../src/engine/parallelDecode/presentationFrame';
import { findSampleIndexForSourceTime } from '../../src/engine/parallelDecode/scheduling';
import {
  getExpectedFrameTimestampUs,
  getResumeSampleIndexAfterReset,
  selectEvictionTimestamp,
  type ClipDecoder,
} from '../../src/engine/parallelDecode/clipDecoderState';
import { getNormalizedSampleTimestampMicroseconds } from '../../src/engine/parallelDecode/sampleTiming';
import {
  waitForExactBufferedFrame,
  type ParallelDecodePrefetchDeps,
} from '../../src/engine/parallelDecode/prefetchCoordinator';
import { findClosestSampleIndex } from '../../src/engine/webCodecsExport/exportSamplePlanning';
import type { Sample } from '../../src/engine/webCodecsTypes';
import { BACKWARD_FRAME_EPSILON } from '../../src/services/timeline/retime/clipRetime';

type Rounding = 'round' | 'floor';

/** A constant-rate track as a muxer stores it: frame k at round(k / fps) on the container tick. */
function track(fps: number, timescale: number, frames: number, rounding: Rounding = 'round'): Sample[] {
  return Array.from({ length: frames }, (_, k) => {
    const exact = (k * timescale) / fps;
    const cts = rounding === 'round' ? Math.round(exact) : Math.floor(exact);
    const next = rounding === 'round' ? Math.round(((k + 1) * timescale) / fps) : Math.floor(((k + 1) * timescale) / fps);
    return {
      number: k, track_id: 1, data: new ArrayBuffer(0), size: 0,
      cts, dts: cts, duration: next - cts, is_sync: k % 30 === 0, timescale,
    };
  });
}

function decoderFor(samples: Sample[], overrides: Partial<ClipDecoder> = {}): ClipDecoder {
  return {
    clipId: 'clip', clipName: 'Clip', samples, presentationOffsetSeconds: 0, sampleIndex: 0,
    frameBuffer: new Map(), sortedTimestamps: [], oldestTimestamp: Infinity, newestTimestamp: -Infinity,
    isDecoding: false, pendingDecode: null, decoder: null, needsKeyframe: true,
    ...overrides,
  } as unknown as ClipDecoder;
}

const CASES: Array<{ timescale: number; fps: number }> = [
  { timescale: 15_360, fps: 30 },
  { timescale: 15_360, fps: 30_000 / 1001 },
  { timescale: 1000, fps: 30 },
  { timescale: 1000, fps: 24 },
  { timescale: 1000, fps: 60 },
  { timescale: 1000, fps: 30_000 / 1001 },
  { timescale: 600, fps: 30 },
  { timescale: 600, fps: 30_000 / 1001 },
  { timescale: 600, fps: 24_000 / 1001 },
  { timescale: 90_000, fps: 30_000 / 1001 },
  { timescale: 90_000, fps: 60 },
];

describe('presentation-frame selection on coarse container timescales', () => {
  for (const { timescale, fps } of CASES) {
    for (const rounding of ['round', 'floor'] as const) {
      it(`selects frame N forward and N-1 reversed at ${fps.toFixed(3)} fps, timescale ${timescale} (${rounding})`, () => {
        const frames = 150;
        const samples = track(fps, timescale, frames, rounding);
        const decoder = decoderFor(samples);
        const expectedTs = (index: number) => getNormalizedSampleTimestampMicroseconds(samples[index], 0);
        for (let n = 0; n < frames; n++) {
          // Forward: export frame n asks for exactly n / fps.
          const forward = n / fps;
          expect(findSampleIndexForSourceTime(samples, forward, 0)).toBe(n);
          expect(findClosestSampleIndex(samples, forward, 0)).toBe(n);
          expect(getExpectedFrameTimestampUs(decoder, forward)).toBe(expectedTs(n));
          if (n === 0) continue;
          // Reverse: videoFrameSourceTime() asks 10 us left of the boundary of frame n.
          const reverse = n / fps - BACKWARD_FRAME_EPSILON;
          expect(findSampleIndexForSourceTime(samples, reverse, 0)).toBe(n - 1);
          expect(findClosestSampleIndex(samples, reverse, 0)).toBe(n - 1);
          expect(getExpectedFrameTimestampUs(decoder, reverse)).toBe(expectedTs(n - 1));
        }
      });
    }
  }

  it('reproduces the reviewer case: 30 fps at 1/1000 no longer repeats every third frame', () => {
    const samples = track(30, 1000, 10);
    expect(samples.map(sample => sample.cts)).toEqual([0, 33, 67, 100, 133, 167, 200, 233, 267, 300]);
    expect(Array.from({ length: 10 }, (_, n) => findClosestSampleIndex(samples, n / 30, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(findClosestSampleIndex(samples, 1 / 30 - BACKWARD_FRAME_EPSILON, 0)).toBe(0);
  });

  it('keeps the grid through B-frame decode order and dropped frames', () => {
    const samples = track(30, 1000, 60).filter(sample => sample.number !== 20);
    // I P B B decode order within each group of four.
    const decodeOrder = samples.flatMap((_, index) => (index % 4 === 0 ? [index, index + 3, index + 1, index + 2] : []))
      .filter(index => index < samples.length).map(index => samples[index]);
    const shownAt = (time: number) => decodeOrder[findSampleIndexForSourceTime(decodeOrder, time, 0)].number;
    expect(shownAt(2 / 30)).toBe(2);
    expect(shownAt(41 / 30 - BACKWARD_FRAME_EPSILON)).toBe(40);
    expect(shownAt(19 / 30)).toBe(19);
  });

  it('derives no grid for jittery VFR media, which keeps the plain half-open rule', () => {
    const vfr = [0, 31_000, 70_000, 99_000, 141_000, 160_000, 205_000];
    expect(derivePresentationGrid(vfr, 1000)).toBeNull();
    expect(findContainingSortedTimestamp(vfr, 69_990)).toBe(31_000);
    expect(findContainingSortedTimestamp(vfr, 70_000)).toBe(70_000);
  });

  it('snaps to the exact rate so the 10 us reverse margin holds after thousands of frames', () => {
    const samples = track(30_000 / 1001, 1000, 4000);
    const timestamps = samples.map(sample => getNormalizedSampleTimestampMicroseconds(sample, 0));
    const grid = derivePresentationGrid(timestamps, 1000);
    expect(grid?.frameDurationUs).toBeCloseTo(1_001_000 / 30, 6);
    const n = 3999;
    expect(findSampleIndexForSourceTime(samples, (n * 1001) / 30_000, 0)).toBe(n);
    expect(findSampleIndexForSourceTime(samples, (n * 1001) / 30_000 - BACKWARD_FRAME_EPSILON, 0)).toBe(n - 1);
  });
});

describe('parallel decode buffer bookkeeping', () => {
  it('resumes after a reset with a binary search over presentation order (B-frames, duplicates)', () => {
    const samples = track(30, 15_360, 8);
    const decodeOrder = [samples[0], samples[3], samples[1], samples[2], samples[4], samples[7], samples[5], samples[6]];
    const ts = (index: number) => getNormalizedSampleTimestampMicroseconds(samples[index], 0);
    expect(getResumeSampleIndexAfterReset(decoderFor(decodeOrder, { newestTimestamp: ts(2) }))).toBe(1); // samples[3] sits at decode index 1
    expect(getResumeSampleIndexAfterReset(decoderFor(decodeOrder, { newestTimestamp: ts(4) }))).toBe(6); // samples[5]
    expect(getResumeSampleIndexAfterReset(decoderFor(decodeOrder, { newestTimestamp: ts(7) }))).toBe(8);
    expect(getResumeSampleIndexAfterReset(decoderFor(decodeOrder, { newestTimestamp: -Infinity }))).toBe(0);
    expect(getResumeSampleIndexAfterReset(decoderFor(decodeOrder, { newestTimestamp: ts(0) + 1 }))).toBe(2);
  });

  it('evicts the end farthest from the target for a reversed clip, never the frame that just arrived', () => {
    // Long GOP: decoding runs forward from the keyframe at 0 towards the target at 12 s.
    const sortedTimestamps = Array.from({ length: 301 }, (_, index) => index * 33_333);
    const reversed = decoderFor([], { sortedTimestamps, advancingBackward: true, lastAdvanceSourceTime: 12 });
    expect(selectEvictionTimestamp(reversed)).toBe(0);
    // Once the target is behind the buffered range (frames above it already passed), drop the top.
    const passed = decoderFor([], { sortedTimestamps, advancingBackward: true, lastAdvanceSourceTime: 1 });
    expect(selectEvictionTimestamp(passed)).toBe(sortedTimestamps.at(-1));
    const forward = decoderFor([], { sortedTimestamps, advancingBackward: false, lastAdvanceSourceTime: 1 });
    expect(selectEvictionTimestamp(forward)).toBe(0);
  });
});

describe('exact-frame wait when a sample never decodes', () => {
  const samples = track(30, 15_360, 120);
  const ts = (index: number) => getNormalizedSampleTimestampMicroseconds(samples[index], 0);

  function decoderWithBuffered(indices: number[]): ClipDecoder {
    const sortedTimestamps = indices.map(ts);
    return decoderFor(samples, {
      sortedTimestamps,
      frameBuffer: new Map(sortedTimestamps.map(timestamp => [timestamp, { timestamp, sourceTime: timestamp / 1e6, frame: {} }])),
      oldestTimestamp: sortedTimestamps[0], newestTimestamp: sortedTimestamps.at(-1),
    } as Partial<ClipDecoder>);
  }

  function deps(decoder: ClipDecoder): ParallelDecodePrefetchDeps {
    return {
      isActive: () => true,
      clipDecoders: new Map([['clip', decoder]]),
      frameToleranceUs: 50_000,
      ensureDecoder: vi.fn(),
      // Re-decoding never produces the corrupt sample 60.
      decodeAhead: vi.fn(async () => {}),
    };
  }

  it('lets the export continue on a buffered neighbour instead of failing', async () => {
    vi.useFakeTimers();
    try {
      const decoder = decoderWithBuffered([58, 59, 61]);
      const pending = waitForExactBufferedFrame(deps(decoder), decoder, 60 / 30, 60);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({ aborted: false, exactFound: false, neighbourFound: true, attempts: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports nothing nearby so the caller can still fail loudly', async () => {
    vi.useFakeTimers();
    try {
      const decoder = decoderWithBuffered([10, 11]);
      const pending = waitForExactBufferedFrame(deps(decoder), decoder, 60 / 30, 60);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({ exactFound: false, neighbourFound: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
