import type { Keyframe, TimelineClip, TimelineTrack } from '../../types';
import {
  DEFAULT_SCENE_CAMERA_SETTINGS,
  getSceneCameraAspect,
  type SceneCameraSettings,
} from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type {
  SceneCamera,
  SceneCameraConfig,
  SceneGizmoAxis,
  SceneVector3,
  SceneViewport,
} from '../../engine/scene/types';
import { getSharedSceneDefaultCameraDistance, resolveRenderableSharedSceneCamera } from '../../engine/scene/SceneCameraUtils';
import { resolveSceneClipTransform } from '../../engine/scene/SceneTimelineUtils';
import {
  buildSceneWorldMatrix,
  getSplatOrientationMatrix,
  multiplyMat4,
  resolveAxisBasisFromWorldMatrix,
} from '../../engine/scene/SceneTransformUtils';
import { resolveOrbitCameraFrame } from '../../engine/gaussian/core/SplatCameraUtils';
import { getEffectiveScale } from '../../utils/transformScale';
import {
  SCENE_GIZMO_AXIS_HIT_START_OFFSET,
  SCENE_GIZMO_AXIS_SCREEN_LENGTH,
} from '../../engine/scene/SceneGizmoConstants';

export type SceneObjectKind = 'camera' | 'effector' | 'splat' | 'model' | 'plane';
export type SceneObjectTransformSpace = 'world' | 'effector';
export type { SceneGizmoAxis, SceneGizmoMode } from '../../engine/scene/types';

export interface PreviewSceneObject {
  clipId: string;
  name: string;
  kind: SceneObjectKind;
  transformSpace: SceneObjectTransformSpace;
  worldPosition: SceneVector3;
  axisBasis: Record<SceneGizmoAxis, SceneVector3>;
  cameraSettings?: SceneCameraSettings;
  screen: {
    x: number;
    y: number;
    visible: boolean;
    depth: number;
  };
}

export interface SceneAxisScreenHandle {
  axis: SceneGizmoAxis;
  axisVector: SceneVector3;
  start: { x: number; y: number };
  end: { x: number; y: number };
  direction: { x: number; y: number };
  pixelsPerUnit: number;
  projectedLength: number;
}

export interface PreviewCameraWireframeLine {
  clipId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  role: 'body' | 'frustum' | 'direction';
}

interface CollectPreviewSceneObjectsParams {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipKeyframes: Map<string, Keyframe[]>;
  playheadPosition: number;
  viewport: SceneViewport;
  canvasSize: { width: number; height: number };
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  previewCameraOverride?: SceneCameraConfig | null;
}

const AXIS_FALLBACKS: Record<SceneGizmoAxis, { x: number; y: number }> = {
  x: { x: 1, y: 0 },
  y: { x: 0, y: -1 },
  z: { x: -0.72, y: -0.72 },
};

function isClipActiveAtTime(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime >= clip.startTime && timelineTime < clip.startTime + clip.duration;
}

function resolveSceneObjectKind(clip: TimelineClip): SceneObjectKind | null {
  const sourceType = clip.source?.type;
  if (sourceType === 'splat-effector') return 'effector';
  if (sourceType === 'gaussian-splat') return 'splat';
  if (sourceType === 'model') return 'model';
  if (clip.is3D && sourceType && sourceType !== 'audio') return 'plane';
  return null;
}

function multiplyMat4Vec4(matrix: Float32Array, vector: [number, number, number, number]): [number, number, number, number] {
  const [x, y, z, w] = vector;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

export function projectWorldToCanvas(
  point: SceneVector3,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
): PreviewSceneObject['screen'] {
  const viewPoint = multiplyMat4Vec4(camera.viewMatrix, [point.x, point.y, point.z, 1]);
  const clipPoint = multiplyMat4Vec4(camera.projectionMatrix, viewPoint);
  const w = clipPoint[3];
  if (Math.abs(w) < 0.000001) {
    return { x: 0, y: 0, visible: false, depth: w };
  }

  const ndcX = clipPoint[0] / w;
  const ndcY = clipPoint[1] / w;
  const ndcZ = clipPoint[2] / w;
  const visible = w > 0 && ndcZ >= -0.1 && ndcZ <= 1.1 && ndcX >= -1.2 && ndcX <= 1.2 && ndcY >= -1.2 && ndcY <= 1.2;

  return {
    x: (ndcX * 0.5 + 0.5) * canvasSize.width,
    y: (0.5 - ndcY * 0.5) * canvasSize.height,
    visible,
    depth: w,
  };
}

function normalizeScreenVector(vector: { x: number; y: number }, fallback: { x: number; y: number }): { x: number; y: number; length: number } {
  const length = Math.hypot(vector.x, vector.y);
  if (length >= 8) {
    return { x: vector.x / length, y: vector.y / length, length };
  }

  const fallbackLength = Math.hypot(fallback.x, fallback.y) || 1;
  return {
    x: fallback.x / fallbackLength,
    y: fallback.y / fallbackLength,
    length: 48,
  };
}

function normalizeSceneVector(vector: SceneVector3): SceneVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

export function resolveAxisScreenHandle(
  axis: SceneGizmoAxis,
  worldPosition: SceneVector3,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
  basisVector?: SceneVector3,
): SceneAxisScreenHandle {
  const start = projectWorldToCanvas(worldPosition, camera, canvasSize);
  const axisVector = normalizeSceneVector(basisVector ?? {
    x: axis === 'x' ? 1 : 0,
    y: axis === 'y' ? 1 : 0,
    z: axis === 'z' ? 1 : 0,
  });
  const axisEndWorld = {
    x: worldPosition.x + axisVector.x,
    y: worldPosition.y + axisVector.y,
    z: worldPosition.z + axisVector.z,
  };
  const projectedEnd = projectWorldToCanvas(axisEndWorld, camera, canvasSize);
  const projectedVector = { x: projectedEnd.x - start.x, y: projectedEnd.y - start.y };
  const projectedLength = Math.hypot(projectedVector.x, projectedVector.y);
  const normalized = normalizeScreenVector(
    projectedVector,
    AXIS_FALLBACKS[axis],
  );
  const hitStartOffset = SCENE_GIZMO_AXIS_HIT_START_OFFSET;
  const visualLength = SCENE_GIZMO_AXIS_SCREEN_LENGTH;

  return {
    axis,
    axisVector,
    start: {
      x: start.x + normalized.x * hitStartOffset,
      y: start.y + normalized.y * hitStartOffset,
    },
    end: {
      x: start.x + normalized.x * visualLength,
      y: start.y + normalized.y * visualLength,
    },
    direction: { x: normalized.x, y: normalized.y },
    pixelsPerUnit: Math.max(66, normalized.length),
    projectedLength,
  };
}

function resolveClipWorldPosition(
  kind: SceneObjectKind,
  transform: TimelineClip['transform'],
  viewport: SceneViewport,
): { position: SceneVector3; transformSpace: SceneObjectTransformSpace } {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const halfWorldW = aspect;

  if (kind === 'effector') {
    return {
      transformSpace: 'effector',
      position: {
        x: transform.position.x * halfWorldW,
        y: -transform.position.y,
        z: transform.position.z,
      },
    };
  }

  return {
    transformSpace: 'world',
    position: {
      x: transform.position.x,
      y: transform.position.y,
      z: transform.position.z,
    },
  };
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function resolveClipAxisBasis(
  clip: TimelineClip,
  transform: TimelineClip['transform'],
): Record<SceneGizmoAxis, SceneVector3> {
  const effectiveScale = getEffectiveScale(transform.scale);
  const worldMatrix = buildSceneWorldMatrix({
    position: transform.position,
    rotationRadians: {
      x: degreesToRadians(transform.rotation.x),
      y: degreesToRadians(transform.rotation.y),
      z: degreesToRadians(transform.rotation.z),
    },
    rotationDegrees: transform.rotation,
    scale: {
      x: effectiveScale.x,
      y: effectiveScale.y,
      z: effectiveScale.z ?? 1,
    },
  });
  const orientationMatrix = clip.source?.type === 'gaussian-splat'
    ? getSplatOrientationMatrix(clip.source.gaussianSplatSettings?.render.orientationPreset)
    : null;
  return resolveAxisBasisFromWorldMatrix(
    orientationMatrix ? multiplyMat4(worldMatrix, orientationMatrix) : worldMatrix,
  );
}

function addSceneVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleSceneVector(vector: SceneVector3, scalar: number): SceneVector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function addScaledSceneVector(origin: SceneVector3, vector: SceneVector3, scalar: number): SceneVector3 {
  return addSceneVector(origin, scaleSceneVector(vector, scalar));
}

function isDrawableScreenPoint(point: PreviewSceneObject['screen']): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.depth > 0;
}

export function buildCameraPreviewSceneObject(
  clip: TimelineClip,
  transform: TimelineClip['transform'],
  camera: SceneCamera,
  viewport: SceneViewport,
  canvasSize: { width: number; height: number },
): PreviewSceneObject | null {
  if (clip.source?.type !== 'camera') return null;

  const timelineState = useTimelineStore.getState();
  const cameraSettings = timelineState.clips.some(candidate => candidate.id === clip.id)
    ? timelineState.getInterpolatedCameraSettings(
        clip.id,
        timelineState.playheadPosition - clip.startTime,
      )
    : (clip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS);
  const resolvedCameraSettings: SceneCameraSettings = {
    ...DEFAULT_SCENE_CAMERA_SETTINGS,
    ...cameraSettings,
  };
  const frame = resolveOrbitCameraFrame(
    {
      position: transform.position,
      scale: transform.scale,
      rotation: transform.rotation,
    },
    {
      nearPlane: resolvedCameraSettings.near,
      farPlane: resolvedCameraSettings.far,
      fov: resolvedCameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(resolvedCameraSettings.fov),
    },
    viewport,
  );

  return {
    clipId: clip.id,
    name: clip.name,
    kind: 'camera',
    transformSpace: 'world',
    worldPosition: frame.eye,
    axisBasis: {
      x: frame.right,
      y: frame.cameraUp,
      z: frame.forward,
    },
    cameraSettings: resolvedCameraSettings,
    screen: projectWorldToCanvas(frame.eye, camera, canvasSize),
  };
}

export function buildCameraWireframeLines(
  object: PreviewSceneObject,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
): PreviewCameraWireframeLine[] {
  if (object.kind !== 'camera') return [];

  const origin = object.worldPosition;
  const right = normalizeSceneVector(object.axisBasis.x);
  const up = normalizeSceneVector(object.axisBasis.y);
  const forward = normalizeSceneVector(object.axisBasis.z);
  const distance = Math.max(
    0.01,
    Math.hypot(
      origin.x - camera.cameraPosition.x,
      origin.y - camera.cameraPosition.y,
      origin.z - camera.cameraPosition.z,
    ),
  );
  const worldPerPixel = camera.projection === 'orthographic'
    ? (camera.orthographicScale ?? 2) / Math.max(1, camera.viewport.height)
    : (2 * distance * Math.tan((camera.fov * Math.PI / 180) * 0.5)) /
      Math.max(1, camera.viewport.height);
  const bodyWidth = worldPerPixel * 38;
  const bodyHeight = worldPerPixel * 24;
  const bodyDepth = worldPerPixel * 22;
  const frustumDistance = worldPerPixel * 82;
  const cameraSettings = object.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
  const frameFovRadians = (cameraSettings.fov * Math.PI) / 180;
  const frustumHeight = 2 * Math.tan(frameFovRadians * 0.5) * frustumDistance;
  const frustumWidth = frustumHeight * getSceneCameraAspect(cameraSettings);

  const buildCorner = (
    center: SceneVector3,
    width: number,
    height: number,
    xSign: -1 | 1,
    ySign: -1 | 1,
  ) => addScaledSceneVector(
    addScaledSceneVector(center, right, xSign * width * 0.5),
    up,
    ySign * height * 0.5,
  );

  const backCenter = addScaledSceneVector(origin, forward, -bodyDepth * 0.45);
  const frontCenter = addScaledSceneVector(origin, forward, bodyDepth * 0.55);
  const frustumCenter = addScaledSceneVector(origin, forward, frustumDistance);
  const back = [
    buildCorner(backCenter, bodyWidth, bodyHeight, -1, -1),
    buildCorner(backCenter, bodyWidth, bodyHeight, 1, -1),
    buildCorner(backCenter, bodyWidth, bodyHeight, 1, 1),
    buildCorner(backCenter, bodyWidth, bodyHeight, -1, 1),
  ];
  const front = [
    buildCorner(frontCenter, bodyWidth, bodyHeight, -1, -1),
    buildCorner(frontCenter, bodyWidth, bodyHeight, 1, -1),
    buildCorner(frontCenter, bodyWidth, bodyHeight, 1, 1),
    buildCorner(frontCenter, bodyWidth, bodyHeight, -1, 1),
  ];
  const frustum = [
    buildCorner(frustumCenter, frustumWidth, frustumHeight, -1, -1),
    buildCorner(frustumCenter, frustumWidth, frustumHeight, 1, -1),
    buildCorner(frustumCenter, frustumWidth, frustumHeight, 1, 1),
    buildCorner(frustumCenter, frustumWidth, frustumHeight, -1, 1),
  ];

  const worldLines: Array<{ from: SceneVector3; to: SceneVector3; role: PreviewCameraWireframeLine['role'] }> = [
    { from: back[0], to: back[1], role: 'body' },
    { from: back[1], to: back[2], role: 'body' },
    { from: back[2], to: back[3], role: 'body' },
    { from: back[3], to: back[0], role: 'body' },
    { from: front[0], to: front[1], role: 'body' },
    { from: front[1], to: front[2], role: 'body' },
    { from: front[2], to: front[3], role: 'body' },
    { from: front[3], to: front[0], role: 'body' },
    { from: back[0], to: front[0], role: 'body' },
    { from: back[1], to: front[1], role: 'body' },
    { from: back[2], to: front[2], role: 'body' },
    { from: back[3], to: front[3], role: 'body' },
    { from: front[0], to: frustum[0], role: 'frustum' },
    { from: front[1], to: frustum[1], role: 'frustum' },
    { from: front[2], to: frustum[2], role: 'frustum' },
    { from: front[3], to: frustum[3], role: 'frustum' },
    { from: frustum[0], to: frustum[1], role: 'frustum' },
    { from: frustum[1], to: frustum[2], role: 'frustum' },
    { from: frustum[2], to: frustum[3], role: 'frustum' },
    { from: frustum[3], to: frustum[0], role: 'frustum' },
    { from: origin, to: frustumCenter, role: 'direction' },
  ];

  return worldLines.flatMap((line): PreviewCameraWireframeLine[] => {
    const from = projectWorldToCanvas(line.from, camera, canvasSize);
    const to = projectWorldToCanvas(line.to, camera, canvasSize);
    if (!isDrawableScreenPoint(from) || !isDrawableScreenPoint(to)) return [];
    return [{
      clipId: object.clipId,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      role: line.role,
    }];
  });
}

export function collectPreviewSceneObjects({
  clips,
  tracks,
  clipKeyframes,
  playheadPosition,
  viewport,
  canvasSize,
  compositionId,
  sceneNavClipId,
  previewCameraOverride,
}: CollectPreviewSceneObjectsParams): { camera: SceneCamera; objects: PreviewSceneObject[] } {
  const camera = resolveRenderableSharedSceneCamera(viewport, playheadPosition, {
    clips,
    tracks,
    clipKeyframes,
    compositionId,
    sceneNavClipId,
    previewCameraOverride,
  });
  const visibleVideoTrackIds = new Set(
    tracks
      .filter((track) => track.type === 'video' && track.visible !== false)
      .map((track) => track.id),
  );
  const objects = clips
    .filter((clip) => visibleVideoTrackIds.has(clip.trackId) && isClipActiveAtTime(clip, playheadPosition))
    .map((clip): PreviewSceneObject | null => {
      const kind = resolveSceneObjectKind(clip);
      if (!kind) return null;

      const transform = resolveSceneClipTransform(
        clip,
        playheadPosition - clip.startTime,
        playheadPosition,
        { clips, clipKeyframes },
      );
      const { position, transformSpace } = resolveClipWorldPosition(kind, transform, viewport);
      const axisBasis = resolveClipAxisBasis(clip, transform);
      const screen = projectWorldToCanvas(position, camera, canvasSize);

      return {
        clipId: clip.id,
        name: clip.name,
        kind,
        transformSpace,
        worldPosition: position,
        axisBasis,
        screen,
      };
    })
    .filter((object): object is PreviewSceneObject => object !== null)
    .toSorted((a, b) => b.screen.depth - a.screen.depth);

  return { camera, objects };
}
