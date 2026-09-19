import { describe, expect, it } from 'vitest';
import { FLOCK_MODEL_MAX_TRIANGLES, buildFlockInstanceMeshFromModel } from '../../src/engine/flock/gpu/flockModelMeshes';

function primitive(vertices: number[][], indices: number[]) {
  const data = new Float32Array(vertices.length * 8);
  vertices.forEach((vertex, index) => data.set([vertex[0], vertex[1], vertex[2], 0, 0, 1, 0, 0], index * 8));
  return { vertices: data, indices: Uint32Array.from(indices), baseColor: [1, 1, 1, 1] as never };
}

describe('flock model instance meshes', () => {
  it('flattens indexed interleaved primitives and normalizes the longest extent to 2', () => {
    const { mesh, decimated } = buildFlockInstanceMeshFromModel({
      primitives: [primitive([[10, 0, 0], [14, 0, 0], [10, 1, 0]], [0, 1, 2])],
    });
    expect(decimated).toBe(false);
    expect(mesh.vertexCount).toBe(3);
    const xs = [mesh.vertices[0], mesh.vertices[6], mesh.vertices[12]];
    expect(Math.min(...xs)).toBeCloseTo(-1, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
    expect(mesh.vertices[5]).toBeCloseTo(1, 5);
  });

  it('decimates dense models deterministically to the triangle cap', () => {
    const triangles = FLOCK_MODEL_MAX_TRIANGLES * 2 + 3;
    const vertices: number[][] = [];
    const indices: number[] = [];
    for (let t = 0; t < triangles; t += 1) {
      const base = vertices.length;
      vertices.push([t, 0, 0], [t + 1, 0, 0], [t, 1, 0]);
      indices.push(base, base + 1, base + 2);
    }
    const first = buildFlockInstanceMeshFromModel({ primitives: [primitive(vertices, indices)] });
    const second = buildFlockInstanceMeshFromModel({ primitives: [primitive(vertices, indices)] });
    expect(first.decimated).toBe(true);
    expect(first.mesh.vertexCount / 3).toBeLessThanOrEqual(FLOCK_MODEL_MAX_TRIANGLES);
    expect(Array.from(first.mesh.vertices.slice(0, 60))).toEqual(Array.from(second.mesh.vertices.slice(0, 60)));
  });
});
