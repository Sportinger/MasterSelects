import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  resolvePlaybackRange,
  resolvePlaybackStartPosition,
} from '../../src/stores/timeline/playbackRange';

const fcOptions = {
  numRuns: 200,
  seed: 20260518,
};

const finiteTime = fc.double({
  min: -10_000,
  max: 10_000,
  noDefaultInfinity: true,
  noNaN: true,
});

const nullableFiniteTime = fc.oneof(finiteTime, fc.constant(null));

function safeDuration(duration: number): number {
  return Math.max(0, Number.isFinite(duration) ? duration : 0);
}

function sanitize(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function resolvedRange(inPoint: number | null, outPoint: number | null, duration: number): { start: number; end: number } {
  const limit = safeDuration(duration);
  const start = Math.max(0, Math.min(inPoint ?? 0, limit));
  const end = Math.max(start, Math.min(outPoint ?? limit, limit));
  return { start, end };
}

describe('playback range properties', () => {
  it('always resolves playback start to a finite time inside the safe duration', () => {
    fc.assert(
      fc.property(finiteTime, nullableFiniteTime, nullableFiniteTime, finiteTime, finiteTime, (
        playheadPosition,
        inPoint,
        outPoint,
        duration,
        playbackSpeed,
      ) => {
        const resolved = resolvePlaybackStartPosition(playheadPosition, inPoint, outPoint, duration, playbackSpeed);

        expect(Number.isFinite(resolved)).toBe(true);
        expect(resolved).toBeGreaterThanOrEqual(0);
        expect(resolved).toBeLessThanOrEqual(safeDuration(duration));
      }),
      fcOptions,
    );
  });

  it('returns the clamped playhead when no in/out range is active', () => {
    fc.assert(
      fc.property(finiteTime, finiteTime, finiteTime, (playheadPosition, duration, playbackSpeed) => {
        const limit = safeDuration(duration);
        const expected = Math.max(0, Math.min(sanitize(playheadPosition), limit));

        expect(resolvePlaybackStartPosition(playheadPosition, null, null, duration, playbackSpeed)).toBe(expected);
      }),
      fcOptions,
    );
  });

  it('starts forward playback at range start when the playhead is outside the active range', () => {
    fc.assert(
      fc.property(finiteTime, nullableFiniteTime, nullableFiniteTime, finiteTime, (duration, inPoint, outPoint, playhead) => {
        const range = resolvedRange(inPoint, outPoint, duration);
        const clampedPlayhead = Math.max(0, Math.min(sanitize(playhead, range.start), safeDuration(duration)));
        fc.pre(inPoint !== null || outPoint !== null);
        fc.pre(range.end > range.start);
        fc.pre(clampedPlayhead < range.start || clampedPlayhead >= range.end);

        expect(resolvePlaybackStartPosition(playhead, inPoint, outPoint, duration, 1)).toBe(range.start);
      }),
      fcOptions,
    );
  });

  it('starts reverse playback at range end when the playhead is outside the active range', () => {
    fc.assert(
      fc.property(finiteTime, nullableFiniteTime, nullableFiniteTime, finiteTime, (duration, inPoint, outPoint, playhead) => {
        const range = resolvedRange(inPoint, outPoint, duration);
        const clampedPlayhead = Math.max(0, Math.min(sanitize(playhead, range.start), safeDuration(duration)));
        fc.pre(inPoint !== null || outPoint !== null);
        fc.pre(range.end > range.start);
        fc.pre(clampedPlayhead <= range.start || clampedPlayhead > range.end);

        expect(resolvePlaybackStartPosition(playhead, inPoint, outPoint, duration, -1)).toBe(range.end);
      }),
      fcOptions,
    );
  });

  it('treats a collapsed in/out selection as the full playable timeline', () => {
    expect(resolvePlaybackRange(2.337, 2.337, 46.28)).toEqual({
      start: 0,
      end: 46.28,
      hasRange: false,
    });
    expect(resolvePlaybackStartPosition(2.337, 2.337, 2.337, 46.28, 1)).toBe(2.337);
  });
});
