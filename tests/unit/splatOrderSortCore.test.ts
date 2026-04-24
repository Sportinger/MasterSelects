import { describe, expect, it } from 'vitest';

import {
  buildSplatCenters,
  multiplyMat4ColumnMajor,
  sortSplatOrderByDepth,
} from '../../src/engine/gaussian/core/splatOrderSortCore.ts';
import { FLOATS_PER_SPLAT } from '../../src/engine/gaussian/loaders/types.ts';

const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function makeSplatData(positions: Array<[number, number, number]>): Float32Array {
  const data = new Float32Array(positions.length * FLOATS_PER_SPLAT);
  for (let i = 0; i < positions.length; i += 1) {
    const base = i * FLOATS_PER_SPLAT;
    const [x, y, z] = positions[i] ?? [0, 0, 0];
    data[base + 0] = x;
    data[base + 1] = y;
    data[base + 2] = z;
  }
  return data;
}

describe('splatOrderSortCore', () => {
  it('sorts splats back-to-front in right-handed view space', () => {
    const centers = buildSplatCenters(makeSplatData([
      [0, 0, -10],
      [0, 0, -1],
      [0, 0, -5],
    ]), 3);

    const result = sortSplatOrderByDepth(centers, IDENTITY, 3);

    expect([...result.order]).toEqual([0, 2, 1]);
    expect(result.count).toBe(3);
  });

  it('respects requested count so maxSplats budgets are sorted consistently', () => {
    const centers = buildSplatCenters(makeSplatData([
      [0, 0, -2],
      [0, 0, -8],
      [0, 0, -4],
      [0, 0, -20],
    ]), 4);

    const result = sortSplatOrderByDepth(centers, IDENTITY, 3);

    expect([...result.order]).toEqual([1, 2, 0]);
    expect(result.count).toBe(3);
  });

  it('uses the same column-major matrix multiplication convention as WGSL', () => {
    const view = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -5, 1,
    ]);
    const world = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -3, 1,
    ]);

    const combined = multiplyMat4ColumnMajor(view, world);

    expect(combined[14]).toBe(-8);
  });
});
