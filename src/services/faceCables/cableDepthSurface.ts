import earcut from '../../engine/native3d/assets/lib/earcut.js';
import { cableSceneLayout, type CableSceneBake } from './cableSceneData';
import { sampleCableDepth } from './cableSceneDepth';
import { clipDepthSurface, depthSurfaceEdge as key, type DepthSurfacePoint } from './cableDepthSurfaceClipping';

/** A conforming textured surface with an actual face-shaped hole, welded to MediaPipe XYZ. */
export function buildCableDepthGeometry(bake: CableSceneBake, base: number) {
  const grid = bake.depthGrid!;
  const offset = base + cableSceneLayout(bake.cables, grid).depthOffset, data = bake.data;
  const values = data.subarray(offset + 4, offset + 4 + grid.width * grid.height);
  const corners = Array.from({ length: 4 }, (_, i) => Array.from(data.subarray(base + 1 + i * 5, base + 4 + i * 5)));
  const surface = (uv: number[]) => {
    const [u, v] = uv, z = sampleCableDepth(values, grid, u, v);
    const flat = [0, 1, 2].map(j => (corners[0][j] * (1 - u) + corners[1][j] * u) * (1 - v)
      + (corners[3][j] * (1 - u) + corners[2][j] * u) * v);
    return [data[offset] + (flat[0] - data[offset]) * (1 - z / 2),
      data[offset + 1] + (flat[1] - data[offset + 1]) * (1 - z / 2), data[offset + 2] + z * data[offset + 3]];
  };
  const face = data[base] ? bake.outline.map(i => {
    const o = base + 21 + i * 5;
    return { position: Array.from(data.subarray(o, o + 3)), uv: Array.from(data.subarray(o + 3, o + 5)) };
  }) : [];
  const blendedSurface = (uv: number[]) => {
    const p = surface(uv); let distance = Infinity, correction = [0, 0, 0];
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length], dx = b.uv[0] - a.uv[0], dy = b.uv[1] - a.uv[1];
      const t = Math.max(0, Math.min(1, ((uv[0] - a.uv[0]) * dx + (uv[1] - a.uv[1]) * dy) / Math.max(1e-12, dx * dx + dy * dy)));
      const edgeUv = a.uv.map((x, j) => x + (b.uv[j] - x) * t), d = Math.hypot(uv[0] - edgeUv[0], uv[1] - edgeUv[1]);
      if (d >= distance) return;
      distance = d;
      const estimated = surface(edgeUv);
      correction = a.position.map((x, j) => x + (b.position[j] - x) * t - estimated[j]);
    });
    const weight = Math.max(0, 1 - distance / 0.05), smooth = weight * weight * (3 - 2 * weight);
    return p.map((x, j) => x + correction[j] * smooth);
  };
  const cropped = face.some(p => p.uv.some(v => v <= 0 || v >= 1));
  // Earcut needs a contained hole. Triangulate in an enclosing rectangle first,
  // then clip its triangles back to the actual image (also handles a fully offscreen face).
  const minU = cropped ? Math.min(0, ...face.map(p => p.uv[0] - 0.01)) : 0;
  const minV = cropped ? Math.min(0, ...face.map(p => p.uv[1] - 0.01)) : 0;
  const maxU = cropped ? Math.max(1, ...face.map(p => p.uv[0] + 0.01)) : 1;
  const maxV = cropped ? Math.max(1, ...face.map(p => p.uv[1] + 0.01)) : 1;
  const vertices: DepthSurfacePoint[] = [[minU, minV], [maxU, minV], [maxU, maxV], [minU, maxV]].map(uv => ({ uv, position: blendedSurface(uv) }));
  vertices.push(...face);
  let indices = earcut(vertices.flatMap(p => p.uv), face.length ? [4] : undefined);
  let boundary = new Set(face.map((_, i) => key(4 + i, 4 + (i + 1) % face.length)));
  if (cropped) indices = clipDepthSurface(vertices, indices, boundary, blendedSurface);
  // Subdivide all triangles together so adjacent faces share every new edge vertex.
  // Five rounds for an empty face keep the untracked background sufficiently detailed too.
  for (let level = 0; level < (face.length ? 4 : 5); level++) {
    const midpoints = new Map<string, number>(), nextBoundary = new Set<string>(), next: number[] = [];
    const midpoint = (a: number, b: number) => {
      const edge = key(a, b), cached = midpoints.get(edge); if (cached !== undefined) return cached;
      const uv = vertices[a].uv.map((v, j) => (v + vertices[b].uv[j]) / 2);
      const onFace = boundary.has(edge), index = vertices.length;
      vertices.push({ uv, position: onFace ? vertices[a].position.map((v, j) => (v + vertices[b].position[j]) / 2) : blendedSurface(uv) });
      if (onFace) { nextBoundary.add(key(a, index)); nextBoundary.add(key(index, b)); }
      midpoints.set(edge, index); return index;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3), ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = next; boundary = nextBoundary;
  }
  return { vertices, indices };
}
