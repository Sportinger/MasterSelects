import { describe, it, expect } from 'vitest';
import {
  positionToValue,
  valueToPosition,
} from '../../src/components/panels/properties/synthSections/sliderScale';

describe('sliderScale', () => {
  it('log taper gives equal travel per octave (cutoff 20..18000)', () => {
    // The geometric midpoint sqrt(20*18000) sits at position 0.5.
    const mid = Math.sqrt(20 * 18000);
    expect(valueToPosition(mid, 20, 18000, 'log')).toBeCloseTo(0.5, 6);
    // One octave (doubling) is a constant position delta anywhere.
    const d1 = valueToPosition(200, 20, 18000, 'log') - valueToPosition(100, 20, 18000, 'log');
    const d2 = valueToPosition(2000, 20, 18000, 'log') - valueToPosition(1000, 20, 18000, 'log');
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('power taper reaches min=0 and gives more low-end resolution (gain)', () => {
    expect(positionToValue(0, 0, 1, 'power', 2)).toBe(0);
    expect(positionToValue(1, 0, 1, 'power', 2)).toBe(1);
    expect(positionToValue(0.5, 0, 1, 'power', 2)).toBeCloseTo(0.25, 6); // half travel → quarter value
  });

  it('round-trips value → position → value for every scale', () => {
    for (const [v, min, max, scale] of [
      [1200, 20, 18000, 'log'],
      [0.3, 0, 1, 'power'],
      [2.5, 0, 4, 'power'],
      [7, 0, 24, 'linear'],
    ] as const) {
      const pos = valueToPosition(v, min, max, scale);
      expect(positionToValue(pos, min, max, scale)).toBeCloseTo(v, 4);
    }
  });

  it('log falls back to linear when the range includes 0', () => {
    expect(valueToPosition(0.5, 0, 1, 'log')).toBeCloseTo(0.5, 6);
  });
});
