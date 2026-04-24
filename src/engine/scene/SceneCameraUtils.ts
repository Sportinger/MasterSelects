import { useMediaStore, DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore';
import { selectSceneNavClipId, useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../stores/timeline/types';
import { resolveOrbitCameraPose } from '../gaussian/core/SplatCameraUtils';
import type { SceneCamera, SceneCameraConfig, SceneViewport } from './types';
import { resolveSceneClipTransform, type SceneTimelineContext } from './SceneTimelineUtils';

export type SceneCameraResolutionContext = Partial<SceneTimelineContext>;

export const DEFAULT_SCENE_CAMERA_CONFIG: SceneCameraConfig = {
  position: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov: 50,
  near: 0.1,
  far: 1000,
  applyDefaultDistance: true,
};

export function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

function lookAt(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  upX: number,
  upY: number,
  upZ: number,
): Float32Array {
  let fX = eyeX - targetX;
  let fY = eyeY - targetY;
  let fZ = eyeZ - targetZ;
  let len = Math.hypot(fX, fY, fZ);
  if (len > 0) {
    fX /= len;
    fY /= len;
    fZ /= len;
  }

  let rX = upY * fZ - upZ * fY;
  let rY = upZ * fX - upX * fZ;
  let rZ = upX * fY - upY * fX;
  len = Math.hypot(rX, rY, rZ);
  if (len > 0) {
    rX /= len;
    rY /= len;
    rZ /= len;
  }

  const uX = fY * rZ - fZ * rY;
  const uY = fZ * rX - fX * rZ;
  const uZ = fX * rY - fY * rX;

  const matrix = new Float32Array(16);
  matrix[0] = rX;
  matrix[1] = uX;
  matrix[2] = fX;
  matrix[3] = 0;
  matrix[4] = rY;
  matrix[5] = uY;
  matrix[6] = fY;
  matrix[7] = 0;
  matrix[8] = rZ;
  matrix[9] = uZ;
  matrix[10] = fZ;
  matrix[11] = 0;
  matrix[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
  matrix[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
  matrix[14] = -(fX * eyeX + fY * eyeY + fZ * eyeZ);
  matrix[15] = 1;
  return matrix;
}

function perspective(fovYRadians: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovYRadians * 0.5);
  const rangeInv = 1 / (near - far);
  const matrix = new Float32Array(16);
  matrix[0] = f / aspect;
  matrix[5] = f;
  matrix[10] = far * rangeInv;
  matrix[11] = -1;
  matrix[14] = near * far * rangeInv;
  return matrix;
}

function buildCameraConfigFromClip(
  cameraClip: TimelineClip,
  timelineTime: number,
  viewport: SceneViewport,
  context: Pick<SceneTimelineContext, 'clips' | 'clipKeyframes'>,
): SceneCameraConfig | null {
  if (cameraClip.source?.type !== 'camera') {
    return null;
  }

  const clipLocalTime = timelineTime - cameraClip.startTime;
  const transform = resolveSceneClipTransform(cameraClip, clipLocalTime, timelineTime, context);
  const cameraSettings = cameraClip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
  const defaultDistance = getSharedSceneDefaultCameraDistance(cameraSettings.fov);
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
      minimumDistance: defaultDistance,
    },
    viewport,
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

export function resolveSharedSceneCameraConfig(
  viewport: SceneViewport,
  timelineTime: number = useTimelineStore.getState().playheadPosition,
  context?: SceneCameraResolutionContext,
): SceneCameraConfig {
  const timelineStore = useTimelineStore.getState();
  const clips = context?.clips ?? timelineStore.clips;
  const tracks = context?.tracks ?? timelineStore.tracks;
  const clipKeyframes = context?.clipKeyframes ?? timelineStore.clipKeyframes;
  const navClipId = context && 'sceneNavClipId' in context
    ? (context.sceneNavClipId ?? null)
    : selectSceneNavClipId(useEngineStore.getState());
  const sceneContext = { clips, clipKeyframes };
  const navCameraClip = navClipId
    ? clips.find((clip) => clip.id === navClipId && clip.source?.type === 'camera')
    : undefined;
  const navCameraConfig = navCameraClip
    ? buildCameraConfigFromClip(navCameraClip, timelineTime, viewport, sceneContext)
    : null;
  if (navCameraConfig) {
    return navCameraConfig;
  }

  const videoTracks = tracks.filter(
    (track) => track.type === 'video' && track.visible !== false,
  );
  const activeCameraTrack = [...videoTracks].reverse().find((track) =>
    clips.some((clip) =>
      clip.trackId === track.id &&
      clip.source?.type === 'camera' &&
      timelineTime >= clip.startTime &&
      timelineTime < clip.startTime + clip.duration,
    ),
  );

  if (activeCameraTrack) {
    const activeCameraClip = clips.find((clip) =>
      clip.trackId === activeCameraTrack.id &&
      clip.source?.type === 'camera' &&
      timelineTime >= clip.startTime &&
      timelineTime < clip.startTime + clip.duration,
    );
    const activeCameraConfig = activeCameraClip
      ? buildCameraConfigFromClip(activeCameraClip, timelineTime, viewport, sceneContext)
      : null;
    if (activeCameraConfig) {
      return activeCameraConfig;
    }
  }

  const mediaState = useMediaStore.getState();
  const targetCompositionId = context?.compositionId ?? mediaState.activeCompositionId;
  const activeComp = targetCompositionId
    ? mediaState.compositions.find((composition) => composition.id === targetCompositionId)
    : (mediaState.getActiveComposition?.() ??
      mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId));
  if (activeComp?.camera?.enabled) {
    return {
      ...DEFAULT_SCENE_CAMERA_CONFIG,
      ...activeComp.camera,
      position: { ...DEFAULT_SCENE_CAMERA_CONFIG.position, ...(activeComp.camera.position ?? {}) },
      target: { ...DEFAULT_SCENE_CAMERA_CONFIG.target, ...(activeComp.camera.target ?? {}) },
      applyDefaultDistance: true,
    };
  }

  return {
    ...DEFAULT_SCENE_CAMERA_CONFIG,
    position: { ...DEFAULT_SCENE_CAMERA_CONFIG.position },
    target: { ...DEFAULT_SCENE_CAMERA_CONFIG.target },
    up: { ...DEFAULT_SCENE_CAMERA_CONFIG.up },
  };
}

function buildSceneCameraFromConfig(
  config: SceneCameraConfig,
  viewport: SceneViewport,
  applyDefaultDistanceToEye: boolean,
): SceneCamera {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const fovRadians = (config.fov * Math.PI) / 180;
  const cameraPosition = { ...config.position };

  if (applyDefaultDistanceToEye && config.applyDefaultDistance !== false) {
    cameraPosition.z += getSharedSceneDefaultCameraDistance(config.fov);
  }

  return {
    viewMatrix: lookAt(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z,
      config.target.x,
      config.target.y,
      config.target.z,
      config.up.x,
      config.up.y,
      config.up.z,
    ),
    projectionMatrix: perspective(fovRadians, aspect, config.near, config.far),
    cameraPosition,
    cameraTarget: { ...config.target },
    cameraUp: { ...config.up },
    fov: config.fov,
    near: config.near,
    far: config.far,
    viewport,
    applyDefaultDistance: applyDefaultDistanceToEye ? false : config.applyDefaultDistance,
  };
}

export function resolveSharedSceneCamera(
  viewport: SceneViewport,
  timelineTime: number = useTimelineStore.getState().playheadPosition,
  context?: SceneCameraResolutionContext,
): SceneCamera {
  const config = resolveSharedSceneCameraConfig(viewport, timelineTime, context);
  return buildSceneCameraFromConfig(config, viewport, false);
}

export function resolveRenderableSharedSceneCamera(
  viewport: SceneViewport,
  timelineTime: number = useTimelineStore.getState().playheadPosition,
  context?: SceneCameraResolutionContext,
): SceneCamera {
  const config = resolveSharedSceneCameraConfig(viewport, timelineTime, context);
  return buildSceneCameraFromConfig(config, viewport, true);
}
