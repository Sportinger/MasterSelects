import { describe, expect, it } from 'vitest';
import { marchingSquaresTopology, type MarchingSquaresOccupancy } from '../../src/services/operators/marchingSquaresTopology';

const top = [0, 0] as const, right = [1, 0] as const, bottom = [1, 1] as const, left = [0, 1] as const;
const edges = { top, right, bottom, left };
const expected = [
  [top, top, top, top, 0], [left, top, top, top, 1], [top, right, top, top, 1], [left, right, top, top, 1],
  [right, bottom, top, top, 1], [left, top, right, bottom, 2], [top, bottom, top, top, 1], [left, bottom, top, top, 1],
  [left, bottom, top, top, 1], [top, bottom, top, top, 1], [top, right, bottom, left, 2], [right, bottom, top, top, 1],
  [left, right, top, top, 1], [top, right, top, top, 1], [left, top, top, top, 1], [top, top, top, top, 0],
] as const;

describe('marching-squares topology', () => {
  it('preserves the exact fixed topology for all sixteen masks', () => {
    for (let mask = 0; mask < 16; mask++) {
      const occupancy = [0, 1, 2, 3].map(bit => (mask >> bit) & 1) as unknown as readonly [MarchingSquaresOccupancy, MarchingSquaresOccupancy, MarchingSquaresOccupancy, MarchingSquaresOccupancy];
      const result = marchingSquaresTopology(occupancy, edges), value = expected[mask];
      expect([result.a, result.b, result.c, result.d, result.count], `mask ${mask}`).toEqual(value);
    }
  });

  it('keeps the two ambiguous pairings for masks five and ten', () => {
    expect(marchingSquaresTopology([1, 0, 1, 0], edges)).toEqual({ a: left, b: top, c: right, d: bottom, count: 2 });
    expect(marchingSquaresTopology([0, 1, 0, 1], edges)).toEqual({ a: top, b: right, c: bottom, d: left, count: 2 });
  });

  it('rejects non-binary runtime input rather than silently changing the mask', () => {
    expect(() => marchingSquaresTopology([0, 1, 2 as 1, 0], edges)).toThrow(/binary/);
  });
});
