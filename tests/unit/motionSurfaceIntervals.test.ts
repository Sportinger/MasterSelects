import { expect, it } from 'vitest';
import { motionSurfaceIntervals } from '../../src/effects/time/slit-scan/motionSurfaceIntervals';
import { adjacentMotionPairs } from '../../src/effects/time/residentMotionFrames';
import type { TemporalClipSource } from '../../src/effects/time/temporalClipSource';

it('retains measured direction and real PTS, deduplicating reverse copies', () => {
  const values = motionSurfaceIntervals([
    { sourceTime: 1.25, targetTime: 1, slot: 7 },
    { sourceTime: 1, targetTime: 1.25, slot: 8 },
    { sourceTime: 1.25, targetTime: 1.5, slot: 9 },
    { sourceTime: 1.5, targetTime: 1.5, slot: 10 },
  ], 1.5);
  expect([...values]).toEqual([-.5, -.25, 7, 1, -.25, 0, 9, 0]);
});

it('retains long-clip subframe precision and rejects contradictory intervals', () => {
  const values = motionSurfaceIntervals([{ sourceTime: 1e6, targetTime: 1e6 + 1 / 120, slot: 0 }], 1e6);
  expect(values[1]).toBeCloseTo(1 / 120, 8);
  expect(() => motionSurfaceIntervals([
    { sourceTime: 0, targetTime: 2, slot: 0 }, { sourceTime: 1, targetTime: 3, slot: 1 },
  ], 3)).toThrow(/non-overlapping/);
});

it('fills skipped source PTS and adds the next endpoint for a fractional current time', () => {
  const frames = [0, .04, .09, .12, .17, .22].map(time => ({ time }));
  const source = { inPoint: 0, outPoint: .22 } as TemporalClipSource;
  const pairs = adjacentMotionPairs([.04, .12], frames, source, true);
  expect([...pairs]).toEqual([[.04, 0], [.09, .04], [.12, .09], [.17, .12]]);
  expect([...pairs.keys()]).not.toContain(.22);
});
