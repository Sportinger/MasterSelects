import { describe, expect, it } from 'vitest';
import type { CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { flowClosedCurves } from '../../src/services/operators/geometry/curveFlow';

const rectangle = (scale = 1): CurveSet => ({
  positions: Float32Array.from([0, 0, 0, 4, 0, 0, 4, 1, 0, 0, 1, 0, 0, 0, 0], n => n * scale),
  starts: Uint32Array.of(0), counts: Uint32Array.of(5), radius: Float32Array.of(1, 5, 6, 10, 1),
});

describe('distance-based closed curve flow', () => {
  it('moves by the same distance through unequal segments and differently sized loops', () => {
    const a = flowClosedCurves(rectangle(), .5, true);
    const b = flowClosedCurves(rectangle(2), .5, true);
    expect([...a.positions.slice(0, 3)]).toEqual([.5, 0, 0]);
    expect([...b.positions.slice(0, 3)]).toEqual([.5, 0, 0]);
    expect([...a.positions.slice(3, 6)]).toEqual([4, .5, 0]);
    expect([...a.positions.slice(6, 9)]).toEqual([3.5, 1, 0]);
    expect(a.radius![0]).toBe(1.5);
    expect([...a.positions.slice(-3)]).toEqual([...a.positions.slice(0, 3)]);
    expect(a.radius!.at(-1)).toBe(a.radius![0]);
  });
  it('wraps negative distance and leaves complete turns and zero travel unchanged', () => {
    const input = rectangle();
    expect([...flowClosedCurves(input, -.5, true).positions.slice(0, 3)]).toEqual([0, .5, 0]);
    for (const distance of [0, 10, -10, 20]) expect(flowClosedCurves(input, distance, true)).toEqual(input);
    expect(flowClosedCurves(input, .125).positions[0]).toBe(2);
    expect(flowClosedCurves(input, .125, false)).toEqual(flowClosedCurves(input, .125));
  });
  it('handles repeated interior vertices and collapsed loops without non-finite values', () => {
    const input: CurveSet = { positions: Float32Array.of(0,0,0, 0,0,0, 2,0,0, 0,0,0),
      starts: Uint32Array.of(0), counts: Uint32Array.of(4) };
    const moved = flowClosedCurves(input, .5, true);
    expect([...moved.positions.slice(0, 6)]).toEqual([.5,0,0, .5,0,0]);
    const collapsed = rectangle(); collapsed.positions.fill(0);
    expect(flowClosedCurves(collapsed, 100, true)).toEqual(collapsed);
    for (const distance of [NaN, Infinity, -Infinity])
      expect(() => flowClosedCurves(input, distance, true)).toThrow(/finite travel/);
  });
});
