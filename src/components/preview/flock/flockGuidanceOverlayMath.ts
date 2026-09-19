import type { SceneCamera, SceneViewport } from '../../../engine/scene/types';
import { buildSceneWorldMatrix } from '../../../engine/scene/SceneTransformUtils';
import { FLOCK_SIM_TO_WORLD } from '../../../engine/flock/gpu/flockRenderPacking';
import type { ClipTransform } from '../../../types/timelineCore';
import { createFlockProperty, type FlockProperty } from '../../../types/flock';
import { getEffectiveScale } from '../../../utils/transformScale';

/**
 * Pure math for flock guidance handles in the 3D preview. Simulation space is
 * mapped to the shared scene exactly like the flock render passes: clip world
 * matrix × FLOCK_SIM_TO_WORLD, then the shared scene camera.
 */

export type Vec3 = [number, number, number];

export interface CanvasSize {
  width: number;
  height: number;
}

export interface GuidanceScreenPoint {
  x: number;
  y: number;
  visible: boolean;
  depth: number;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Sim-space → shared-scene world matrix for a flock clip transform. */
export function buildFlockSimToWorldMatrix(transform: Pick<ClipTransform, 'position' | 'rotation' | 'scale'> & { anchor?: ClipTransform['anchor'] }): Float64Array {
  const scale = getEffectiveScale(transform.scale);
  const world = buildSceneWorldMatrix({
    position: transform.position,
    anchor: transform.anchor ?? { x: 0, y: 0, z: 0 },
    rotationRadians: {
      x: degreesToRadians(transform.rotation.x),
      y: degreesToRadians(transform.rotation.y),
      z: degreesToRadians(transform.rotation.z),
    },
    rotationDegrees: transform.rotation,
    scale: { x: scale.x, y: scale.y, z: scale.z ?? 1 },
  });
  const simScale = [
    FLOCK_SIM_TO_WORLD, 0, 0, 0,
    0, FLOCK_SIM_TO_WORLD, 0, 0,
    0, 0, FLOCK_SIM_TO_WORLD, 0,
    0, 0, 0, 1,
  ];
  return multiplyMat4(world, simScale);
}

export function transformPoint(matrix: ArrayLike<number>, point: Vec3): Vec3 {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] || 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ];
}

export function invertMat4(m: ArrayLike<number>): Float64Array | null {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  for (let index = 0; index < 16; index += 1) inv[index] /= det;
  return inv;
}

/** World point → preview canvas pixels (same convention as projectWorldToCanvas). */
export function projectWorldPoint(point: Vec3, camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>, canvasSize: CanvasSize): GuidanceScreenPoint {
  const viewProj = multiplyMat4(camera.projectionMatrix, camera.viewMatrix);
  const [x, y, z] = point;
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const cz = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
  const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (Math.abs(w) < 1e-6) return { x: 0, y: 0, visible: false, depth: w };
  const ndcX = cx / w;
  const ndcY = cy / w;
  const ndcZ = cz / w;
  return {
    x: (ndcX * 0.5 + 0.5) * canvasSize.width,
    y: (0.5 - ndcY * 0.5) * canvasSize.height,
    visible: w > 0 && ndcZ >= -1.1 && ndcZ <= 1.1 && Math.abs(ndcX) <= 1.2 && Math.abs(ndcY) <= 1.2,
    depth: w,
  };
}

export function projectSimPoint(
  simToWorld: ArrayLike<number>,
  sim: Vec3,
  camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>,
  canvasSize: CanvasSize,
): GuidanceScreenPoint {
  return projectWorldPoint(transformPoint(simToWorld, sim), camera, canvasSize);
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** Preview canvas pixel → world-space ray through the shared scene camera. */
export function canvasPointToWorldRay(
  camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>,
  canvasSize: CanvasSize,
  x: number,
  y: number,
): Ray | null {
  const inverse = invertMat4(multiplyMat4(camera.projectionMatrix, camera.viewMatrix));
  if (!inverse || canvasSize.width <= 0 || canvasSize.height <= 0) return null;
  const ndcX = (x / canvasSize.width) * 2 - 1;
  const ndcY = 1 - (y / canvasSize.height) * 2;
  // Two depths inside the frustum for both [-1,1] and [0,1] depth conventions.
  const near = transformPoint(inverse, [ndcX, ndcY, 0]);
  const far = transformPoint(inverse, [ndcX, ndcY, 0.5]);
  const direction: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return { origin: near, direction: [direction[0] / length, direction[1] / length, direction[2] / length] };
}

/** World-space camera forward (the view looks down its local -Z). */
export function cameraForward(camera: Pick<SceneCamera, 'viewMatrix'>): Vec3 {
  const view = camera.viewMatrix;
  const forward: Vec3 = [-view[2], -view[6], -view[10]];
  const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  return [forward[0] / length, forward[1] / length, forward[2] / length];
}

export function intersectPlane(ray: Ray, planePoint: Vec3, normal: Vec3): Vec3 | null {
  const denominator = ray.direction[0] * normal[0] + ray.direction[1] * normal[1] + ray.direction[2] * normal[2];
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((planePoint[0] - ray.origin[0]) * normal[0]
    + (planePoint[1] - ray.origin[1]) * normal[1]
    + (planePoint[2] - ray.origin[2]) * normal[2]) / denominator;
  return [ray.origin[0] + ray.direction[0] * t, ray.origin[1] + ray.direction[1] * t, ray.origin[2] + ray.direction[2] * t];
}

/**
 * New sim-space position for a dragged handle: the pointer (minus the grab
 * offset) is intersected with the camera-facing plane through the handle's
 * start position.
 */
export function dragSimPosition(input: {
  camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>;
  canvasSize: CanvasSize;
  simToWorld: ArrayLike<number>;
  startSim: Vec3;
  pointer: { x: number; y: number };
}): Vec3 | null {
  const ray = canvasPointToWorldRay(input.camera, input.canvasSize, input.pointer.x, input.pointer.y);
  if (!ray) return null;
  const planePoint = transformPoint(input.simToWorld, input.startSim);
  const hit = intersectPlane(ray, planePoint, cameraForward(input.camera));
  const inverse = hit ? invertMat4(input.simToWorld) : null;
  if (!hit || !inverse) return null;
  const sim = transformPoint(inverse, hit);
  return sim.every((component) => Number.isFinite(component)) ? sim : null;
}

export interface FlockComponentWrite {
  property: FlockProperty;
  value: number;
}

/** Only changed vector components are written, each on its own keyframeable property. */
export function flockVectorComponentWrites(
  ownerNodeId: string,
  paramKey: string,
  previous: Vec3,
  next: Vec3,
  epsilon = 1e-6,
): FlockComponentWrite[] {
  const components = ['x', 'y', 'z'] as const;
  const writes: FlockComponentWrite[] = [];
  components.forEach((component, index) => {
    if (Math.abs(next[index] - previous[index]) <= epsilon) return;
    writes.push({ property: createFlockProperty(ownerNodeId, paramKey, component), value: next[index] });
  });
  return writes;
}

/** Arrow keys nudge sim X / Y, PageUp/PageDown nudge Z; Shift multiplies by 10. */
export function flockNudgeDelta(key: string, shift: boolean): Vec3 | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return [-step, 0, 0];
    case 'ArrowRight': return [step, 0, 0];
    case 'ArrowUp': return [0, step, 0];
    case 'ArrowDown': return [0, -step, 0];
    case 'PageUp': return [0, 0, step];
    case 'PageDown': return [0, 0, -step];
    default: return null;
  }
}

export function isViewportUsable(viewport: SceneViewport | null | undefined): viewport is SceneViewport {
  return !!viewport && viewport.width > 0 && viewport.height > 0;
}
