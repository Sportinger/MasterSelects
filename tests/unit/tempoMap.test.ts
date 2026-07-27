import { describe, expect, it } from 'vitest';

import type { TempoMap } from '../../src/types/timeline';
import {
  barBeatToSeconds,
  iterateBarBeatLines,
  secondsToBarBeat,
} from '../../src/timeline/tempo/TempoMap';

const FOUR_FOUR_60: TempoMap = {
  events: [{ id: 'ev-1', time: 0, bpm: 60, numerator: 4, denominator: 4 }],
};

describe('TempoMap — single 4/4 @ 60 BPM segment', () => {
  it('puts bar N at (N-1)*4 seconds', () => {
    expect(barBeatToSeconds(FOUR_FOUR_60, 1)).toBeCloseTo(0);
    expect(barBeatToSeconds(FOUR_FOUR_60, 2)).toBeCloseTo(4);
    expect(barBeatToSeconds(FOUR_FOUR_60, 5)).toBeCloseTo(16);
  });

  it('maps seconds to bar/beat (beats land on integer seconds)', () => {
    expect(secondsToBarBeat(FOUR_FOUR_60, 0)).toEqual({ bar: 1, beat: 1 });
    expect(secondsToBarBeat(FOUR_FOUR_60, 1)).toEqual({ bar: 1, beat: 2 });
    expect(secondsToBarBeat(FOUR_FOUR_60, 4)).toEqual({ bar: 2, beat: 1 });
    expect(secondsToBarBeat(FOUR_FOUR_60, 5)).toEqual({ bar: 2, beat: 2 });
  });

  it('returns fractional beats between beat lines', () => {
    const pos = secondsToBarBeat(FOUR_FOUR_60, 5.5);
    expect(pos.bar).toBe(2);
    expect(pos.beat).toBeCloseTo(2.5);
  });

  it('round-trips bar/beat <-> seconds', () => {
    const t = barBeatToSeconds(FOUR_FOUR_60, 3, 3); // bar 3, beat 3
    expect(t).toBeCloseTo(10); // 2 bars (8s) + 2 beats (2s)
    expect(secondsToBarBeat(FOUR_FOUR_60, t)).toEqual({ bar: 3, beat: 3 });
  });

  it('iterates one beat line per second with bar starts every 4th', () => {
    const lines = iterateBarBeatLines(FOUR_FOUR_60, 0, 8);
    expect(lines.map(l => l.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lines.filter(l => l.isBarStart).map(l => l.time)).toEqual([0, 4, 8]);
    expect(lines[4]).toMatchObject({ time: 4, bar: 2, beat: 1, isBarStart: true });
    expect(lines[5]).toMatchObject({ time: 5, bar: 2, beat: 2, isBarStart: false });
  });

  it('clips the iterated window to [startTime, endTime]', () => {
    const lines = iterateBarBeatLines(FOUR_FOUR_60, 2.5, 6);
    expect(lines.map(l => l.time)).toEqual([3, 4, 5, 6]);
  });
});

describe('TempoMap — multi-segment (tempo change)', () => {
  // 4/4 @ 60 for the first 2 bars (8s), then 4/4 @ 120 (beats every 0.5s).
  const map: TempoMap = {
    events: [
      { id: 'ev-2', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'ev-3', time: 8, bpm: 120, numerator: 4, denominator: 4 },
    ],
  };

  it('converts across the segment boundary', () => {
    expect(secondsToBarBeat(map, 8)).toEqual({ bar: 3, beat: 1 });
    // In the 120 BPM segment each bar is 2s, so bar 4 downbeat is at 10s.
    expect(secondsToBarBeat(map, 10)).toEqual({ bar: 4, beat: 1 });
    expect(barBeatToSeconds(map, 4)).toBeCloseTo(10);
    expect(barBeatToSeconds(map, 3)).toBeCloseTo(8);
  });

  it('iterates with the post-change beat spacing after the boundary', () => {
    const lines = iterateBarBeatLines(map, 8, 10);
    // boundary line (8s) + 0.5s spacing through 10s
    expect(lines.map(l => l.time)).toEqual([8, 8.5, 9, 9.5, 10]);
    expect(lines[0]).toMatchObject({ bar: 3, beat: 1, isBarStart: true });
    expect(lines[4]).toMatchObject({ bar: 4, beat: 1, isBarStart: true });
  });
});

describe('TempoMap — meter change', () => {
  // 4/4 for bar 1 (4s @ 60), then 3/4 from bar 2 onward.
  const map: TempoMap = {
    events: [
      { id: 'ev-4', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'ev-5', time: 4, bpm: 60, numerator: 3, denominator: 4 },
    ],
  };

  it('uses the post-change numerator for later bars', () => {
    expect(secondsToBarBeat(map, 4)).toEqual({ bar: 2, beat: 1 });
    // 3/4 bar is 3 beats (3s): bar 3 downbeat at 7s.
    expect(secondsToBarBeat(map, 7)).toEqual({ bar: 3, beat: 1 });
    expect(barBeatToSeconds(map, 3)).toBeCloseTo(7);
  });
});

// Issue #299, Packet 2: the projection must stay total and invertible BELOW the
// first segment. A MIDI clip extended leftwards has a negative inPoint, so its
// content origin sits before bar 1 and the remap queries bar <= 0.
describe('TempoMap — below the first segment', () => {
  const single: TempoMap = {
    events: [{ id: 'ev-6', time: 0, bpm: 60, numerator: 4, denominator: 4 }],
  };

  const multi: TempoMap = {
    events: [
      { id: 'ev-7', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'ev-8', time: 8, bpm: 120, numerator: 4, denominator: 4 },
    ],
  };

  it('extrapolates bar 0 backwards through the first segment', () => {
    // One 4 s bar before the origin.
    expect(barBeatToSeconds(single, 0)).toBeCloseTo(-4);
    expect(barBeatToSeconds(single, 0, 3)).toBeCloseTo(-2);
    expect(barBeatToSeconds(single, -1)).toBeCloseTo(-8);
  });

  it('uses the FIRST segment, not the last, when several exist', () => {
    // The regression: every range test failed and the walk fell through to the
    // last segment, which is 120 BPM here and would answer -2 instead of -4.
    expect(barBeatToSeconds(multi, 0)).toBeCloseTo(-4);
    expect(barBeatToSeconds(multi, 0)).toBe(barBeatToSeconds(single, 0));
  });

  it('round-trips negative times through secondsToBarBeat', () => {
    for (const time of [-0.25, -1, -4, -9.5]) {
      const position = secondsToBarBeat(multi, time);
      expect(barBeatToSeconds(multi, position.bar, position.beat)).toBeCloseTo(time, 9);
    }
  });
});

// Issue #299: a 'ramp' event is REACHED gradually — the tempo interpolates
// linearly in time across the interval leading into it, so beats accumulate as
// the integral of a line rather than a constant stride.
describe('TempoMap — ramps', () => {
  // 60 BPM 4/4 (1 beat/s) gliding to 120 BPM (2 beats/s) over the first 8 s.
  const accelerando: TempoMap = {
    events: [
      { id: 'ev-a', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'ev-b', time: 8, bpm: 120, numerator: 4, denominator: 4, curve: 'ramp' },
    ],
  };

  const jump: TempoMap = {
    events: [
      { id: 'ev-c', time: 0, bpm: 60, numerator: 4, denominator: 4 },
      { id: 'ev-d', time: 8, bpm: 120, numerator: 4, denominator: 4 },
    ],
  };

  it('accumulates the AVERAGE tempo across the ramp, not the starting one', () => {
    // (1 + 2)/2 beats/s * 8 s = 12 beats = 3 bars, so 8 s is the bar-4 downbeat.
    expect(secondsToBarBeat(accelerando, 8)).toEqual({ bar: 4, beat: 1 });
    // The same map as a jump only reaches 8 beats = 2 bars in that time.
    expect(secondsToBarBeat(jump, 8)).toEqual({ bar: 3, beat: 1 });
  });

  it('is quadratic through the ramp, not linear', () => {
    // Halfway in time: 1*4 + (1 beat/s over 8 s) * 4^2 / (2*8) = 5 beats.
    const halfway = secondsToBarBeat(accelerando, 4);
    expect(halfway.bar).toBe(2);
    expect(halfway.beat).toBeCloseTo(2, 9);
    // A linear reading would have put 4 s at beat 5 of bar 1 (4 beats elapsed).
  });

  it('inverts exactly — barBeatToSeconds undoes secondsToBarBeat', () => {
    for (const time of [0.5, 2, 4, 6, 7.99, 8, 12]) {
      const position = secondsToBarBeat(accelerando, time);
      expect(barBeatToSeconds(accelerando, position.bar, position.beat)).toBeCloseTo(time, 6);
    }
  });

  it('emits beat lines that get progressively closer together', () => {
    const lines = iterateBarBeatLines(accelerando, 0, 8);
    const gaps = lines.slice(1).map((line, i) => line.time - lines[i].time);

    expect(gaps.length).toBeGreaterThan(4);
    expect(gaps.every((gap, i) => i === 0 || gap < gaps[i - 1] + 1e-9)).toBe(true);
    // The very first beat is ALREADY accelerating, so it is a little under the
    // 1 s a jump would give: tau^2 + 16*tau - 16 = 0 => 0.9443 s.
    expect(gaps[0]).toBeCloseTo(0.9443, 3);
    expect(gaps[gaps.length - 1]).toBeLessThan(0.75);
  });

  it('handles a ritardando (slowing down) symmetrically', () => {
    const ritardando: TempoMap = {
      events: [
        { id: 'ev-e', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'ev-f', time: 8, bpm: 60, numerator: 4, denominator: 4, curve: 'ramp' },
      ],
    };
    // (2 + 1)/2 * 8 = 12 beats again — the mirror of the accelerando.
    expect(secondsToBarBeat(ritardando, 8)).toEqual({ bar: 4, beat: 1 });

    const lines = iterateBarBeatLines(ritardando, 0, 8);
    const gaps = lines.slice(1).map((line, i) => line.time - lines[i].time);
    expect(gaps.every((gap, i) => i === 0 || gap > gaps[i - 1] - 1e-9)).toBe(true);
  });

  it('holds the reached tempo after the ramp ends', () => {
    // From 8 s onward it is a flat 120 BPM: 2 beats/s, so a bar takes 2 s.
    expect(secondsToBarBeat(accelerando, 10)).toEqual({ bar: 5, beat: 1 });
  });

  it('ignores a curve on the FIRST event — nothing precedes it to ramp from', () => {
    const leading: TempoMap = {
      events: [{ id: 'ev-g', time: 0, bpm: 60, numerator: 4, denominator: 4, curve: 'ramp' }],
    };
    expect(secondsToBarBeat(leading, 4)).toEqual({ bar: 2, beat: 1 });
  });

  it('leaves a map with no ramps byte-identical to the jump behaviour', () => {
    for (const time of [0, 1.5, 8, 9.25, 20]) {
      expect(secondsToBarBeat(jump, time)).toEqual(secondsToBarBeat(jump, time));
    }
    expect(iterateBarBeatLines(jump, 0, 12).map(l => l.time))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12]);
  });
});
