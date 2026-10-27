import { describe, expect, it, vi } from 'vitest';
import {
  PRESENTATION_TIMESTAMP_SLACK_US,
  findContainingPresentationIndex,
  findContainingSortedTimestamp,
} from '../../src/engine/parallelDecode/presentationFrame';
import { findSampleIndexForSourceTime } from '../../src/engine/parallelDecode/scheduling';
import {
  getExpectedFrameTimestampUs,
  getResumeSampleIndexAfterReset,
  hasExpectedBufferedFrame,
  type ClipDecoder,
} from '../../src/engine/parallelDecode/clipDecoderState';
import { getBufferedFrameForClipSourceTime } from '../../src/engine/parallelDecode/frameAccess';
import { prefetchFramesForTime, type ParallelDecodePrefetchDeps } from '../../src/engine/parallelDecode/prefetchCoordinator';
import { getNormalizedSampleTimestampMicroseconds } from '../../src/engine/parallelDecode/sampleTiming';
import { BACKWARD_FRAME_EPSILON } from '../../src/services/timeline/retime/clipRetime';
import { exportDiagnostics } from '../../src/services/export/exportDiagnostics';

const FPS = 30;
/** 4 s at 30 fps, timescale 15360 (512 ticks per frame), all in presentation order. */
const samples = Array.from({ length: 120 }, (_, index) => ({ cts: index * 512, timescale: 15_360, is_sync: index % 30 === 0 }));
const frameUs = (index: number) => getNormalizedSampleTimestampMicroseconds(samples[index], 0);

function clipDecoder(buffered: number[], overrides: Partial<ClipDecoder> = {}): ClipDecoder {
  const sortedTimestamps = buffered.map(frameUs).toSorted((a, b) => a - b);
  return {
    clipId: 'clip', clipName: 'Clip',
    clipInfo: { clipId: 'clip', clipName: 'Clip', startTime: 0, duration: 4, inPoint: 0, outPoint: 4, speed: 1, reversed: false },
    samples, presentationOffsetSeconds: 0, sampleIndex: 0,
    frameBuffer: new Map(sortedTimestamps.map(timestamp => [timestamp, { timestamp, sourceTime: timestamp / 1e6, frame: { id: timestamp } }])),
    sortedTimestamps,
    oldestTimestamp: sortedTimestamps[0] ?? Infinity,
    newestTimestamp: sortedTimestamps.at(-1) ?? -Infinity,
    isDecoding: false, pendingDecode: null, decoder: null, needsKeyframe: true,
    ...overrides,
  } as unknown as ClipDecoder;
}

/** Source time a reversed 4-s clip asks for at composition frame n (videoFrameSourceTime). */
const reversedTarget = (n: number) => 4 - n / FPS - BACKWARD_FRAME_EPSILON;

describe('parallel decode presentation-frame selection (EXPORT_REVERSE_OFF_BY_ONE)', () => {
  it('keeps the rounding slack far below the backward frame epsilon', () => {
    expect(PRESENTATION_TIMESTAMP_SLACK_US).toBeLessThan(BACKWARD_FRAME_EPSILON * 1_000_000 / 2);
  });

  it('selects source frame 119-N, not 120-N, for a reversed clip', () => {
    for (const n of [0, 1, 29, 45, 59, 60, 89, 119]) {
      expect(findSampleIndexForSourceTime(samples, reversedTarget(n), 0)).toBe(119 - n);
      expect(getExpectedFrameTimestampUs(clipDecoder([]), reversedTarget(n))).toBe(frameUs(119 - n));
    }
  });

  it('selects frame N at its own boundary even when its timestamp rounds up by a fraction of a microsecond', () => {
    // 2/30 s = 66666.67 us; the chunk timestamp is rounded to 66667 us.
    expect(frameUs(2)).toBe(66_667);
    for (const n of [0, 1, 2, 59, 60, 61, 119]) {
      expect(findSampleIndexForSourceTime(samples, n / FPS, 0)).toBe(n);
      expect(getExpectedFrameTimestampUs(clipDecoder([]), n / FPS)).toBe(frameUs(n));
    }
  });

  it('keeps the half-open rule for mixed rates and B-frame decode order', () => {
    // 23.976 fps packets (1001/24000 s) read by a 24 fps timeline: 1/24 s lies before packet 1.
    const ntsc = [0, 1, 2, 3].map(index => index * 1001 / 24_000 * 1e6);
    expect(findContainingSortedTimestamp(ntsc, 1e6 / 24)).toBe(ntsc[0]);
    // Decode order I P B B: presentation 0, 3, 1, 2.
    const decodeOrder = [0, 3, 1, 2].map(index => index * 33_333);
    expect(findContainingPresentationIndex(4, index => decodeOrder[index], 2 * 33_333 + 10)).toBe(3);
    expect(findContainingPresentationIndex(4, index => decodeOrder[index], -5)).toBe(0);
  });
});

describe('parallel decode buffered-frame lookup (EXPORT_STALE_LAYER_FRAMES)', () => {
  it('does not accept the previous frame as the one at the target', () => {
    const decoder = clipDecoder([57, 58, 59]);
    expect(hasExpectedBufferedFrame(decoder, 60 / FPS)).toBe(false);
    expect(getBufferedFrameForClipSourceTime(decoder, 60 / FPS, 50_000, { toleranceMultiplier: 3 })).toBeNull();
  });

  it('reports a neighbour substitution when the caller allows one', () => {
    const decoder = clipDecoder([58, 59]);
    const onFallback = vi.fn();
    const frame = getBufferedFrameForClipSourceTime(decoder, 61 / FPS, 50_000,
      { toleranceMultiplier: 3, allowNeighbourFallback: true }, onFallback);
    expect(frame).toEqual({ id: frameUs(59) });
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({
      clipId: 'clip', expectedFrameTime: frameUs(61) / 1e6, usedFrameTime: frameUs(59) / 1e6,
    }));
  });

  it('returns the exact frame without reporting anything', () => {
    const decoder = clipDecoder([59, 60, 61]);
    const onFallback = vi.fn();
    expect(getBufferedFrameForClipSourceTime(decoder, reversedTarget(59), 50_000,
      { allowNeighbourFallback: true }, onFallback)).toEqual({ id: frameUs(60) });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('counts a neighbour substitution as a previous-frame fallback in export diagnostics', () => {
    exportDiagnostics.start({ test: true });
    exportDiagnostics.recordNeighbourFrameFallback({ clipId: 'clip', clipName: 'Clip', sourceTime: 2, usedFrameTime: 59 / FPS });
    const current = exportDiagnostics.snapshot().current as { seeks: { previousFrameFallbacks: number; fallbackSamples: Array<{ reason?: string }> } };
    expect(current.seeks.previousFrameFallbacks).toBe(1);
    expect(current.seeks.fallbackSamples[0]?.reason).toBe('neighbour-frame');
    exportDiagnostics.finish('cancelled');
  });

  it('prefetch waits for the exact frame instead of taking the previous one as ready', async () => {
    const decoder = clipDecoder([57, 58, 59], { sampleIndex: 60 });
    const decodeAhead: ParallelDecodePrefetchDeps['decodeAhead'] = vi.fn(async () => {
      const timestamp = frameUs(60);
      decoder.frameBuffer.set(timestamp, { timestamp, sourceTime: 2, frame: { id: timestamp } } as never);
      decoder.sortedTimestamps.push(timestamp);
      decoder.newestTimestamp = timestamp;
    });
    const deps: ParallelDecodePrefetchDeps = {
      isActive: () => true,
      clipDecoders: new Map([['clip', decoder]]),
      frameToleranceUs: 50_000,
      ensureDecoder: async () => { throw new Error('unexpected flush'); },
      decodeAhead,
    };
    await prefetchFramesForTime(deps, 60 / FPS);
    expect(decodeAhead).toHaveBeenCalledWith(decoder, 120, false, 0, 60);
    expect(hasExpectedBufferedFrame(decoder, 60 / FPS)).toBe(true);
  });
});

describe('parallel decode resume after a pool reset', () => {
  it('resumes at the first frame after the newest buffered one, not at 0 or past dropped chunks', () => {
    expect(getResumeSampleIndexAfterReset(clipDecoder([50, 59]))).toBe(60);
    expect(getResumeSampleIndexAfterReset(clipDecoder([]))).toBe(0);
    expect(getResumeSampleIndexAfterReset(clipDecoder([119]))).toBe(120);
  });
});

describe('parallel decode VFR gaps keep the nearer frame', () => {
  it('takes the next frame when the target lies in a gap after the containing frame ended', () => {
    // Frame 0 lasts 33 ms, the next frame starts at 53.04 s (sparse VFR).
    const starts = [0, 53_041_666];
    const durations = [33_333, 33_333];
    expect(findContainingPresentationIndex(2, i => starts[i], 52_872_330, i => durations[i])).toBe(1);
    expect(findContainingSortedTimestamp(starts, 52_872_330, ts => (ts === 0 ? 33_333 : 33_333))).toBe(53_041_666);
    // Early in the gap the earlier frame is still nearer.
    expect(findContainingPresentationIndex(2, i => starts[i], 1_000_000, i => durations[i])).toBe(0);
  });

  it('keeps containment within the frame duration (reverse request at a CFR boundary)', () => {
    expect(findContainingPresentationIndex(120, i => frameUs(i), reversedTarget(60) * 1e6, () => 1e6 / FPS)).toBe(59);
  });
});
