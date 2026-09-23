import { describe, expect, it } from 'vitest';
import { geometrySampleTimes } from '../../src/effects/time/slit-scan/geometrySampleTimes';
import { temporalSampleMetadata } from '../../src/effects/time/TemporalSampleMetadata';

describe('geometry resolved source times', () => {
  it('keeps within-frame blend weights and current input distinct', () => {
    const metadata = temporalSampleMetadata({ times: [9.75, 9.5], samples: [
      { age: 0, group: 0, nextGroup: 0, blend: 0 },
      { age: 2, group: 1, nextGroup: 2, blend: .75 },
    ] }, 4, false);
    expect([...geometrySampleTimes(metadata, 10)]).toEqual([0, 0, 1, 0, .5, .4375, 0, 0]);
  });

  it('subtracts long timestamps before float conversion and preserves reverse ages', () => {
    const now = 1_000_000;
    const values = geometrySampleTimes({ interpolation: 'nearest', samples: [
      { delay: 0, currentInput: true, contributions: [] },
      { delay: .25, currentInput: false, contributions: [{ sourceTime: now + 1 / 120, weight: 1 }] },
    ] }, now);
    expect(values[5]).toBeCloseTo(-1 / 120, 8);
  });

  it('rejects unavailable or unordered time data instead of inventing frame timestamps', () => {
    expect(() => geometrySampleTimes({ interpolation: 'nearest', samples: [] }, 10)).toThrow(/resolved/);
    expect(() => geometrySampleTimes({ interpolation: 'linear', samples: [
      { delay: 1, currentInput: false, contributions: [] },
    ] }, 10)).toThrow(/weights/);
    expect(() => geometrySampleTimes({ interpolation: 'nearest', samples: [
      { delay: 1, currentInput: true, contributions: [] },
      { delay: 0, currentInput: true, contributions: [] },
    ] }, 10)).toThrow(/ordered/);
  });
});
