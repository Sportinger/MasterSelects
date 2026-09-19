import { describe, expect, it } from 'vitest';
import { isRetainedTerrainMesh } from '../../src/services/planarTracking/immutableTerrainMesh';
import { pickTerrainPoint } from '../../src/services/planarTracking/terrainPlacement';
import { getTerrainSurfaceReconstruction } from '../../src/services/planarTracking/terrainSurfaceMesh';
import type {
  DenseTerrainMesh,
  TerrainReconstruction,
  TerrainVertex,
  TerrainVector,
} from '../../src/types/terrainTracking';

const camera: TerrainReconstruction['cameras'][number] = {
  time: 0,
  duration: 1 / 30,
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
  error: 0,
  observations: 4,
};

function terrain(vertices: TerrainVertex[] = [], triangles: number[] = []): TerrainReconstruction {
  return {
    version: 1,
    solver: 'browser-sfm',
    referenceTime: 0,
    intrinsics: { width: 100, height: 100, fx: 100, fy: 100, cx: 50, cy: 50 },
    cameras: [camera],
    vertices,
    triangles,
    sourceFrameCount: 1,
    sparsePointCount: vertices.length,
    medianError: 0,
  };
}

function vertex(position: TerrainVector, uv: [number, number], q = 1): TerrainVertex {
  return { position, uvq: [uv[0] * q, uv[1] * q, q] };
}

function denseMesh(): DenseTerrainMesh {
  return {
    positions: [-1, -1, 4, 1, -1, 4, 1, 1, 4],
    indices: [0, 1, 2],
    origin: [0, 0, 4],
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    normal: [0, 0, 1],
    size: [2, 2],
  };
}

function expectOrthonormal(mesh: DenseTerrainMesh): void {
  const dot = (left: TerrainVector, right: TerrainVector) => left.reduce(
    (sum, value, index) => sum + value * right[index]!,
    0,
  );
  expect(Math.hypot(...mesh.axisX)).toBeCloseTo(1);
  expect(Math.hypot(...mesh.axisY)).toBeCloseTo(1);
  expect(Math.hypot(...mesh.normal)).toBeCloseTo(1);
  expect(dot(mesh.axisX, mesh.axisY)).toBeCloseTo(0);
  expect(dot(mesh.axisX, mesh.normal)).toBeCloseTo(0);
  expect(dot(mesh.axisY, mesh.normal)).toBeCloseTo(0);
}

describe('terrain surface mesh promotion', () => {
  it('returns an existing dense reconstruction unchanged and retains its mesh', () => {
    const input = { ...terrain(), denseMesh: denseMesh() };

    const resolved = getTerrainSurfaceReconstruction(input);

    expect(resolved).toBe(input);
    expect(resolved.denseMesh).toBe(input.denseMesh);
    expect(isRetainedTerrainMesh(resolved.denseMesh!)).toBe(true);
  });

  it('promotes only observed sparse triangles, caches the result, and enables raycasts', () => {
    const input = terrain([
      vertex([-1, -1, 4], [0, 0]),
      vertex([1, -1, 4], [1, 0]),
      vertex([1, 1, 4], [1, 1]),
      vertex([-1, 1, 4], [0, 1]),
    ], [0, 1, 2, 0, 2, 3, 0, 99, 1, 0, 0, 1]);

    const resolved = getTerrainSurfaceReconstruction(input);
    const mesh = resolved.denseMesh!;

    expect(resolved).not.toBe(input);
    expect(getTerrainSurfaceReconstruction(input)).toBe(resolved);
    expect(mesh.positions).toEqual(input.vertices.flatMap((item) => item.position));
    expect(mesh.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.origin).toEqual([0, 0, 4]);
    expect(mesh.axisX).toEqual([1, 0, 0]);
    expect(mesh.axisY).toEqual([0, 1, 0]);
    expect(mesh.size[0]).toBeCloseTo(2);
    expect(mesh.size[1]).toBeCloseTo(2);
    expect(isRetainedTerrainMesh(mesh)).toBe(true);
    expect(pickTerrainPoint(resolved, camera, { x: 0.5, y: 0.5 })).toEqual([0, 0, 4]);
  });

  it('uses the largest observed triangle when reference UV covariance is degenerate', () => {
    const input = terrain([
      vertex([0, 0, 4], [0, 0], 0),
      vertex([0, 2, 4], [0, 0], 0),
      vertex([0, 0, 6], [0, 0], 0),
      vertex([0, 0.1, 4], [0, 0], 0),
    ], [0, 1, 2, 0, 3, 2]);

    const mesh = getTerrainSurfaceReconstruction(input).denseMesh!;

    expectOrthonormal(mesh);
    const longestTriangleEdge: TerrainVector = [0, -2, 2];
    const alignment = Math.abs(mesh.axisX.reduce(
      (sum, value, index) => sum + value * longestTriangleEdge[index]!,
      0,
    )) / Math.hypot(...longestTriangleEdge);
    expect(alignment).toBeCloseTo(1);
    const local = input.vertices.map((item) => {
      const delta = item.position.map((value, index) => value - mesh.origin[index]!) as TerrainVector;
      return [
        delta.reduce((sum, value, index) => sum + value * mesh.axisX[index]!, 0),
        delta.reduce((sum, value, index) => sum + value * mesh.axisY[index]!, 0),
      ];
    });
    for (const axis of [0, 1]) {
      expect(Math.min(...local.map((point) => point[axis]!))).toBeCloseTo(-mesh.size[axis]! / 2);
      expect(Math.max(...local.map((point) => point[axis]!))).toBeCloseTo(mesh.size[axis]! / 2);
    }
  });

  it('falls back to the first real footstep patch and leaves empty terrain unchanged', () => {
    const patch = denseMesh();
    const withPatch = {
      ...terrain(),
      footsteps: [{
        id: 'step-1',
        name: 'Step',
        placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
        mesh: patch,
      }],
    };
    const resolved = getTerrainSurfaceReconstruction(withPatch);

    expect(resolved.denseMesh).toBe(patch);
    expect(getTerrainSurfaceReconstruction(withPatch)).toBe(resolved);

    const empty = terrain();
    expect(getTerrainSurfaceReconstruction(empty)).toBe(empty);
    expect(empty.denseMesh).toBeUndefined();
  });
});
