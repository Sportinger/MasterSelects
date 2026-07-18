import { useMediaStore } from '../../stores/mediaStore';
import { selectSceneNavClipId, useEngineStore } from '../../stores/engineStore';
import type { SceneCameraLiveOverride } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import type { Keyframe, TimelineClip } from '../../stores/timeline/types';
import { resolveOrbitCameraFrame, resolveOrbitCameraPose } from '../gaussian/core/SplatCameraUtils';
import { normalizeEasingType } from '../../utils/easing';
import { easingFunctions } from '../../utils/keyframeInterpolation';
import type { SceneCamera, SceneCameraConfig, SceneViewport } from './types';
import { resolveSceneClipCameraSettings, resolveSceneClipTransform, type SceneTimelineContext } from './SceneTimelineUtils';
import { lookAt, orthographic, perspective } from './cameraUtils/projectionMatrices';
import {
  addVector,
  crossVector,
  dotVector,
  lerpVector,
  normalizeVector,
  quaternionFromCameraBasis,
  rotateVectorAroundAxis,
  rotateVectorByQuaternion,
  scaleVector,
  slerpQuaternion,
  subtractVector,
} from './cameraUtils/vectorMath';

export type SceneCameraResolutionContext = Partial<SceneTimelineContext> & {
  sceneNavNoKeyframes?: boolean;
  sceneCameraLiveOverrides?: Record<string, SceneCameraLiveOverride> | null;
};

export const DEFAULT_SCENE_CAMERA_CONFIG: SceneCameraConfig = {
  position: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov: 50,
  near: 0.1,
  far: 1000,
  applyDefaultDistance: true,
};

function cloneSceneCameraConfig(config: SceneCameraConfig): SceneCameraConfig {
  return {
    ...config,
    position: { ...config.position },
    target: { ...config.target },
    up: { ...config.up },
  };
}

export function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

const CAMERA_ROTATION_PROPERTIES = new Set(['rotation.x', 'rotation.y', 'rotation.z']);
const CAMERA_POSE_PROPERTIES = new Set([
  'position.x',
  'position.y',
  'position.z',
  ...CAMERA_ROTATION_PROPERTIES,
]);
const CAMERA_POSE_TIME_EPSILON = 1e-6;

function hasCameraPoseInterpolationKeyframes(keyframes: Keyframe[]): boolean {
  return getCameraPoseKeyframeTimes(keyframes).length >= 2;
}

function getCameraPoseKeyframeTimes(keyframes: Keyframe[]): number[] {
  return [...new Set(
    keyframes
      .filter((keyframe) => CAMERA_POSE_PROPERTIES.has(keyframe.property))
      .map((keyframe) => keyframe.time),
  )].toSorted((a, b) => a - b);
}

function getCameraPoseSegment(
  keyframes: Keyframe[],
  clipLocalTime: number,
): { startTime: number; endTime: number } | null {
  const times = getCameraPoseKeyframeTimes(keyframes);
  if (times.length < 2 || clipLocalTime <= times[0] || clipLocalTime >= times[times.length - 1]) {
    return null;
  }

  for (let i = 1; i < times.length; i += 1) {
    const endTime = times[i];
    if (clipLocalTime <= endTime) {
      return { startTime: times[i - 1], endTime };
    }
  }

  return null;
}

function cameraPoseSegmentUsesContinuousRotation(
  keyframes: Keyframe[],
  startTime: number,
  endTime: number,
): boolean {
  for (const property of CAMERA_ROTATION_PROPERTIES) {
    const rotationKeyframes = keyframes
      .filter((keyframe) => keyframe.property === property)
      .toSorted((a, b) => a.time - b.time);

    for (let i = 0; i < rotationKeyframes.length - 1; i += 1) {
      const prevKey = rotationKeyframes[i];
      const nextKey = rotationKeyframes[i + 1];
      const spansPoseSegment =
        prevKey.time <= startTime + CAMERA_POSE_TIME_EPSILON &&
        nextKey.time >= endTime - CAMERA_POSE_TIME_EPSILON;

      if (spansPoseSegment && prevKey.rotationInterpolation === 'continuous') {
        return true;
      }
    }
  }

  return false;
}

function getCameraOrbitRadius(frame: ReturnType<typeof resolveOrbitCameraFrame>): number | null {
  const offset = subtractVector(frame.eye, frame.center);
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  if (radius <= CAMERA_POSE_TIME_EPSILON) return null;

  const outward = scaleVector(offset, 1 / radius);
  return dotVector(outward, frame.forward) < -0.999 ? radius : null;
}

function getCameraPoseInterpolationT(
  keyframes: Keyframe[],
  startTime: number,
  endTime: number,
  clipLocalTime: number,
): number {
  const range = endTime - startTime;
  if (range <= 0) {
    return 0;
  }

  const rawT = Math.max(0, Math.min(1, (clipLocalTime - startTime) / range));
  const segmentKeyframe = keyframes.find((keyframe) =>
    keyframe.time === startTime &&
    CAMERA_POSE_PROPERTIES.has(keyframe.property) &&
    CAMERA_ROTATION_PROPERTIES.has(keyframe.property),
  ) ?? keyframes.find((keyframe) =>
    keyframe.time === startTime &&
    CAMERA_POSE_PROPERTIES.has(keyframe.property),
  );
  const easing = normalizeEasingType(segmentKeyframe?.easing, 'linear');
  return easing === 'bezier' ? rawT : easingFunctions[easing](rawT);
}

function buildPoseInterpolatedCameraConfigFromClip(
  cameraClip: TimelineClip,
  clipLocalTime: number,
  viewport: SceneViewport,
  context: Pick<SceneTimelineContext, 'clips' | 'clipKeyframes'>,
): SceneCameraConfig | null {
  if (cameraClip.source?.type !== 'camera') {
    return null;
  }

  const keyframes = context.clipKeyframes?.get(cameraClip.id) ?? [];
  if (!hasCameraPoseInterpolationKeyframes(keyframes)) {
    return null;
  }

  const segment = getCameraPoseSegment(keyframes, clipLocalTime);
  if (!segment) {
    return null;
  }
  const usesContinuousRotation = cameraPoseSegmentUsesContinuousRotation(
    keyframes,
    segment.startTime,
    segment.endTime,
  );

  const cameraSettings = resolveSceneClipCameraSettings(cameraClip, clipLocalTime, context);
  const defaultDistance = getSharedSceneDefaultCameraDistance(cameraSettings.fov);
  const settings = {
    nearPlane: cameraSettings.near,
    farPlane: cameraSettings.far,
    fov: cameraSettings.fov,
    minimumDistance: defaultDistance,
  };
  const startTimelineTime = cameraClip.startTime + segment.startTime;
  const endTimelineTime = cameraClip.startTime + segment.endTime;
  const startTransform = resolveSceneClipTransform(
    cameraClip,
    segment.startTime,
    startTimelineTime,
    context,
  );
  const endTransform = resolveSceneClipTransform(
    cameraClip,
    segment.endTime,
    endTimelineTime,
    context,
  );
  const startFrame = resolveOrbitCameraFrame(
    {
      position: startTransform.position,
      scale: startTransform.scale,
      rotation: startTransform.rotation,
    },
    settings,
    viewport,
  );
  const endFrame = resolveOrbitCameraFrame(
    {
      position: endTransform.position,
      scale: endTransform.scale,
      rotation: endTransform.rotation,
    },
    settings,
    viewport,
  );
  const t = getCameraPoseInterpolationT(
    keyframes,
    segment.startTime,
    segment.endTime,
    clipLocalTime,
  );
  if (usesContinuousRotation) {
    const startRadius = getCameraOrbitRadius(startFrame);
    const endRadius = getCameraOrbitRadius(endFrame);
    if (startRadius === null || endRadius === null) return null;

    const currentTransform = resolveSceneClipTransform(
      cameraClip,
      clipLocalTime,
      cameraClip.startTime + clipLocalTime,
      context,
    );
    const currentFrame = resolveOrbitCameraFrame(
      {
        position: currentTransform.position,
        scale: currentTransform.scale,
        rotation: currentTransform.rotation,
      },
      settings,
      viewport,
    );
    const radius = startRadius + (endRadius - startRadius) * t;

    return {
      position: addVector(currentFrame.center, scaleVector(currentFrame.forward, -radius)),
      target: currentFrame.center,
      up: currentFrame.cameraUp,
      fov: cameraSettings.fov,
      near: cameraSettings.near,
      far: cameraSettings.far,
      applyDefaultDistance: false,
    };
  }

  const startOrientation = quaternionFromCameraBasis(startFrame.right, startFrame.cameraUp, startFrame.forward);
  const endOrientation = quaternionFromCameraBasis(endFrame.right, endFrame.cameraUp, endFrame.forward);
  const orientation = slerpQuaternion(startOrientation, endOrientation, t);
  const eye = lerpVector(startFrame.eye, endFrame.eye, t);
  const target = lerpVector(startFrame.target, endFrame.target, t);
  const up = rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, orientation);

  return {
    position: eye,
    target,
    up,
    fov: cameraSettings.fov,
    near: cameraSettings.near,
    far: cameraSettings.far,
    applyDefaultDistance: false,
  };
}

function buildCameraConfigFromClip(
  cameraClip: TimelineClip,
  timelineTime: number,
  viewport: SceneViewport,
  context: Pick<SceneTimelineContext, 'clips' | 'clipKeyframes'>,
  liveOverride?: SceneCameraLiveOverride | null,
): SceneCameraConfig | null {
  if (cameraClip.source?.type !== 'camera') {
    return null;
  }

  const clipLocalTime = timelineTime - cameraClip.startTime;
  const poseInterpolatedConfig = buildPoseInterpolatedCameraConfigFromClip(
    cameraClip,
    clipLocalTime,
    viewport,
    context,
  );
  if (poseInterpolatedConfig) {
    return applySceneCameraLiveOverride(poseInterpolatedConfig, liveOverride, viewport);
  }

  const transform = resolveSceneClipTransform(cameraClip, clipLocalTime, timelineTime, context);
  const cameraSettings = resolveSceneClipCameraSettings(cameraClip, clipLocalTime, context);
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

  return applySceneCameraLiveOverride({
    position: pose.eye,
    target: pose.target,
    up: pose.up,
    fov: pose.fovDegrees,
    near: pose.near,
    far: pose.far,
    applyDefaultDistance: false,
  }, liveOverride, viewport);
}

function hasLiveOverrideVector(vector: SceneCameraLiveOverride[keyof SceneCameraLiveOverride]): boolean {
  return Object.values(vector ?? {}).some((value) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 1e-8,
  );
}

function applySceneCameraLiveOverride(
  config: SceneCameraConfig,
  override: SceneCameraLiveOverride | null | undefined,
  _viewport: SceneViewport,
): SceneCameraConfig {
  if (
    !override ||
    (!hasLiveOverrideVector(override.position) &&
      !hasLiveOverrideVector(override.scale) &&
      !hasLiveOverrideVector(override.rotation))
  ) {
    return config;
  }

  let position = { ...config.position };
  let target = { ...config.target };
  let up = normalizeVector(config.up, { x: 0, y: 1, z: 0 });
  let forward = normalizeVector(subtractVector(target, position), { x: 0, y: 0, z: -1 });
  let distance = Math.max(1e-6, Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z));
  let right = normalizeVector(crossVector(forward, up), { x: 1, y: 0, z: 0 });
  up = normalizeVector(crossVector(right, forward), { x: 0, y: 1, z: 0 });

  const panX = override.position?.x ?? 0;
  const panY = override.position?.y ?? 0;
  const panZ = override.position?.z ?? 0;
  const forwardOffset = override.scale?.z ?? 0;
  const shift = addVector(
    { x: panX, y: panY, z: panZ },
    scaleVector(forward, forwardOffset),
  );

  if (hasLiveOverrideVector({ x: panX, y: panY, z: panZ }) || Math.abs(forwardOffset) > 1e-8) {
    position = addVector(position, shift);
    target = addVector(target, shift);
  }

  const liveZoom = Math.max(0.01, 1 + (override.scale?.x ?? 0));
  if (Math.abs(liveZoom - 1) > 1e-8) {
    distance = distance / liveZoom;
    position = addVector(target, scaleVector(forward, -distance));
  }

  const pitch = override.rotation?.x ?? 0;
  const yaw = override.rotation?.y ?? 0;
  const roll = override.rotation?.z ?? 0;
  if (Math.abs(yaw) > 1e-8) {
    forward = normalizeVector(rotateVectorAroundAxis(forward, up, yaw), forward);
    right = normalizeVector(crossVector(forward, up), right);
    up = normalizeVector(crossVector(right, forward), up);
  }
  if (Math.abs(pitch) > 1e-8) {
    forward = normalizeVector(rotateVectorAroundAxis(forward, right, pitch), forward);
    up = normalizeVector(crossVector(right, forward), up);
  }
  if (Math.abs(roll) > 1e-8) {
    up = normalizeVector(rotateVectorAroundAxis(up, forward, roll), up);
  }

  if (hasLiveOverrideVector(override.rotation)) {
    target = addVector(position, scaleVector(forward, distance));
  }

  return {
    ...config,
    position,
    target,
    up,
  };
}

export function resolveSharedSceneCameraConfig(
  viewport: SceneViewport,
  timelineTime: number = useTimelineStore.getState().playheadPosition,
  context?: SceneCameraResolutionContext,
): SceneCameraConfig {
  const timelineStore = useTimelineStore.getState();
  const previewCameraOverride = context && 'previewCameraOverride' in context
    ? (context.previewCameraOverride ?? null)
    : (context ? null : useEngineStore.getState().previewCameraOverride);
  if (previewCameraOverride && timelineStore.isExporting !== true) {
    return cloneSceneCameraConfig(previewCameraOverride);
  }

  const clips = context?.clips ?? timelineStore.clips;
  const tracks = context?.tracks ?? timelineStore.tracks;
  const clipKeyframes = context?.clipKeyframes ?? timelineStore.clipKeyframes;
  const engineState = useEngineStore.getState();
  const sceneCameraLiveOverrides = context && 'sceneCameraLiveOverrides' in context
    ? (context.sceneCameraLiveOverrides ?? {})
    : (context ? {} : engineState.sceneNavNoKeyframes && timelineStore.isExporting !== true ? engineState.sceneCameraLiveOverrides : {});
  const navClipId = context && 'sceneNavClipId' in context
    ? (context.sceneNavClipId ?? null)
    : selectSceneNavClipId(engineState);
  const sceneContext = { clips, clipKeyframes };
  const navCameraClip = navClipId
    ? clips.find((clip) => clip.id === navClipId && clip.source?.type === 'camera')
    : undefined;
  const navCameraConfig = navCameraClip
    ? buildCameraConfigFromClip(
        navCameraClip,
        timelineTime,
        viewport,
        sceneContext,
        sceneCameraLiveOverrides[navCameraClip.id],
      )
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
      ? buildCameraConfigFromClip(
          activeCameraClip,
          timelineTime,
          viewport,
          sceneContext,
          sceneCameraLiveOverrides[activeCameraClip.id],
        )
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
  const projection = config.projection ?? 'perspective';

  if (applyDefaultDistanceToEye && config.applyDefaultDistance !== false) {
    cameraPosition.z += getSharedSceneDefaultCameraDistance(config.fov);
  }

  const projectionMatrix = projection === 'orthographic'
    ? (() => {
        const height = Math.max(0.001, config.orthographicScale ?? 2);
        const width = height * aspect;
        return orthographic(
          -width * 0.5,
          width * 0.5,
          -height * 0.5,
          height * 0.5,
          config.near,
          config.far,
        );
      })()
    : perspective(fovRadians, aspect, config.near, config.far);

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
    projectionMatrix,
    cameraPosition,
    cameraTarget: { ...config.target },
    cameraUp: { ...config.up },
    fov: config.fov,
    near: config.near,
    far: config.far,
    viewport,
    applyDefaultDistance: applyDefaultDistanceToEye ? false : config.applyDefaultDistance,
    projection,
    ...(projection === 'orthographic' ? { orthographicScale: config.orthographicScale ?? 2 } : {}),
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
