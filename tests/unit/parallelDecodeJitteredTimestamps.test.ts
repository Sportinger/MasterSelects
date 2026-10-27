import { describe, expect, it } from 'vitest';
import {
  REVERSE_REQUEST_WINDOW_US,
  derivePresentationGrid,
  findContainingPresentationIndex,
  findContainingSortedTimestamp,
} from '../../src/engine/parallelDecode/presentationFrame';
import { findSampleIndexForSourceTime, planDecodeBatch } from '../../src/engine/parallelDecode/scheduling';
import { getExpectedFrameTimestampUs, type ClipDecoder } from '../../src/engine/parallelDecode/clipDecoderState';
import { getNormalizedSampleTimestampMicroseconds } from '../../src/engine/parallelDecode/sampleTiming';
import { findClosestSampleIndex } from '../../src/engine/webCodecsExport/exportSamplePlanning';
import type { Sample } from '../../src/engine/webCodecsTypes';
import { BACKWARD_FRAME_EPSILON } from '../../src/services/timeline/retime/clipRetime';

/** Deterministic PRNG (Park-Miller) so every run sees the same jitter. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

/** Samples from container ticks (cts) in presentation order; duration = next - this. */
function samplesFromCts(cts: readonly number[], timescale: number): Sample[] {
  return cts.map((value, k) => ({
    number: k, track_id: 1, data: new ArrayBuffer(0), size: 0,
    cts: value, dts: value, duration: (cts[k + 1] ?? value + (cts[1] - cts[0])) - value,
    is_sync: k % 30 === 0, timescale,
  }));
}

/** Samples from presentation times in seconds, rounded to the container tick. */
function samplesAt(timesSeconds: readonly number[], timescale: number): Sample[] {
  return samplesFromCts(timesSeconds.map(time => Math.round(time * timescale)), timescale);
}

/** Android MediaMuxer style: 30 fps, each frame up to ±jitter us off k/30 (frame 0 defines source time 0). */
function jitteredTrack(timescale: number, jitterUs: number, frames: number, seed: number): Sample[] {
  const random = prng(seed);
  return samplesAt(Array.from({ length: frames }, (_, k) => k / 30 + (k === 0 ? 0 : ((random() * 2 - 1) * jitterUs) / 1e6)), timescale);
}

function decoderFor(samples: Sample[]): ClipDecoder {
  return {
    clipId: 'clip', clipName: 'Clip', samples, presentationOffsetSeconds: 0, sampleIndex: 0,
    frameBuffer: new Map(), sortedTimestamps: [], oldestTimestamp: Infinity, newestTimestamp: -Infinity,
    isDecoding: false, pendingDecode: null, decoder: null, needsKeyframe: true,
  } as unknown as ClipDecoder;
}

/** Frame index each of the three FAST selection paths shows at sourceTime; they must agree. */
function shownBy(samples: Sample[], decoder: ClipDecoder, sourceTime: number): number {
  const scheduled = findSampleIndexForSourceTime(samples, sourceTime, 0);
  expect(findClosestSampleIndex(samples, sourceTime, 0)).toBe(scheduled);
  expect(getExpectedFrameTimestampUs(decoder, sourceTime)).toBe(getNormalizedSampleTimestampMicroseconds(samples[scheduled], 0));
  return scheduled;
}

const timestampsUs = (samples: Sample[]) => samples.map(sample => getNormalizedSampleTimestampMicroseconds(sample, 0));

describe('phone footage with jittered timestamps (no exact grid)', () => {
  for (const timescale of [90_000, 1_000_000]) {
    for (const jitterUs of [50, 1000, 4000]) {
      it(`shows frame k forward and k-1 reversed at 30 fps, timescale ${timescale}, jitter ±${jitterUs} us`, () => {
        const frames = 600;
        const samples = jitteredTrack(timescale, jitterUs, frames, 7 + jitterUs);
        const grid = derivePresentationGrid(timestampsUs(samples), timescale);
        expect(grid?.frameDurationUs).toBeCloseTo(1e6 / 30, 6);
        const decoder = decoderFor(samples);
        for (let k = 0; k < frames; k++) {
          expect(shownBy(samples, decoder, k / 30)).toBe(k);
          // Reversed clip: videoFrameSourceTime() asks 10 us left of the nominal boundary.
          if (k > 0) expect(shownBy(samples, decoder, k / 30 - BACKWARD_FRAME_EPSILON)).toBe(k - 1);
        }
      });
    }
  }

  it('falls back to the nearest rule when the jitter is too large for a grid', () => {
    const frames = 600;
    const samples = jitteredTrack(90_000, 7000, frames, 11);
    const ts = timestampsUs(samples);
    expect(derivePresentationGrid(ts, 90_000)).toBeNull();
    const decoder = decoderFor(samples);
    let checked = 0;
    for (let k = 1; k < frames; k++) {
      // The one case nearest cannot tell from a reverse request: frame k stored 2-20 us after k/30.
      const lead = ts[k] - (k * 1e6) / 30;
      if (lead > 1 && lead <= REVERSE_REQUEST_WINDOW_US) continue;
      expect(shownBy(samples, decoder, k / 30)).toBe(k);
      checked++;
      // Reverse at the stored boundary: the frame before it.
      expect(shownBy(samples, decoder, ts[k] / 1e6 - BACKWARD_FRAME_EPSILON)).toBe(k - 1);
    }
    expect(checked).toBeGreaterThan(frames * 0.9);
  });
});

describe('VFR media keeps the nearest rule with a reverse-boundary window', () => {
  // Variable frame durations between 20 and 50 ms, stored at 1/1e6.
  const random = prng(3);
  const times: number[] = [0];
  for (let k = 1; k < 300; k++) times.push(times[k - 1] + 0.02 + random() * 0.03);
  const samples = samplesAt(times, 1_000_000);
  const ts = timestampsUs(samples);
  const decoder = decoderFor(samples);

  it('derives no grid', () => {
    expect(derivePresentationGrid(ts, 1_000_000)).toBeNull();
  });

  it('takes the nearest frame forward, also when the request lies just before it', () => {
    for (let k = 1; k < samples.length; k++) {
      expect(shownBy(samples, decoder, ts[k] / 1e6)).toBe(k);
      // A request 30 us early (rounded timeline time) is past the reverse window: still frame k.
      expect(shownBy(samples, decoder, (ts[k] - 30) / 1e6)).toBe(k);
      expect(shownBy(samples, decoder, (ts[k] + 3000) / 1e6)).toBe(k);
    }
  });

  it('takes the previous frame for a request 10 us before a boundary', () => {
    for (let k = 1; k < samples.length; k++) {
      expect(shownBy(samples, decoder, ts[k] / 1e6 - BACKWARD_FRAME_EPSILON)).toBe(k - 1);
    }
  });

  it('applies the window in decode order and keeps microsecond rounding forward', () => {
    const NEAREST = { kind: 'nearest', roundingUs: 0 } as const;
    const sorted = [0, 41_708, 83_417, 125_125];
    const decodeOrder = [0, 125_125, 41_708, 83_417];
    const index = (requestUs: number) => decodeOrder[findContainingPresentationIndex(4, i => decodeOrder[i], requestUs, undefined, NEAREST)];
    const sortedPick = (requestUs: number) => findContainingSortedTimestamp(sorted, requestUs, undefined, NEAREST);
    for (const pick of [index, sortedPick]) {
      expect(pick(41_698)).toBe(0); // 10 us before: the frame before the boundary
      expect(pick(41_688)).toBe(0); // 20 us before: still inside the window
      expect(pick(41_680)).toBe(41_708); // 28 us before: nearest
      expect(pick(41_707.4)).toBe(41_708); // float rounding below the 1 us slack
      expect(pick(-5)).toBe(0);
      expect(pick(125_115)).toBe(83_417);
      expect(pick(10_000_000)).toBe(125_125);
    }
  });

  it('keeps exact forward hits whose stored timestamp rounds up by up to half a tick (1/90000)', () => {
    // A constant but non-standard rate (29.98 fps) gets no grid; the timeline asks for frame times exactly.
    const odd = samplesFromCts(Array.from({ length: 900 }, (_, k) => Math.round((k * 90_000 * 100) / 2998)), 90_000);
    expect(derivePresentationGrid(timestampsUs(odd), 90_000)).toBeNull();
    const oddDecoder = decoderFor(odd);
    for (let k = 0; k < odd.length; k++) expect(shownBy(odd, oddDecoder, (k * 100) / 2998)).toBe(k);
    // 10 us before a stored boundary is still a reverse request at this timescale.
    const oddTs = timestampsUs(odd);
    for (let k = 1; k < odd.length; k++) expect(shownBy(odd, oddDecoder, oddTs[k] / 1e6 - BACKWARD_FRAME_EPSILON)).toBe(k - 1);
  });

  it('pins the window to twice the backward frame epsilon', () => {
    expect(REVERSE_REQUEST_WINDOW_US).toBeCloseTo(2 * BACKWARD_FRAME_EPSILON * 1e6, 9);
  });
});

describe('odd constant frame rates get a grid', () => {
  const CASES: Array<{ fps: number; timescale: number }> = [
    { fps: 7.5, timescale: 1000 },
    { fps: 12.5, timescale: 1000 },
    { fps: 2.5, timescale: 1000 },
    { fps: 15_000 / 1001, timescale: 1000 },
    { fps: 15_000 / 1001, timescale: 600 },
    { fps: 240, timescale: 600 },
  ];
  for (const { fps, timescale } of CASES) {
    for (const [name, round] of [['round', Math.round], ['floor', Math.floor]] as const) {
      it(`selects frame N forward and N-1 reversed at ${fps.toFixed(3)} fps, timescale ${timescale} (${name})`, () => {
        const frames = 150;
        // Integer tick arithmetic like a muxer: frame k at round/floor(k * timescale / fps).
        const samples = samplesFromCts(Array.from({ length: frames }, (_, k) => round((k * timescale) / fps)), timescale);
        expect(derivePresentationGrid(timestampsUs(samples), timescale)?.frameDurationUs).toBeCloseTo(1e6 / fps, 6);
        const decoder = decoderFor(samples);
        for (let n = 0; n < frames; n++) {
          expect(shownBy(samples, decoder, n / fps)).toBe(n);
          if (n > 0) expect(shownBy(samples, decoder, n / fps - BACKWARD_FRAME_EPSILON)).toBe(n - 1);
        }
      });
    }
  }
});

describe('decodeAhead batch planning after a decoder reset', () => {
  const samples = Array.from({ length: 120 }, (_, k) => ({ cts: k * 512, timescale: 15_360, is_sync: k % 30 === 0 }));

  it('counts from the rewound keyframe so the pass reaches the target', () => {
    // Resume after a pool reset at sample 50; the decoder needs the keyframe at 30 first.
    expect(planDecodeBatch(samples, 50, 60, true, 60)).toEqual({ startSampleIndex: 30, framesToDecode: 30, resetToKeyframe: true });
  });

  it('decodes from the cursor when no keyframe is needed and respects the batch size', () => {
    expect(planDecodeBatch(samples, 50, 60, false, 60)).toEqual({ startSampleIndex: 50, framesToDecode: 10, resetToKeyframe: false });
    expect(planDecodeBatch(samples, 50, 119, true, 40)).toEqual({ startSampleIndex: 30, framesToDecode: 40, resetToKeyframe: true });
  });

  it('does nothing, and does not rewind, when the cursor already reached the target', () => {
    expect(planDecodeBatch(samples, 60, 60, true, 60)).toEqual({ startSampleIndex: 60, framesToDecode: 0, resetToKeyframe: false });
    expect(planDecodeBatch(samples, 110, 500, false, 60)).toEqual({ startSampleIndex: 110, framesToDecode: 10, resetToKeyframe: false });
  });
});
