import type { Keyframe, TimelineClip, TimelineTrack } from '../../types';
import type { SceneCamera, SceneViewport, SceneVector3 } from '../../engine/scene/types';
import { resolveRenderableSharedSceneCamera } from '../../engine/scene/SceneCameraUtils';
import { resolveSceneClipTransform } from '../../engine/scene/SceneTimelineUtils';

export type SceneObjectKind = 'effector' | 'splat' | 'model' | 'plane';
export type SceneObjectTransformSpace = 'world' | 'effector';
export type SceneGizmoAxis = 'x' | 'y' | 'z';
export type SceneGizmoMode = 'move' | 'rotate' | 'scale';

export interface PreviewSceneObject {
  clipId: string;
  name: string;
  kind: SceneObjectKind;
  transformSpace: SceneObjectTransformSpace;
  worldPosition: SceneVector3;
  screen: {
    x: number;
    y: number;
    visible: boolean;
    depth: number;
  };
}

export interface SceneAxisScreenHandle {
  axis: SceneGizmoAxis;
  start: { x: number; y: number };
  end: { x: number; y: number };
  direction: { x: number; y: number };
  pixelsPerUnit: number;
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

export function resolveAxisScreenHandle(
  axis: SceneGizmoAxis,
  worldPosition: SceneVector3,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
): SceneAxisScreenHandle {
  const start = projectWorldToCanvas(worldPosition, camera, canvasSize);
  const axisEndWorld = {
    x: worldPosition.x + (axis === 'x' ? 1 : 0),
    y: worldPosition.y + (axis === 'y' ? 1 : 0),
    z: worldPosition.z + (axis === 'z' ? 1 : 0),
  };
  const projectedEnd = projectWorldToCanvas(axisEndWorld, camera, canvasSize);
  const normalized = normalizeScreenVector(
    { x: projectedEnd.x - start.x, y: projectedEnd.y - start.y },
    AXIS_FALLBACKS[axis],
  );
  const visualLength = Math.max(42, Math.min(78, normalized.length));

  return {
    axis,
    start: { x: start.x, y: start.y },
    end: {
      x: start.x + normalized.x * visualLength,
      y: start.y + normalized.y * visualLength,
    },
    direction: { x: normalized.x, y: normalized.y },
    pixelsPerUnit: Math.max(42, normalized.length),
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

export function collectPreviewSceneObjects({
  clips,
  tracks,
  clipKeyframes,
  playheadPosition,
  viewport,
  canvasSize,
  compositionId,
  sceneNavClipId,
}: CollectPreviewSceneObjectsParams): { camera: SceneCamera; objects: PreviewSceneObject[] } {
  const camera = resolveRenderableSharedSceneCamera(viewport, playheadPosition, {
    clips,
    tracks,
    clipKeyframes,
    compositionId,
    sceneNavClipId,
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
      const screen = projectWorldToCanvas(position, camera, canvasSize);

      return {
        clipId: clip.id,
        name: clip.name,
        kind,
        transformSpace,
        worldPosition: position,
        screen,
      };
    })
    .filter((object): object is PreviewSceneObject => object !== null)
    .toSorted((a, b) => b.screen.depth - a.screen.depth);

  return { camera, objects };
}
