import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { CABLE_SHADOW_NODES } from './cableData';
import { projectCableDepth } from './cableDepth';
import type { CablePoint } from './cablePhysics';
import { cableLightValue } from './cableLight';

const SIZE = 128;
type Params = Record<string, unknown>;

/** Orthographic light-space depth map of the tracked receiver, independent of the viewing camera. */
export function createCableShadowReceiver(points: CablePoint[], params: Params, triangles?: number[][]) {
  const sx = -Math.tan(cableLightValue(params, 'lightHorizontal') * Math.PI / 180);
  const sy = -Math.tan(cableLightValue(params, 'lightVertical') * Math.PI / 180);
  const vertices = points.slice(0, 468).map(p => ({ x: p.x + sx * (p.z ?? 0), y: p.y + sy * (p.z ?? 0), z: p.z ?? 0 }));
  const minX = Math.min(...vertices.map(p => p.x)), minY = Math.min(...vertices.map(p => p.y));
  const dx = (Math.max(...vertices.map(p => p.x)) - minX) / (SIZE - 1);
  const dy = (Math.max(...vertices.map(p => p.y)) - minY) / (SIZE - 1);
  const depth = new Float32Array(SIZE * SIZE).fill(-Infinity);
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const faces = triangles ?? Array.from({ length: edges.length / 3 }, (_, i) => [edges[i * 3].start, edges[i * 3].end, edges[i * 3 + 1].end]);
  if (dx > 0 && dy > 0) for (const indices of faces) {
    const [a, b, c] = indices.map(i => vertices[i]);
    if (!a || !b || !c) continue;
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / dx));
    const x1 = Math.min(SIZE - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / dx));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / dy));
    const y1 = Math.min(SIZE - 1, Math.ceil((Math.max(a.y, b.y, c.y) - minY) / dy));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = minX + x * dx, py = minY + y * dy;
      const u = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / den;
      const v = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / den;
      if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue;
      depth[y * SIZE + x] = Math.max(depth[y * SIZE + x], u * a.z + v * b.z + (1 - u - v) * c.z);
    }
  }
  return (p: CablePoint): { point: CablePoint; gap: number } | null => {
    if (!(dx > 0 && dy > 0)) return null;
    const u = p.x + sx * (p.z ?? 0), v = p.y + sy * (p.z ?? 0);
    const x = (u - minX) / dx, y = (v - minY) / dy;
    if (x < 0 || y < 0 || x > SIZE - 1 || y > SIZE - 1) return null;
    const ix = Math.min(SIZE - 2, Math.floor(x)), iy = Math.min(SIZE - 2, Math.floor(y));
    const samples = [depth[iy * SIZE + ix], depth[iy * SIZE + ix + 1], depth[(iy + 1) * SIZE + ix], depth[(iy + 1) * SIZE + ix + 1]];
    // Do not invent a receiving surface across the face silhouette or mesh holes.
    if (!samples.every(Number.isFinite)) return null;
    const tx = x - ix, ty = y - iy;
    const z = (samples[0] * (1 - tx) + samples[1] * tx) * (1 - ty) + (samples[2] * (1 - tx) + samples[3] * tx) * ty;
    const gap = (p.z ?? 0) - z;
    if (gap < -0.002) return null;
    return { point: { x: u - sx * z, y: v - sy * z, z }, gap: Math.max(0, gap) };
  };
}

/** Portable source-UV receiver hits. Negative gap marks missing rays; these never bridge into a shadow segment. */
export function writeCableShadows(data: Float32Array, offset: number, points: CablePoint[],
  receiver: ReturnType<typeof createCableShadowReceiver> | undefined, aspect: number,
  mapping: { toSource: (p: { x: number; y: number }) => { x: number; y: number } }) {
  const origin = mapping.toSource({ x: 0, y: 0 }), unit = mapping.toSource({ x: 0, y: 1 });
  const sourceScale = Math.hypot(unit.x - origin.x, unit.y - origin.y);
  for (let i = 0; i < CABLE_SHADOW_NODES; i++) {
    data[offset + i * 4 + 3] = -1;
    const t = i / (CABLE_SHADOW_NODES - 1) * (points.length - 1), index = Math.min(points.length - 2, Math.floor(t)), f = t - index;
    const a = points[index], b = points[index + 1];
    const hit = receiver?.({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * f });
    if (!hit) continue;
    const projected = projectCableDepth(hit.point, aspect);
    if (!projected) continue;
    const uv = mapping.toSource(projected);
    data.set([uv.x, uv.y, projected.scale, hit.gap * sourceScale], offset + i * 4);
  }
}
