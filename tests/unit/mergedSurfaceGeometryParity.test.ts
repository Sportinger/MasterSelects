import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { depthToMesh } from '../../src/services/operators/geometry/depthMesh';
import { mergeSurfaceMeshes } from '../../src/services/operators/geometry/mergeSurfaceMeshes';

describe('stitched depth surface parity', () => {
  // Captured before reducing per-edge depth samples and temporary vectors.
  const golden = {
    contained: '77df13b1a253e244a0b5856acb7c1581524cc5ff82ca7968e73ecbc12ea0a7a4',
    cropped: '510d886b4942ad6de30549104d4fed94b7ad43f44617cfc6dfb99ce40b7c3cfc',
    empty: 'c40366eb73b025087f5d4454a2b73272c15a5a3601da979b2466f4e7037eaa42',
  };
  it.each(['contained', 'cropped', 'empty'] as const)('preserves positions and topology for %s outlines', kind => {
    const vertices = kind === 'empty' ? [] : Array.from({ length: 36 }, (_, i) => {
      const angle = i / 36 * Math.PI * 2;
      const uv = [(kind === 'cropped' ? 0.05 : 0.5) + Math.cos(angle) * 0.27, 0.5 + Math.sin(angle) * 0.4];
      return { uv, position: [uv[0] * 2 - 1, 1 - uv[1] * 2, 0.2 + Math.sin(angle) * 0.08] };
    });
    const primary = { vertices, indices: [], outline: vertices.map((_, i) => i) };
    const background = depthToMesh(Float32Array.from({ length: 63 }, (_, i) => -0.3 + Math.sin(i) * 0.1),
      { width: 7, height: 9 }, [[-1, 1, 0], [1, 1, 0], [1, -1, 0], [-1, -1, 0]], [0, 0, 0], 1.3);
    const mesh = mergeSurfaceMeshes(primary, background, 0.08, 3);
    const hash = createHash('sha256').update(JSON.stringify(mesh)).digest('hex');
    expect(hash).toBe(golden[kind]);
    expect(mesh.vertices.every(v => v.position.every(Number.isFinite))).toBe(true);
  });
});
