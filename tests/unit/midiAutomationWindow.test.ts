import { describe, it, expect } from 'vitest';
import {
  sampleLaneAt,
  sliceAutomationToNote,
} from '../../src/services/midi/midiAutomationWindow';

describe('sampleLaneAt', () => {
  const lane = { points: [
    { time: 0, value: 0 },
    { time: 2, value: 1 },
  ] };

  it('returns undefined for an absent/empty lane', () => {
    expect(sampleLaneAt(undefined, 1)).toBeUndefined();
    expect(sampleLaneAt({ points: [] }, 1)).toBeUndefined();
  });

  it('flat-holds before the first and after the last point', () => {
    expect(sampleLaneAt(lane, -5)).toBe(0);
    expect(sampleLaneAt(lane, 99)).toBe(1);
  });

  it('linearly interpolates between breakpoints', () => {
    expect(sampleLaneAt(lane, 1)).toBeCloseTo(0.5, 6);
    expect(sampleLaneAt(lane, 0.5)).toBeCloseTo(0.25, 6);
  });
});

describe('sliceAutomationToNote', () => {
  it('returns undefined when there is no automation', () => {
    expect(sliceAutomationToNote(undefined, 1, 1)).toBeUndefined();
    expect(sliceAutomationToNote({}, 1, 1)).toBeUndefined();
  });

  it('anchors endpoints at note-local 0 and duration, rebasing interior points', () => {
    // cutoff ramps 0→1 over content time [0,4]; a note at [1,3] (duration 2)
    // should see local 0 → 0.25, an interior point, and local 2 → 0.75.
    const window = sliceAutomationToNote(
      { cutoff: { points: [
        { time: 0, value: 0 },
        { time: 2, value: 0.5 }, // interior to [1,3] → local 1
        { time: 4, value: 1 },
      ] } },
      1,
      2,
    );
    const pts = window?.cutoff?.points ?? [];
    expect(pts[0]).toEqual({ time: 0, value: 0.25 });
    expect(pts.some(p => p.time === 1 && p.value === 0.5)).toBe(true);
    expect(pts[pts.length - 1]).toEqual({ time: 2, value: 0.75 });
  });

  it('keeps only lanes that carry data', () => {
    const window = sliceAutomationToNote(
      { mod: { points: [{ time: 0, value: 0.3 }] } },
      0,
      1,
    );
    expect(window?.mod).toBeDefined();
    expect(window?.cutoff).toBeUndefined();
    expect(window?.expression).toBeUndefined();
    expect(window?.pitchBend).toBeUndefined();
  });
});
