import type { SurfaceMesh } from './mesh';

export interface DepthMesh extends SurfaceMesh {
  /** A continuous reconstruction is retained for seam subdivision; this is never project data. */
  samplePosition: (uv: number[]) => number[];
}

/** Depth values, image-plane corners and projection are independent of any effect or tracker. */
export function depthToMesh(values: Float32Array, grid: { width: number; height: number }, corners: number[][],
  origin: number[], zScale: number): DepthMesh {
  if (grid.width < 2 || grid.height < 2 || values.length !== grid.width * grid.height || !values.every(Number.isFinite)) throw new Error('Invalid depth mesh.');
  const samplePosition = (uv: number[]) => {
    const [u, v] = uv, x = Math.max(0, Math.min(1, u)) * (grid.width - 1), y = Math.max(0, Math.min(1, v)) * (grid.height - 1);
    const ix = Math.min(grid.width - 2, Math.floor(x)), iy = Math.min(grid.height - 2, Math.floor(y)), tx = x - ix, ty = y - iy, at = iy * grid.width + ix;
    const z = (values[at] * (1 - tx) + values[at + 1] * tx) * (1 - ty)
      + (values[at + grid.width] * (1 - tx) + values[at + grid.width + 1] * tx) * ty;
    const flat = [0, 1, 2].map(j => (corners[0][j] * (1 - u) + corners[1][j] * u) * (1 - v)
      + (corners[3][j] * (1 - u) + corners[2][j] * u) * v);
    return [origin[0] + (flat[0] - origin[0]) * (1 - z / 2), origin[1] + (flat[1] - origin[1]) * (1 - z / 2), origin[2] + z * zScale];
  };
  const vertices = Array.from({ length: grid.width * grid.height }, (_, i) => {
    const uv = [(i % grid.width) / (grid.width - 1), Math.floor(i / grid.width) / (grid.height - 1)];
    return { uv, position: samplePosition(uv) };
  });
  const indices: number[] = [];
  for (let y = 0; y < grid.height - 1; y++) for (let x = 0; x < grid.width - 1; x++) {
    const a = y * grid.width + x; indices.push(a, a + grid.width + 1, a + 1, a, a + grid.width, a + grid.width + 1);
  }
  return { vertices, indices, samplePosition };
}
