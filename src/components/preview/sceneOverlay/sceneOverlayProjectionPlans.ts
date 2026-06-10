import type { MouseEvent as ReactMouseEvent } from 'react';
import type { SceneCamera, SceneVector3 } from '../../../engine/scene/types';
import { SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS } from '../../../engine/scene/SceneGizmoConstants';
import {
  projectWorldToCanvas,
  type PreviewSceneObject,
  type SceneAxisScreenHandle,
  type SceneGizmoAxis,
} from '../sceneObjectOverlayMath';
import type { DisplayWorldGridPath, ProjectedRotateRing, ProjectedRotateRingPoint, WorldGridPlane } from './sceneOverlayTypes';

export const ROTATE_RING_VIEWBOX_SIZE = 320;

const ROTATE_RING_CENTER = ROTATE_RING_VIEWBOX_SIZE / 2;
const ROTATE_RING_SCREEN_RADIUS = SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS;
const ROTATE_RING_SEGMENTS = 96;
const ROTATE_RING_HIT_THRESHOLD = 28;
const WORLD_GRID_EXTENT = 40;
const WORLD_GRID_STEP = 1;
const WORLD_GRID_MAJOR_STEP = 5;

const ROTATE_RING_PLANE_AXES: Record<SceneGizmoAxis, [SceneGizmoAxis, SceneGizmoAxis]> = {
  x: ['y', 'z'],
  y: ['z', 'x'],
  z: ['x', 'y'],
};

export function normalizeAngleRadians(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function resolveWorldPerPixel(
  origin: PreviewSceneObject['worldPosition'],
  camera: SceneCamera,
): number {
  if (camera.projection === 'orthographic') {
    return (camera.orthographicScale ?? 2) / Math.max(1, camera.viewport.height);
  }

  const distance = Math.max(
    0.01,
    Math.hypot(
      origin.x - camera.cameraPosition.x,
      origin.y - camera.cameraPosition.y,
      origin.z - camera.cameraPosition.z,
    ),
  );
  const fovRadians = (camera.fov * Math.PI) / 180;
  return (2 * distance * Math.tan(fovRadians * 0.5)) / Math.max(1, camera.viewport.height);
}

export function buildProjectedRotateRing(
  handle: SceneAxisScreenHandle,
  object: PreviewSceneObject,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
): ProjectedRotateRing | null {
  const axis = handle.axis;
  const [firstAxis, secondAxis] = ROTATE_RING_PLANE_AXES[axis];
  const first = object.axisBasis[firstAxis];
  const second = object.axisBasis[secondAxis];
  const radius = resolveWorldPerPixel(object.worldPosition, camera) * ROTATE_RING_SCREEN_RADIUS;
  const points: ProjectedRotateRingPoint[] = [];

  for (let i = 0; i < ROTATE_RING_SEGMENTS; i += 1) {
    const angle = (i / ROTATE_RING_SEGMENTS) * Math.PI * 2;
    const worldPoint = {
      x: object.worldPosition.x + first.x * Math.cos(angle) * radius + second.x * Math.sin(angle) * radius,
      y: object.worldPosition.y + first.y * Math.cos(angle) * radius + second.y * Math.sin(angle) * radius,
      z: object.worldPosition.z + first.z * Math.cos(angle) * radius + second.z * Math.sin(angle) * radius,
    };
    const projected = projectWorldToCanvas(worldPoint, camera, canvasSize);
    if (projected.depth <= 0 || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      continue;
    }
    points.push({
      x: ROTATE_RING_CENTER + projected.x - object.screen.x,
      y: ROTATE_RING_CENTER + projected.y - object.screen.y,
      angleRadians: angle,
    });
  }

  if (points.length < 4) return null;
  const [firstPoint, ...remainingPoints] = points;
  const path = [
    `M ${firstPoint.x.toFixed(2)} ${firstPoint.y.toFixed(2)}`,
    ...remainingPoints.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    'Z',
  ].join(' ');

  return { axis, handle, path, points };
}

function getPointToSegmentProjection(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): { distance: number; t: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return { distance: Math.hypot(point.x - start.x, point.y - start.y), t: 0 };
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return {
    distance: Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)),
    t,
  };
}

function getPointToRingDistance(point: { x: number; y: number }, ring: ProjectedRotateRing): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.points.length; i += 1) {
    const start = ring.points[i];
    const end = ring.points[(i + 1) % ring.points.length];
    nearest = Math.min(nearest, getPointToSegmentProjection(point, start, end).distance);
  }
  return nearest;
}

export function getPointToProjectedRingPointsAngle(
  point: { x: number; y: number },
  points: ProjectedRotateRingPoint[],
): number | null {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestAngle: number | null = null;

  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const projection = getPointToSegmentProjection(point, start, end);
    if (projection.distance >= nearestDistance) {
      continue;
    }

    nearestDistance = projection.distance;
    const angleDelta = normalizeAngleRadians(end.angleRadians - start.angleRadians);
    nearestAngle = normalizeAngleRadians(start.angleRadians + angleDelta * projection.t);
  }

  return nearestAngle;
}

export function getPointToRingAngle(point: { x: number; y: number }, ring: ProjectedRotateRing): number | null {
  return getPointToProjectedRingPointsAngle(point, ring.points);
}

export function resolveNearestRotateRing(
  point: { x: number; y: number },
  rings: ProjectedRotateRing[],
): ProjectedRotateRing | null {
  let nearestRing: ProjectedRotateRing | null = null;
  let nearestDistance = ROTATE_RING_HIT_THRESHOLD;

  for (const ring of rings) {
    const distance = getPointToRingDistance(point, ring);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestRing = ring;
    }
  }

  return nearestRing;
}

export function getRotateRingEventPoint(event: ReactMouseEvent<SVGSVGElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const scaleX = ROTATE_RING_VIEWBOX_SIZE / Math.max(1, rect.width);
  const scaleY = ROTATE_RING_VIEWBOX_SIZE / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

type ClipVector4 = [number, number, number, number];

function multiplyMat4Vec4(matrix: Float32Array, vector: ClipVector4): ClipVector4 {
  const [x, y, z, w] = vector;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

function projectWorldToClip(point: SceneVector3, camera: SceneCamera): ClipVector4 {
  const viewPoint = multiplyMat4Vec4(camera.viewMatrix, [point.x, point.y, point.z, 1]);
  return multiplyMat4Vec4(camera.projectionMatrix, viewPoint);
}

function interpolateClipVector(a: ClipVector4, b: ClipVector4, t: number): ClipVector4 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

function clipLineSegmentToView(from: ClipVector4, to: ClipVector4): [ClipVector4, ClipVector4] | null {
  let clippedFrom = from;
  let clippedTo = to;
  const planes: Array<[number, number, number, number]> = [
    [1, 0, 0, 1],
    [-1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, -1, 0, 1],
    [0, 0, 1, 0.02],
    [0, 0, -1, 1],
    [0, 0, 0, 1],
  ];

  for (const [a, b, c, d] of planes) {
    const fromDistance = a * clippedFrom[0] + b * clippedFrom[1] + c * clippedFrom[2] + d * clippedFrom[3];
    const toDistance = a * clippedTo[0] + b * clippedTo[1] + c * clippedTo[2] + d * clippedTo[3];
    if (fromDistance < 0 && toDistance < 0) return null;
    if (fromDistance < 0 || toDistance < 0) {
      const t = fromDistance / (fromDistance - toDistance);
      const intersection = interpolateClipVector(clippedFrom, clippedTo, t);
      if (fromDistance < 0) {
        clippedFrom = intersection;
      } else {
        clippedTo = intersection;
      }
    }
  }

  return [clippedFrom, clippedTo];
}

function clipToCanvasPath(from: ClipVector4, to: ClipVector4, canvasSize: { width: number; height: number }): string | null {
  if (Math.abs(from[3]) < 0.000001 || Math.abs(to[3]) < 0.000001) return null;
  const fromX = (from[0] / from[3] * 0.5 + 0.5) * canvasSize.width;
  const fromY = (0.5 - from[1] / from[3] * 0.5) * canvasSize.height;
  const toX = (to[0] / to[3] * 0.5 + 0.5) * canvasSize.width;
  const toY = (0.5 - to[1] / to[3] * 0.5) * canvasSize.height;
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null;
  return `M ${fromX.toFixed(2)} ${fromY.toFixed(2)} L ${toX.toFixed(2)} ${toY.toFixed(2)}`;
}

function projectGridLine(
  from: SceneVector3,
  to: SceneVector3,
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
): string | null {
  const clipped = clipLineSegmentToView(
    projectWorldToClip(from, camera),
    projectWorldToClip(to, camera),
  );
  if (!clipped) return null;
  return clipToCanvasPath(clipped[0], clipped[1], canvasSize);
}

function getWorldGridLine(
  plane: WorldGridPlane,
  axis: SceneGizmoAxis,
  coord: number,
): { from: SceneVector3; to: SceneVector3 } {
  switch (plane) {
    case 'xy':
      if (axis === 'x') {
        return { from: { x: -WORLD_GRID_EXTENT, y: coord, z: 0 }, to: { x: WORLD_GRID_EXTENT, y: coord, z: 0 } };
      }
      return { from: { x: coord, y: -WORLD_GRID_EXTENT, z: 0 }, to: { x: coord, y: WORLD_GRID_EXTENT, z: 0 } };
    case 'yz':
      if (axis === 'y') {
        return { from: { x: 0, y: -WORLD_GRID_EXTENT, z: coord }, to: { x: 0, y: WORLD_GRID_EXTENT, z: coord } };
      }
      return { from: { x: 0, y: coord, z: -WORLD_GRID_EXTENT }, to: { x: 0, y: coord, z: WORLD_GRID_EXTENT } };
    case 'xz':
    default:
      if (axis === 'x') {
        return { from: { x: -WORLD_GRID_EXTENT, y: 0, z: coord }, to: { x: WORLD_GRID_EXTENT, y: 0, z: coord } };
      }
      return { from: { x: coord, y: 0, z: -WORLD_GRID_EXTENT }, to: { x: coord, y: 0, z: WORLD_GRID_EXTENT } };
  }
}

export function buildWorldGridPaths(
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
  plane: WorldGridPlane,
): DisplayWorldGridPath[] {
  const pathGroups: Record<DisplayWorldGridPath['kind'], string[]> = {
    minor: [],
    major: [],
    'axis-x': [],
    'axis-y': [],
    'axis-z': [],
  };
  const planeAxes: Record<WorldGridPlane, [SceneGizmoAxis, SceneGizmoAxis]> = {
    xy: ['x', 'y'],
    yz: ['y', 'z'],
    xz: ['x', 'z'],
  };
  const steps = Math.floor(WORLD_GRID_EXTENT / WORLD_GRID_STEP);

  for (let index = -steps; index <= steps; index += 1) {
    const coord = index * WORLD_GRID_STEP;
    for (const axis of planeAxes[plane]) {
      const line = getWorldGridLine(plane, axis, coord);
      const path = projectGridLine(line.from, line.to, camera, canvasSize);
      if (!path) continue;

      const kind = index === 0
        ? (`axis-${axis}` as const)
        : index % WORLD_GRID_MAJOR_STEP === 0 ? 'major' : 'minor';
      pathGroups[kind].push(path);
    }
  }

  return (['minor', 'major', 'axis-x', 'axis-y', 'axis-z'] as const)
    .filter((kind) => pathGroups[kind].length > 0)
    .map((kind) => ({
      key: kind,
      d: pathGroups[kind].join(' '),
      kind,
    }));
}
