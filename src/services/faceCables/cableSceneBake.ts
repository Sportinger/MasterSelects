import { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { ClipTransform } from '../../types';
import type { LandmarkPoint } from '../landmarkTracking/types';
import type { CablePoint } from './cablePhysics';
import type { FaceCableConfig } from './cableData';
import { cableSceneLayout, encodeCableScene, MAX_CABLE_SCENE_FLOATS, type CableSceneBake } from './cableSceneData';
import { getEffectiveScale } from '../../utils/transformScale';
import type { CableDepthGrid } from './cableSceneDepth';
import type { CableSurfacePlan } from './cableSceneData';
import { landmarksToMesh } from '../operators/geometry/mesh';

// Match the existing virtual camera's Z scale to the shared scene's default 50-degree camera.
const Z_SCALE = 0.5 / Math.tan(25 * Math.PI / 180);
function depthBindingMatches(previous: string | undefined, current: string | undefined) {
  if (previous === undefined || previous === current) return true;
  try {
    const old = JSON.parse(previous), next = JSON.parse(current ?? 'null');
    // Before the explicit calibration node, reference-face calibration was always enabled.
    return JSON.stringify({ ...old, referenceFace: old.referenceFace ?? true }) === JSON.stringify(next);
  } catch { return false; }
}
export function cableSceneLocalPoint(p: CablePoint, transform: ClipTransform, aspect: number) {
  const scale = getEffectiveScale(transform.scale), a = transform.anchor ?? { x: 0, y: 0, z: 0 };
  const angle = transform.rotation.z * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const x = (p.x - aspect * 0.5) * 2 - transform.position.x;
  const y = (0.5 - p.y) * 2 - transform.position.y;
  return { x: (cos * x + sin * y) / scale.x + a.x, y: (-sin * x + cos * y) / scale.y + a.y,
    z: ((p.z ?? 0) * Z_SCALE - transform.position.z) / (scale.z ?? 1) + a.z };
}
export function createCableSceneBake(cables: FaceCableConfig[], fps: number, frames: number, duration: number, aspect: number, depthGrid?: CableDepthGrid, depthBinding?: string, surface?: CableSurfacePlan) {
  const layout = cableSceneLayout(cables, depthGrid);
  if (layout.stride * frames > MAX_CABLE_SCENE_FLOATS) throw new Error('3D cable geometry is too large; shorten the clip or use fewer segments.');
  const data = new Float32Array(layout.stride * frames);
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const triangles = Array.from({ length: edges.length / 3 }, (_, i) => [edges[i * 3].start, edges[i * 3].end, edges[i * 3 + 1].end]).flat();
  const outline = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(e => e.start);
  const scene: CableSceneBake = { version: depthGrid ? 2 : 1, depthGrid, depthBinding, surface, cables, fps, frames, duration, triangles, outline, data };
  return {
    scene,
    reuseDepth(frame: number, previous: CableSceneBake) {
      if (!depthGrid || !previous.depthGrid || previous.frames !== frames || previous.fps !== fps || previous.duration !== duration
        || previous.depthGrid.width !== depthGrid.width || previous.depthGrid.height !== depthGrid.height
        || !depthBindingMatches(previous.depthBinding, depthBinding)) throw new Error('Saved depth no longer matches this clip. Use Bake cables to estimate fresh depth.');
      const oldLayout = cableSceneLayout(previous.cables, previous.depthGrid), base = frame * layout.stride, oldBase = frame * oldLayout.stride;
      // Also supports older depth artifacts without a binding: prove identical tracked pose and mapping for every frame.
      for (let i = 0; i < 2361; i++) if (Math.abs(data[base + i] - previous.data[oldBase + i]) > 1e-5) {
        throw new Error('The face track or image mapping changed. Use Bake cables to estimate fresh depth.');
      }
      const start = oldBase + oldLayout.depthOffset;
      data.set(previous.data.subarray(start, start + 4 + depthGrid.width * depthGrid.height), base + layout.depthOffset);
    },
    writeDepth(frame: number, values: Float32Array, transform: ClipTransform) {
      if (!depthGrid || values.length !== depthGrid.width * depthGrid.height) throw new Error('Invalid scene depth grid.');
      const origin = cableSceneLocalPoint({ x: aspect / 2, y: 0.5, z: 0 }, transform, aspect);
      const offset = frame * layout.stride + layout.depthOffset;
      data.set([origin.x, origin.y, origin.z, Z_SCALE / (getEffectiveScale(transform.scale).z ?? 1)], offset);
      data.set(values, offset + 4);
    },
    writeFace(frame: number, face: LandmarkPoint[] | undefined, points: CablePoint[] | undefined, transform: ClipTransform,
      mapping: { toComposition: (p: { x: number; y: number }) => { x: number; y: number } }) {
      const base = frame * layout.stride;
      data[base] = face?.length && points?.length ? 1 : 0;
      const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
      corners.forEach((uv, i) => {
        const p = mapping.toComposition(uv), local = cableSceneLocalPoint({ x: p.x * aspect, y: p.y, z: 0 }, transform, aspect);
        data.set([local.x, local.y, local.z, uv.x, uv.y], base + 1 + i * 5);
      });
      if (!face || !points) return;
      const positions = points.slice(0, 468).map(point => { const p = cableSceneLocalPoint(point, transform, aspect); return [p.x, p.y, p.z]; });
      const mesh = landmarksToMesh(face, positions, triangles, outline);
      mesh.vertices.forEach((v, i) => data.set([...v.position, ...v.uv], base + 21 + i * 5));
    },
    writeCable(frame: number, index: number, points: CablePoint[], config: FaceCableConfig, transform: ClipTransform) {
      const base = frame * layout.stride + layout.offsets[index];
      const scale = getEffectiveScale(transform.scale);
      data.set([1, config.width / 1080 / Math.max(0.001, Math.abs(scale.y)),
        ...[1, 3, 5].map(i => parseInt(config.color.slice(i, i + 2), 16) / 255), config.renderStyle === 'flat' ? 1 : 0], base);
      points.forEach((point, i) => { const p = cableSceneLocalPoint(point, transform, aspect); data.set([p.x, p.y, p.z], base + 6 + i * 3); });
    },
    encode: () => encodeCableScene(scene),
  };
}
