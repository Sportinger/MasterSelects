import { meshCollision } from '../operators/geometry/meshCollision';
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

/** MediaPipe topology adapter. The collider itself accepts any indexed mesh. */
export function createFaceContact(points: CablePoint[], triangles?: number[][], size = SIZE): FaceContact {
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  return meshCollision(triangles ? points : points.slice(0, 468), triangles ?? Array.from({ length: edges.length / 3 }, (_, i) =>
    [edges[i * 3].start, edges[i * 3].end, edges[i * 3 + 1].end]), size);
}
