import { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { LandmarkPoint } from '../landmarkTracking/types';
import type { CablePoint } from './cablePhysics';
import { projectCableDepth } from './cableDepth';

type Mapping = { toComposition: (p: { x: number; y: number }) => { x: number; y: number } };
export type FaceContact = (point: CablePoint, previous: CablePoint, radius: number) => void;
const SIZE = 96;

/** Relative MediaPipe depth, scaled with the clip; inverse projection keeps attachments on their landmarks. */
export function cableFacePoints(face: LandmarkPoint[], mapping: Mapping, aspect: number): CablePoint[] {
  const origin = mapping.toComposition({ x: 0, y: 0 });
  const unit = mapping.toComposition({ x: 1, y: 0 });
  const depthScale = Math.hypot((unit.x - origin.x) * aspect, unit.y - origin.y);
  const reference = ((face[234]?.z ?? 0) + (face[454]?.z ?? 0)) / 2;
  return face.map(p => {
    const uv = mapping.toComposition(p), z = (reference - (p.z ?? 0)) * depthScale;
    const scale = projectCableDepth({ x: 0, y: 0, z }, aspect)!.scale;
    return { x: aspect * (0.5 + (uv.x - 0.5) / scale), y: 0.5 + (uv.y - 0.5) / scale, z };
  });
}

/** Rasterized front surface: bounded per-frame work, constant-time contact per rope node. */
export function createFaceContact(points: CablePoint[], triangles?: number[][]): FaceContact {
  const vertices = points.slice(0, 468);
  const minX = Math.min(...vertices.map(p => p.x)), maxX = Math.max(...vertices.map(p => p.x));
  const minY = Math.min(...vertices.map(p => p.y)), maxY = Math.max(...vertices.map(p => p.y));
  const dx = (maxX - minX) / (SIZE - 1), dy = (maxY - minY) / (SIZE - 1);
  if (!(dx > 0 && dy > 0)) return () => {};
  const depth = new Float32Array(SIZE * SIZE).fill(-Infinity);
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const faces = triangles ?? Array.from({ length: edges.length / 3 }, (_, i) => [edges[i * 3].start, edges[i * 3].end, edges[i * 3 + 1].end]);
  for (const indices of faces) {
    const [a, b, c] = indices.map(i => points[i]);
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
      const z = u * (a.z ?? 0) + v * (b.z ?? 0) + (1 - u - v) * (c.z ?? 0);
      depth[y * SIZE + x] = Math.max(depth[y * SIZE + x], z);
    }
  }
  return (point, previous, radius) => {
    const x = (point.x - minX) / dx, y = (point.y - minY) / dy;
    if (x < 0 || y < 0 || x > SIZE - 1 || y > SIZE - 1) return;
    // Conservative neighboring samples bridge raster holes at triangle edges.
    const ix = Math.floor(x), iy = Math.floor(y);
    let z = -Infinity;
    for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      z = Math.max(z, depth[Math.min(SIZE - 1, iy + oy) * SIZE + Math.min(SIZE - 1, ix + ox)]);
    }
    z += radius;
    if ((point.z ?? 0) >= z) return;
    point.z = z;
    previous.z = z; // Remove inward velocity instead of bouncing through the surface.
    previous.x += (point.x - previous.x) * 0.15;
    previous.y += (point.y - previous.y) * 0.15;
  };
}
