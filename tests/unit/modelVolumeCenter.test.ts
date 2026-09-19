import { describe, expect, it } from 'vitest';

import { computeModelVolumeCenter } from '../../src/engine/native3d/assets/modelVolumeCenter';
import type { ModelRuntimePrimitive } from '../../src/engine/native3d/assets/modelRuntimeCache/types';

function vertices(points: Array<[number, number, number]>): Float32Array {
  const result = new Float32Array(points.length * 8);
  points.forEach(([x, y, z], index) => {
    result[index * 8] = x;
    result[index * 8 + 1] = y;
    result[index * 8 + 2] = z;
  });
  return result;
}

function primitive(points: Array<[number, number, number]>, indices: number[]): ModelRuntimePrimitive {
  return {
    vertices: vertices(points),
    indices: new Uint32Array(indices),
    baseColor: [1, 1, 1, 1],
  };
}

describe('model volume center', () => {
  it('uses the volumetric centroid for a closed asymmetric mesh', () => {
    const tetrahedron = primitive(
      [[0, 0, 0], [4, 0, 0], [0, 2, 0], [0, 0, 1]],
      [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
    );

    const center = computeModelVolumeCenter([tetrahedron]);
    expect(center.x).toBeCloseTo(1);
    expect(center.y).toBeCloseTo(0.5);
    expect(center.z).toBeCloseTo(0.25);
  });

  it('falls back to the surface centroid for open geometry', () => {
    const triangle = primitive([[0, 0, 0], [6, 0, 0], [0, 3, 0]], [0, 1, 2]);
    expect(computeModelVolumeCenter([triangle])).toEqual({ x: 2, y: 1, z: 0 });
  });
});
