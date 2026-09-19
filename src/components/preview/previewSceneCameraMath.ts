import {
  resolveOrbitCameraFrame,
  type OrbitCameraFrame,
} from '../../engine/gaussian/core/SplatCameraUtils';
import type { SceneVector3 } from '../../engine/scene/types';
import type { ClipTransform } from '../../types/timelineCore';

export const EDIT_CAMERA_ORTHO_MIN_SCALE = 0.05;
export const EDIT_CAMERA_ORTHO_MAX_SCALE = 10000;

export type EditCameraViewMode = 'camera' | 'front' | 'side' | 'top';
export type EditCameraOrthoViewMode = Exclude<EditCameraViewMode, 'camera'>;

export function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

export function cloneSceneVector(vector: SceneVector3): SceneVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function addSceneVectors(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleSceneVector(vector: SceneVector3, scale: number): SceneVector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function getSceneBoundsCenter(
  bounds: { min: [number, number, number]; max: [number, number, number] } | undefined,
): SceneVector3 {
  if (!bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.min[0] + bounds.max[0]) * 0.5,
    y: (bounds.min[1] + bounds.max[1]) * 0.5,
    z: (bounds.min[2] + bounds.max[2]) * 0.5,
  };
}

export function resolveSceneNavigationOrbit(
  transform: ClipTransform,
  settings: {
    nearPlane: number;
    farPlane: number;
    fov: number;
    minimumDistance: number;
  },
  viewport: { width: number; height: number },
  sceneBounds?: { min: [number, number, number]; max: [number, number, number] },
  targetPivot?: SceneVector3,
): { pivot: SceneVector3; radius: number; localOffset: SceneVector3 } {
  const frame = resolveOrbitCameraFrame(transform, settings, viewport, sceneBounds);
  const pivot = targetPivot ? cloneSceneVector(targetPivot) : cloneSceneVector(frame.target);
  const offset = {
    x: frame.eye.x - pivot.x,
    y: frame.eye.y - pivot.y,
    z: frame.eye.z - pivot.z,
  };
  const backward = scaleSceneVector(frame.forward, -1);
  return {
    pivot,
    radius: Math.hypot(offset.x, offset.y, offset.z),
    localOffset: {
      x: offset.x * frame.right.x + offset.y * frame.right.y + offset.z * frame.right.z,
      y: offset.x * frame.cameraUp.x + offset.y * frame.cameraUp.y + offset.z * frame.cameraUp.z,
      z: offset.x * backward.x + offset.y * backward.y + offset.z * backward.z,
    },
  };
}

export function resolveSceneOrbitPosition(
  frame: Pick<OrbitCameraFrame, 'right' | 'cameraUp' | 'forward'>,
  pivot: SceneVector3,
  localOffset: SceneVector3,
): SceneVector3 {
  return {
    x: pivot.x
      + frame.right.x * localOffset.x
      + frame.cameraUp.x * localOffset.y
      - frame.forward.x * localOffset.z,
    y: pivot.y
      + frame.right.y * localOffset.x
      + frame.cameraUp.y * localOffset.y
      - frame.forward.y * localOffset.z,
    z: pivot.z
      + frame.right.z * localOffset.x
      + frame.cameraUp.z * localOffset.y
      - frame.forward.z * localOffset.z,
  };
}

export function clampEditCameraOrthoScale(scale: number): number {
  if (!Number.isFinite(scale)) return 2;
  return Math.max(EDIT_CAMERA_ORTHO_MIN_SCALE, Math.min(EDIT_CAMERA_ORTHO_MAX_SCALE, scale));
}

export function getEditCameraOrthoBasis(mode: EditCameraOrthoViewMode): {
  eyeDirection: SceneVector3;
  right: SceneVector3;
  up: SceneVector3;
} {
  switch (mode) {
    case 'side':
      return {
        eyeDirection: { x: 1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      };
    case 'top':
      return {
        eyeDirection: { x: 0, y: 1, z: 0 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 0, z: -1 },
      };
    case 'front':
    default:
      return {
        eyeDirection: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      };
  }
}
