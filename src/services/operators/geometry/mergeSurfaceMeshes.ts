import earcut from '../../../engine/native3d/assets/lib/earcut.js';
import { clipDepthSurface, depthSurfaceEdge as key, type DepthSurfacePoint } from './clipSurface';
import { joinMeshes, type SurfaceMesh } from './mesh';
import type { DepthMesh } from './depthMesh';

/** Cut the primary outline from a depth mesh and join at the exact primary positions.
 * Both branches retain their UVs; the transition modifies only the exterior.
 */
export function mergeSurfaceMeshes(primary: SurfaceMesh, background: DepthMesh, blendWidth = 0.05, subdivisions = 4) {
  subdivisions = Math.max(0, Math.min(5, Math.round(subdivisions)));
  const surface = background.samplePosition;
  const face = (primary.outline ?? []).map(i => primary.vertices[i]);
  const blendedSurface = (uv: number[]) => {
    const p = surface(uv); let distance = Infinity, correction = [0, 0, 0];
    let closest = -1, closestT = 0;
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length], dx = b.uv[0] - a.uv[0], dy = b.uv[1] - a.uv[1];
      const t = Math.max(0, Math.min(1, ((uv[0] - a.uv[0]) * dx + (uv[1] - a.uv[1]) * dy) / Math.max(1e-12, dx * dx + dy * dy)));
      const d = Math.hypot(uv[0] - (a.uv[0] + dx * t), uv[1] - (a.uv[1] + dy * t));
      if (d >= distance) continue;
      distance = d; closest = i; closestT = t;
    }
    // Only the nearest boundary contributes. Avoid reconstructing depth and
    // allocating vectors for every candidate edge at every subdivided vertex.
    if (closest !== -1) {
      const a = face[closest], b = face[(closest + 1) % face.length], t = closestT;
      const edgeUv = [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t];
      const estimated = surface(edgeUv);
      correction = a.position.map((x, j) => x + (b.position[j] - x) * t - estimated[j]);
    }
    const weight = Math.max(0, 1 - distance / Math.max(1e-6, blendWidth)), smooth = weight * weight * (3 - 2 * weight);
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
  for (let level = 0; level < (face.length ? subdivisions : Math.min(5, subdivisions + 1)); level++) {
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
      const a = indices[i], b = indices[i + 1], c = indices[i + 2], ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = next; boundary = nextBoundary;
  }
  const exterior = { vertices, indices };
  return { ...joinMeshes([primary, exterior]), exterior };
}
