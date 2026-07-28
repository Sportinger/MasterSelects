import { describe, expect, it } from 'vitest';

import { createBarsGridPlan, nearestBarTime } from '../../src/timeline/tempo/barsGrid';
import { normalizeTempoMap } from '../../src/timeline/tempo/tempoEdits';
import type { TempoMap } from '../../src/types/timeline';

// 120 BPM 4/4: beat 0.5 s, bar 2 s.
const AT_120: TempoMap = normalizeTempoMap({
  events: [{ id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 }],
});

// The default project tempo: bar 4 s, beat 1 s.
const AT_60: TempoMap = normalizeTempoMap({
  events: [{ id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 }],
});

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('createBarsGridPlan', () => {
  it('puts bars on 2 s and beats on 0.5 s at 120 BPM 4/4', () => {
    const plan = createBarsGridPlan({ tempoMap: AT_120, zoom: 100, startTime: 0, endTime: 8 });

    expect(plan.barTimes).toEqual([0, 2, 4, 6, 8]);
    // Beats are the non-bar lines: 0.5, 1, 1.5, 2.5, ...
    expect(plan.beatTimes).toContain(0.5);
    expect(plan.beatTimes).toContain(1.5);
    expect(plan.beatTimes.some(time => close(time, 2))).toBe(false);
  });

  it('matches the Bars ruler at the default 60 BPM — 4 s bars, 1 s beats', () => {
    const plan = createBarsGridPlan({ tempoMap: AT_60, zoom: 19.5, startTime: 0, endTime: 20 });

    expect(plan.barTimes).toEqual([0, 4, 8, 12, 16, 20]);
    expect(plan.beatTimes).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19]);
  });

  it('follows a mid-timeline tempo change', () => {
    // 60 BPM (4 s bars) until 8 s, then 120 BPM (2 s bars).
    const map = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
        { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
      ],
    });
    const plan = createBarsGridPlan({ tempoMap: map, zoom: 100, startTime: 0, endTime: 14 });

    expect(plan.barTimes).toEqual([0, 4, 8, 10, 12, 14]);
  });

  it('emits only lines inside the requested window', () => {
    const plan = createBarsGridPlan({ tempoMap: AT_120, zoom: 100, startTime: 4, endTime: 8 });

    const all = [...plan.barTimes, ...plan.beatTimes, ...plan.subdivisionTimes];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(time => time >= 4 && time <= 8)).toBe(true);
  });

  it('subdivides the beat: 1/8 halves it, 1/16 quarters it', () => {
    const eighths = createBarsGridPlan({
      tempoMap: AT_120, zoom: 400, startTime: 0, endTime: 2, subdivision: '1/8',
    });
    expect(eighths.subdivisionTimes).toEqual([0.25, 0.75, 1.25, 1.75]);

    const sixteenths = createBarsGridPlan({
      tempoMap: AT_120, zoom: 800, startTime: 0, endTime: 1, subdivision: '1/16',
    });
    expect(sixteenths.subdivisionTimes).toEqual([0.125, 0.25, 0.375, 0.625, 0.75, 0.875]);
  });

  it('splits the beat in three for 1/8 triplets', () => {
    const plan = createBarsGridPlan({
      tempoMap: AT_120, zoom: 800, startTime: 0, endTime: 0.5, subdivision: '1/8T',
    });
    expect(plan.subdivisionTimes).toHaveLength(2);
    expect(close(plan.subdivisionTimes[0], 0.5 / 3)).toBe(true);
    expect(close(plan.subdivisionTimes[1], 1 / 3)).toBe(true);
  });

  it('drops subdivisions, then beats, as zoom falls — never a solid block', () => {
    const dense = createBarsGridPlan({
      tempoMap: AT_120, zoom: 400, startTime: 0, endTime: 8, subdivision: '1/16',
    });
    expect(dense.subdivisionTimes.length).toBeGreaterThan(0);

    // 1/16 = 0.125 s; at zoom 40 that is 5 px — below the subdivision floor.
    const sparse = createBarsGridPlan({
      tempoMap: AT_120, zoom: 40, startTime: 0, endTime: 8, subdivision: '1/16',
    });
    expect(sparse.subdivisionTimes).toHaveLength(0);
    expect(sparse.beatTimes.length).toBeGreaterThan(0);

    // Beats are 0.5 s; at zoom 10 that is 5 px — below the beat floor.
    const barsOnly = createBarsGridPlan({
      tempoMap: AT_120, zoom: 10, startTime: 0, endTime: 40, subdivision: '1/16',
    });
    expect(barsOnly.beatTimes).toHaveLength(0);
    expect(barsOnly.barTimes.length).toBeGreaterThan(0);
  });

  it('subdivision "bar" draws bar lines only', () => {
    const plan = createBarsGridPlan({
      tempoMap: AT_120, zoom: 400, startTime: 0, endTime: 8, subdivision: 'bar',
    });
    expect(plan.barTimes).toEqual([0, 2, 4, 6, 8]);
    expect(plan.beatTimes).toHaveLength(0);
    expect(plan.subdivisionTimes).toHaveLength(0);
  });

  it('thins bars by stride when they collide, keeping the ruler in step', () => {
    // Bars 2 s apart at zoom 1 => 2 px, under the 4 px bar floor.
    const plan = createBarsGridPlan({ tempoMap: AT_120, zoom: 1, startTime: 0, endTime: 100 });
    const gaps = plan.barTimes.slice(1).map((time, i) => time - plan.barTimes[i]);
    expect(gaps.every(gap => close(gap, 4))).toBe(true);
  });

  it('returns nothing for an inverted window', () => {
    const plan = createBarsGridPlan({ tempoMap: AT_120, zoom: 100, startTime: 8, endTime: 4 });
    expect(plan).toEqual({ barTimes: [], beatTimes: [], subdivisionTimes: [] });
  });
});

// Issue #299, Packet 3: the tempo editor snaps flags to bars, independent of
// zoom — a musical position, not whatever the grid happens to draw.
describe('nearestBarTime', () => {
  it('snaps to the closest bar at 120 BPM 4/4 (2 s bars)', () => {
    expect(nearestBarTime(AT_120, 0)).toBeCloseTo(0, 9);
    expect(nearestBarTime(AT_120, 0.9)).toBeCloseTo(0, 9);
    expect(nearestBarTime(AT_120, 1.1)).toBeCloseTo(2, 9);
    expect(nearestBarTime(AT_120, 7.4)).toBeCloseTo(8, 9);
  });

  it('follows the tempo map across a change', () => {
    const map = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
        { id: 'b', time: 8, bpm: 120, numerator: 4, denominator: 4 },
      ],
    });
    // Before the change bars are 4 s; after it they are 2 s.
    expect(nearestBarTime(map, 3.5)).toBeCloseTo(4, 9);
    expect(nearestBarTime(map, 9.2)).toBeCloseTo(10, 9);
  });

  it('respects the meter — a 3/4 bar at 60 BPM is 3 s', () => {
    const threeFour = normalizeTempoMap({
      events: [{ id: 'a', time: 0, bpm: 60, numerator: 3, denominator: 4 }],
    });
    expect(nearestBarTime(threeFour, 2.6)).toBeCloseTo(3, 9);
    expect(nearestBarTime(threeFour, 5.4)).toBeCloseTo(6, 9);
  });

  it('never returns a negative time', () => {
    expect(nearestBarTime(AT_120, -5)).toBeGreaterThanOrEqual(0);
  });
});
