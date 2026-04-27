import { useMediaStore, DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore';
import { selectSceneNavClipId, useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import type { Keyframe, TimelineClip } from '../../stores/timeline/types';
import { resolveOrbitCameraFrame, resolveOrbitCameraPose } from '../gaussian/core/SplatCameraUtils';
import { normalizeEasingType } from '../../utils/easing';
import { easingFunctions } from '../../utils/keyframeInterpolation';
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

type CameraVector3 = { x: number; y: number; z: number };
type CameraQuaternion = { x: number; y: number; z: number; w: number };

const CAMERA_ROTATION_PROPERTIES = new Set(['rotation.x', 'rotation.y', 'rotation.z']);
const CAMERA_POSE_PROPERTIES = new Set([
  'position.x',
  'position.y',
  'position.z',
  'scale.x',
  'scale.y',
  'scale.z',
  ...CAMERA_ROTATION_PROPERTIES,
]);

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVector(a: CameraVector3, b: CameraVector3, t: number): CameraVector3 {
  return {
    x: lerpNumber(a.x, b.x, t),
    y: lerpNumber(a.y, b.y, t),
    z: lerpNumber(a.z, b.z, t),
  };
}

function scaleVector(v: CameraVector3, scale: number): CameraVector3 {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

function normalizeQuaternion(q: CameraQuaternion): CameraQuaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length <= 1e-8) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: q.x / length,
    y: q.y / length,
    z: q.z / length,
    w: q.w / length,
  };
}

function quaternionFromCameraBasis(
  right: CameraVector3,
  up: CameraVector3,
  forward: CameraVector3,
): CameraQuaternion {
  const back = scaleVector(forward, -1);
  const m00 = right.x;
  const m01 = up.x;
  const m02 = back.x;
  const m10 = right.y;
  const m11 = up.y;
  const m12 = back.y;
  const m20 = right.z;
  const m21 = up.z;
  const m22 = back.z;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion({
      w: 0.25 * scale,
      x: (m21 - m12) / scale,
      y: (m02 - m20) / scale,
      z: (m10 - m01) / scale,
    });
  }

  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion({
      w: (m21 - m12) / scale,
      x: 0.25 * scale,
      y: (m01 + m10) / scale,
      z: (m02 + m20) / scale,
    });
  }

  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion({
      w: (m02 - m20) / scale,
      x: (m01 + m10) / scale,
      y: 0.25 * scale,
      z: (m12 + m21) / scale,
    });
  }

  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion({
    w: (m10 - m01) / scale,
    x: (m02 + m20) / scale,
    y: (m12 + m21) / scale,
    z: 0.25 * scale,
  });
}

function slerpQuaternion(a: CameraQuaternion, b: CameraQuaternion, t: number): CameraQuaternion {
  let next = b;
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  if (dot < 0) {
    dot = -dot;
    next = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }

  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: lerpNumber(a.x, next.x, t),
      y: lerpNumber(a.y, next.y, t),
      z: lerpNumber(a.z, next.z, t),
      w: lerpNumber(a.w, next.w, t),
    });
  }

  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return normalizeQuaternion({
    x: a.x * s0 + next.x * s1,
    y: a.y * s0 + next.y * s1,
    z: a.z * s0 + next.z * s1,
    w: a.w * s0 + next.w * s1,
  });
}

function rotateVectorByQuaternion(v: CameraVector3, q: CameraQuaternion): CameraVector3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

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

  const cameraSettings = cameraClip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
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
    return poseInterpolatedConfig;
  }

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
  const previewCameraOverride = context && 'previewCameraOverride' in context
    ? (context.previewCameraOverride ?? null)
    : (context ? null : useEngineStore.getState().previewCameraOverride);
  if (previewCameraOverride && timelineStore.isExporting !== true) {
    return cloneSceneCameraConfig(previewCameraOverride);
  }

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
