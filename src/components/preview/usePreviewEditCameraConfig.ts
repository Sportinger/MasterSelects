import { resolveOrbitCameraPose } from '../../engine/gaussian/core/SplatCameraUtils';
import type { SceneCameraLiveOverride } from '../../stores/engineStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { SceneCameraConfig, SceneVector3, SceneViewport } from '../../engine/scene/types';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { fullFrameFocalLengthMmToFov } from '../../utils/cameraLens';
import {
  EDIT_CAMERA_ORTHO_MAX_SCALE,
  addSceneVectors,
  clampEditCameraOrthoScale,
  cloneSceneVector,
  getEditCameraOrthoBasis,
  getSharedSceneDefaultCameraDistance,
  scaleSceneVector,
  type EditCameraOrthoViewMode,
  type EditCameraViewMode,
} from './previewSceneCameraMath';

const DEFAULT_EDIT_CAMERA_FOCAL_LENGTH_MM = 35;

export const EDIT_CAMERA_BLEND_MS = 320;
export const DEFAULT_EDIT_CAMERA_SETTINGS: SceneCameraSettings = {
  ...DEFAULT_SCENE_CAMERA_SETTINGS,
  fov: fullFrameFocalLengthMmToFov(DEFAULT_EDIT_CAMERA_FOCAL_LENGTH_MM),
};

export const EDIT_CAMERA_VIEW_LABELS: Record<EditCameraViewMode, string> = {
  camera: 'Perspective',
  front: 'Front',
  side: 'Side',
  top: 'Top',
};

export interface EditCameraOrthoFrame {
  clipId: string;
  mode: EditCameraOrthoViewMode;
  center: SceneVector3;
  scale: number;
}

export type SceneNavCameraValues = {
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  rotationX?: number;
  rotationY?: number;
};

export type CameraProperty = 'position.x' | 'position.y' | 'position.z' | 'rotation.x' | 'rotation.y';

export function createPreviewEditorCameraClip(panelId: string): TimelineClip {
  return {
    id: `preview-editor-camera-${panelId}`,
    trackId: '',
    name: 'Editor Camera',
    file: new File([], 'editor-camera.dat', { type: 'application/octet-stream' }),
    startTime: 0,
    duration: Number.MAX_SAFE_INTEGER,
    inPoint: 0,
    outPoint: Number.MAX_SAFE_INTEGER,
    source: { type: 'camera', cameraSettings: { ...DEFAULT_EDIT_CAMERA_SETTINGS } },
    transform: {
      ...DEFAULT_TRANSFORM,
      position: { ...DEFAULT_TRANSFORM.position, z: 1 },
      scale: { ...DEFAULT_TRANSFORM.scale },
      rotation: { ...DEFAULT_TRANSFORM.rotation },
    },
    effects: [],
  };
}

export function cloneClipTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

export function createDefaultEditorCameraTransform(
  sceneCamera: SceneCameraConfig,
  baseTransform: ClipTransform,
): ClipTransform {
  const sceneDistance = Math.hypot(
    sceneCamera.position.x - sceneCamera.target.x,
    sceneCamera.position.y - sceneCamera.target.y,
    sceneCamera.position.z - sceneCamera.target.z,
  );
  const distance = Math.max(
    getSharedSceneDefaultCameraDistance(DEFAULT_EDIT_CAMERA_SETTINGS.fov),
    sceneDistance * 0.75,
  );
  const diagonalLength = Math.hypot(1, 0.65, 1);
  const position = {
    x: distance / diagonalLength,
    y: distance * 0.65 / diagonalLength,
    z: distance / diagonalLength,
  };
  const forward = {
    x: -position.x / distance,
    y: -position.y / distance,
    z: -position.z / distance,
  };

  return {
    ...cloneClipTransform(baseTransform),
    position,
    rotation: {
      x: Math.asin(-forward.y) * 180 / Math.PI,
      y: Math.atan2(-forward.x, -forward.z) * 180 / Math.PI,
      z: 0,
    },
  };
}

export function applySceneCameraLiveOverrideToTransform(
  transform: ClipTransform,
  override: SceneCameraLiveOverride | null | undefined,
): ClipTransform {
  if (!override) return transform;
  return {
    ...transform,
    position: {
      x: transform.position.x + (override.position?.x ?? 0),
      y: transform.position.y + (override.position?.y ?? 0),
      z: transform.position.z + (override.position?.z ?? 0),
    },
    scale: {
      ...transform.scale,
      all: (transform.scale.all ?? 1) + (override.scale?.all ?? 0),
      x: transform.scale.x + (override.scale?.x ?? 0),
      y: transform.scale.y + (override.scale?.y ?? override.scale?.x ?? 0),
      ...(transform.scale.z !== undefined || override.scale?.z !== undefined
        ? { z: (transform.scale.z ?? 0) + (override.scale?.z ?? 0) }
        : {}),
    },
    rotation: {
      x: transform.rotation.x + (override.rotation?.x ?? 0),
      y: transform.rotation.y + (override.rotation?.y ?? 0),
      z: transform.rotation.z + (override.rotation?.z ?? 0),
    },
  };
}

export function cloneSceneCameraConfig(config: SceneCameraConfig): SceneCameraConfig {
  return {
    ...config,
    position: { ...config.position },
    target: { ...config.target },
    up: { ...config.up },
  };
}

export function buildEditCameraOrbitSceneBounds(center: SceneVector3 | null) {
  return center
    ? {
        min: [center.x, center.y, center.z] as [number, number, number],
        max: [center.x, center.y, center.z] as [number, number, number],
      }
    : undefined;
}

export function buildPreviewCameraConfigFromTransform(
  clip: TimelineClip,
  transform: ClipTransform,
  viewport: SceneViewport,
  orbitCenter: SceneVector3 | null,
  cameraSettingsOverride?: SceneCameraSettings,
): SceneCameraConfig | null {
  if (clip.source?.type !== 'camera') return null;

  const timelineState = cameraSettingsOverride ? null : useTimelineStore.getState();
  const cameraSettings = cameraSettingsOverride ?? timelineState?.getInterpolatedCameraSettings(
    clip.id,
    timelineState.playheadPosition - clip.startTime,
  ) ?? DEFAULT_EDIT_CAMERA_SETTINGS;
  const pose = resolveOrbitCameraPose(
    {
      position: transform.position,
      scale: transform.scale,
      rotation: transform.rotation,
    },
    {
      nearPlane: cameraSettings.near,
      farPlane: cameraSettings.far,
      fov: cameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
    },
    viewport,
    buildEditCameraOrbitSceneBounds(orbitCenter),
  );

  return {
    position: pose.eye,
    target: pose.target,
    up: pose.up,
    fov: pose.fovDegrees,
    near: pose.near,
    far: pose.far,
    applyDefaultDistance: false,
  };
}

export function createDefaultEditCameraOrthoFrame(
  mode: EditCameraOrthoViewMode,
  clipId: string,
  cameraConfig: SceneCameraConfig,
): EditCameraOrthoFrame {
  const distance = Math.max(
    0.001,
    Math.hypot(
      cameraConfig.position.x - cameraConfig.target.x,
      cameraConfig.position.y - cameraConfig.target.y,
      cameraConfig.position.z - cameraConfig.target.z,
    ),
  );
  const perspectiveHeight = 2 * Math.tan((Math.max(1, cameraConfig.fov) * Math.PI / 180) * 0.5) * distance;
  return {
    clipId,
    mode,
    center: cloneSceneVector(cameraConfig.target),
    scale: clampEditCameraOrthoScale(Math.max(2, perspectiveHeight, distance * 1.35)),
  };
}

export function buildEditCameraOrthographicConfig(
  mode: EditCameraOrthoViewMode,
  frame: EditCameraOrthoFrame,
  cameraConfig: SceneCameraConfig,
): SceneCameraConfig {
  const basis = getEditCameraOrthoBasis(mode);
  const viewDistance = Math.max(
    10,
    Math.min(Math.max(cameraConfig.far * 0.25, frame.scale * 4), EDIT_CAMERA_ORTHO_MAX_SCALE),
  );
  return {
    position: addSceneVectors(frame.center, scaleSceneVector(basis.eyeDirection, viewDistance)),
    target: cloneSceneVector(frame.center),
    up: cloneSceneVector(basis.up),
    fov: cameraConfig.fov,
    near: cameraConfig.near,
    far: cameraConfig.far,
    applyDefaultDistance: false,
    projection: 'orthographic',
    orthographicScale: frame.scale,
  };
}

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function lerpSceneCameraConfig(from: SceneCameraConfig, to: SceneCameraConfig, t: number): SceneCameraConfig {
  const projection = to.projection ?? 'perspective';
  return {
    position: {
      x: lerpNumber(from.position.x, to.position.x, t),
      y: lerpNumber(from.position.y, to.position.y, t),
      z: lerpNumber(from.position.z, to.position.z, t),
    },
    target: {
      x: lerpNumber(from.target.x, to.target.x, t),
      y: lerpNumber(from.target.y, to.target.y, t),
      z: lerpNumber(from.target.z, to.target.z, t),
    },
    up: {
      x: lerpNumber(from.up.x, to.up.x, t),
      y: lerpNumber(from.up.y, to.up.y, t),
      z: lerpNumber(from.up.z, to.up.z, t),
    },
    fov: lerpNumber(from.fov, to.fov, t),
    near: lerpNumber(from.near, to.near, t),
    far: lerpNumber(from.far, to.far, t),
    applyDefaultDistance: false,
    projection,
    ...(projection === 'orthographic'
      ? {
          orthographicScale: lerpNumber(
            from.orthographicScale ?? to.orthographicScale ?? 2,
            to.orthographicScale ?? from.orthographicScale ?? 2,
            t,
          ),
        }
      : {}),
  };
}
