import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { AnimatableProperty, ClipTransform, TimelineClip, TimelineTrack } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import type { SceneCamera, SceneCameraConfig, SceneVector3, SceneViewport } from '../../engine/scene/types';
import { SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS } from '../../engine/scene/SceneGizmoConstants';
import {
  buildCameraPreviewSceneObject,
  buildCameraWireframeLines,
  collectPreviewSceneObjects,
  projectWorldToCanvas,
  resolveAxisScreenHandle,
  type PreviewSceneObject,
  type SceneAxisScreenHandle,
  type SceneGizmoAxis,
  type SceneGizmoMode,
} from './sceneObjectOverlayMath';

interface SceneObjectOverlayProps {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipId: string | null;
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  canvasSize: { width: number; height: number };
  viewport: SceneViewport;
  compositionId?: string | null;
  sceneNavClipId?: string | null;
  previewCameraOverride?: SceneCameraConfig | null;
  editCameraClip?: TimelineClip | null;
  editCameraTransform?: ClipTransform | null;
  showOnlyEditCamera?: boolean;
  showWorldGrid?: boolean;
  worldGridPlane?: WorldGridPlane;
  toolbarPortalTarget?: HTMLElement | null;
  enabled: boolean;
}

type SceneGizmoDragAxis = SceneGizmoAxis | 'all';

type DisplayCameraWireframePath = {
  key: string;
  d: string;
  role: 'body' | 'frustum' | 'direction';
  selected: boolean;
};

type DisplayWorldGridPath = {
  key: string;
  d: string;
  kind: 'minor' | 'major' | 'axis-x' | 'axis-y' | 'axis-z';
};

type WorldGridPlane = 'xy' | 'yz' | 'xz';

interface DragState {
  clipId: string;
  mode: SceneGizmoMode;
  axis: SceneGizmoDragAxis;
  kind: PreviewSceneObject['kind'];
  transformSpace: PreviewSceneObject['transformSpace'];
  startTransform: ClipTransform;
  transient: boolean;
  direction: { x: number; y: number };
  axisVector: { x: number; y: number; z: number };
  pixelsPerUnit: number;
  freePixelsPerUnit: { x: number; y: number };
  axisPlaneDrag?: AxisPlaneDrag;
  rotationCenterClient?: { x: number; y: number };
  rotationStartPointerClient?: { x: number; y: number };
  rotationRingClientRect?: { left: number; top: number; width: number; height: number };
  rotationRingPoints?: ProjectedRotateRingPoint[];
  rotationStartRingAngle?: number;
  viewport: SceneViewport;
}

interface AxisPlaneDrag {
  camera: SceneCamera;
  canvasRect: { left: number; top: number; width: number; height: number };
  planePoint: { x: number; y: number; z: number };
  planeNormal: { x: number; y: number; z: number };
  startPoint: { x: number; y: number; z: number };
}

interface DragRuntime {
  target: HTMLElement | null;
  hasPointerLock: boolean;
  accumulatedX: number;
  accumulatedY: number;
  lastClientX: number;
  lastClientY: number;
  rotationRingLastAngle: number | null;
  rotationRingAccumulatedRadians: number;
  rotationAngularLastAngle: number | null;
  rotationAngularAccumulatedRadians: number;
}

interface DisplaySceneObject extends PreviewSceneObject {
  displayX: number;
  displayY: number;
}

interface ProjectedRotateRingPoint {
  x: number;
  y: number;
  angleRadians: number;
}

interface ProjectedRotateRing {
  axis: SceneGizmoAxis;
  handle: SceneAxisScreenHandle;
  path: string;
  points: ProjectedRotateRingPoint[];
}

const AXES: SceneGizmoAxis[] = ['x', 'y', 'z'];
const OVERLAY_REFRESH_MS = 125;
const CENTER_DRAG_FALLBACK_PIXELS_PER_UNIT = 72;
const CENTER_SCALE_DIRECTION = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
const ROTATE_RING_VIEWBOX_SIZE = 320;
const ROTATE_RING_CENTER = ROTATE_RING_VIEWBOX_SIZE / 2;
const ROTATE_RING_SCREEN_RADIUS = SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS;
const ROTATE_RING_SEGMENTS = 96;
const ROTATE_RING_HIT_THRESHOLD = 28;
const WORLD_GRID_EXTENT = 40;
const WORLD_GRID_STEP = 1;
const WORLD_GRID_MAJOR_STEP = 5;

const AXIS_LABELS: Record<SceneGizmoAxis, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

const MODE_LABELS: Record<SceneGizmoMode, string> = {
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
};

const ROTATE_RING_PLANE_AXES: Record<SceneGizmoAxis, [SceneGizmoAxis, SceneGizmoAxis]> = {
  x: ['y', 'z'],
  y: ['z', 'x'],
  z: ['x', 'y'],
};

function getObjectBadge(kind: PreviewSceneObject['kind']): string {
  switch (kind) {
    case 'camera':
      return 'C';
    case 'effector':
      return 'E';
    case 'splat':
      return 'S';
    case 'model':
      return 'M';
    case 'plane':
      return '3D';
  }
}

function resolveDisplayObjects(
  objects: PreviewSceneObject[],
  canvasSize: { width: number; height: number },
): DisplaySceneObject[] {
  const groups = new Map<string, PreviewSceneObject[]>();
  for (const object of objects) {
    if (!object.screen.visible) continue;
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  }

  return objects.map((object) => {
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    const group = groups.get(key) ?? [object];
    const index = group.findIndex((candidate) => candidate.clipId === object.clipId);
    if (!object.screen.visible || group.length <= 1 || index < 0) {
      return { ...object, displayX: object.screen.x, displayY: object.screen.y };
    }

    const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
    const radius = 19;
    return {
      ...object,
      displayX: Math.max(14, Math.min(canvasSize.width - 14, object.screen.x + Math.cos(angle) * radius)),
      displayY: Math.max(14, Math.min(canvasSize.height - 14, object.screen.y + Math.sin(angle) * radius)),
    };
  });
}

function cloneTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function resolveTransformPropertyUpdates(transform: Partial<ClipTransform>): Array<[AnimatableProperty, number]> {
  const updates: Array<[AnimatableProperty, number]> = [];
  if (transform.opacity !== undefined) updates.push(['opacity', transform.opacity]);
  if (transform.position) {
    updates.push(['position.x', transform.position.x]);
    updates.push(['position.y', transform.position.y]);
    updates.push(['position.z', transform.position.z]);
  }
  if (transform.scale) {
    updates.push(['scale.x', transform.scale.x]);
    updates.push(['scale.y', transform.scale.y]);
    if (transform.scale.z !== undefined) updates.push(['scale.z', transform.scale.z]);
  }
  if (transform.rotation) {
    updates.push(['rotation.x', transform.rotation.x]);
    updates.push(['rotation.y', transform.rotation.y]);
    updates.push(['rotation.z', transform.rotation.z]);
  }
  return updates;
}

function getAxisStyle(handle: SceneAxisScreenHandle): CSSProperties {
  const length = Math.hypot(handle.end.x - handle.start.x, handle.end.y - handle.start.y);
  const angle = Math.atan2(handle.end.y - handle.start.y, handle.end.x - handle.start.x);
  return {
    left: handle.start.x,
    top: handle.start.y,
    width: length,
    transform: `rotate(${angle}rad)`,
  };
}

function getCenterHandleLabel(mode: SceneGizmoMode): string {
  if (mode === 'move') return 'Move freely';
  if (mode === 'scale') return 'Scale all axes';
  return 'Selected scene object';
}

function resolveWorldPerPixel(
  origin: PreviewSceneObject['worldPosition'],
  camera: ReturnType<typeof collectPreviewSceneObjects>['camera'],
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

function buildProjectedRotateRing(
  handle: SceneAxisScreenHandle,
  object: PreviewSceneObject,
  camera: ReturnType<typeof collectPreviewSceneObjects>['camera'],
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

function getPointToProjectedRingPointsAngle(
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

function getPointToRingAngle(point: { x: number; y: number }, ring: ProjectedRotateRing): number | null {
  return getPointToProjectedRingPointsAngle(point, ring.points);
}

function resolveNearestRotateRing(
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

function getRotateRingEventPoint(event: ReactMouseEvent<SVGSVGElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const scaleX = ROTATE_RING_VIEWBOX_SIZE / Math.max(1, rect.width);
  const scaleY = ROTATE_RING_VIEWBOX_SIZE / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function resolveCenterFreePixelsPerUnit(axisHandles: SceneAxisScreenHandle[]): { x: number; y: number } {
  const xHandle = axisHandles.find((handle) => handle.axis === 'x');
  const yHandle = axisHandles.find((handle) => handle.axis === 'y');
  const fallback = xHandle?.pixelsPerUnit ?? yHandle?.pixelsPerUnit ?? CENTER_DRAG_FALLBACK_PIXELS_PER_UNIT;
  return {
    x: Math.max(24, xHandle?.pixelsPerUnit ?? fallback),
    y: Math.max(24, yHandle?.pixelsPerUnit ?? fallback),
  };
}

function getAveragePixelsPerUnit(pixelsPerUnit: { x: number; y: number }): number {
  return Math.max(24, (pixelsPerUnit.x + pixelsPerUnit.y) / 2);
}

function getDragSpeedMultiplier(event: MouseEvent): number {
  if (event.ctrlKey) return 5;
  if (event.altKey || event.shiftKey) return 0.1;
  return 1;
}

function dotVector(a: SceneVector3, b: SceneVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function addVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVector(vector: SceneVector3, scalar: number): SceneVector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function crossVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVector(vector: SceneVector3): SceneVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.000001) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function rejectVector(vector: SceneVector3, axis: SceneVector3): SceneVector3 {
  return subtractVector(vector, scaleVector(axis, dotVector(vector, axis)));
}

function resolveScreenRay(
  client: { x: number; y: number },
  camera: SceneCamera,
  canvasRect: AxisPlaneDrag['canvasRect'],
): { origin: SceneVector3; direction: SceneVector3 } {
  const ndcX = ((client.x - canvasRect.left) / Math.max(1, canvasRect.width)) * 2 - 1;
  const ndcY = 1 - ((client.y - canvasRect.top) / Math.max(1, canvasRect.height)) * 2;
  const backward = normalizeVector(subtractVector(camera.cameraPosition, camera.cameraTarget));
  let right = normalizeVector(crossVector(camera.cameraUp, backward));
  if (Math.hypot(right.x, right.y, right.z) < 0.000001) {
    right = { x: 1, y: 0, z: 0 };
  }
  const up = normalizeVector(crossVector(backward, right));
  const aspect = camera.viewport.width / Math.max(1, camera.viewport.height);
  if (camera.projection === 'orthographic') {
    const height = Math.max(0.001, camera.orthographicScale ?? 2);
    const width = height * aspect;
    return {
      origin: addVector(
        camera.cameraPosition,
        addVector(
          scaleVector(right, ndcX * width * 0.5),
          scaleVector(up, ndcY * height * 0.5),
        ),
      ),
      direction: normalizeVector(scaleVector(backward, -1)),
    };
  }

  const fovRadians = (camera.fov * Math.PI) / 180;
  const tanHalfFov = Math.tan(fovRadians * 0.5);
  const direction = normalizeVector(addVector(
    scaleVector(backward, -1),
    addVector(
      scaleVector(right, ndcX * tanHalfFov * aspect),
      scaleVector(up, ndcY * tanHalfFov),
    ),
  ));

  return {
    origin: camera.cameraPosition,
    direction,
  };
}

function intersectRayWithPlane(
  ray: { origin: SceneVector3; direction: SceneVector3 },
  planePoint: SceneVector3,
  planeNormal: SceneVector3,
): SceneVector3 | null {
  const denominator = dotVector(ray.direction, planeNormal);
  if (Math.abs(denominator) < 0.00001) {
    return null;
  }

  const t = dotVector(subtractVector(planePoint, ray.origin), planeNormal) / denominator;
  if (!Number.isFinite(t)) {
    return null;
  }

  return addVector(ray.origin, scaleVector(ray.direction, t));
}

function resolveAxisDragPlaneNormal(axisVector: SceneVector3, camera: SceneCamera): SceneVector3 | null {
  const axis = normalizeVector(axisVector);
  if (Math.hypot(axis.x, axis.y, axis.z) < 0.000001) {
    return null;
  }

  const cameraForward = normalizeVector(subtractVector(camera.cameraTarget, camera.cameraPosition));
  let normal = normalizeVector(rejectVector(cameraForward, axis));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  normal = normalizeVector(rejectVector(camera.cameraUp, axis));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  normal = normalizeVector(crossVector(axis, { x: 0, y: 1, z: 0 }));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  return normalizeVector(crossVector(axis, { x: 1, y: 0, z: 0 }));
}

function createAxisPlaneDrag(params: {
  client: { x: number; y: number };
  camera: SceneCamera;
  canvasRect: AxisPlaneDrag['canvasRect'];
  worldPosition: SceneVector3;
  axisVector: SceneVector3;
}): AxisPlaneDrag | undefined {
  const planeNormal = resolveAxisDragPlaneNormal(params.axisVector, params.camera);
  if (!planeNormal) return undefined;

  const startPoint = intersectRayWithPlane(
    resolveScreenRay(params.client, params.camera, params.canvasRect),
    params.worldPosition,
    planeNormal,
  );
  if (!startPoint) return undefined;

  return {
    camera: params.camera,
    canvasRect: params.canvasRect,
    planePoint: params.worldPosition,
    planeNormal,
    startPoint,
  };
}

function resolveAxisPlaneDragUnits(
  drag: DragState,
  screenDelta: { x: number; y: number },
): number | null {
  if (!drag.axisPlaneDrag || !drag.rotationStartPointerClient || drag.axis === 'all') {
    return null;
  }

  const currentClient = {
    x: drag.rotationStartPointerClient.x + screenDelta.x,
    y: drag.rotationStartPointerClient.y + screenDelta.y,
  };
  const currentPoint = intersectRayWithPlane(
    resolveScreenRay(currentClient, drag.axisPlaneDrag.camera, drag.axisPlaneDrag.canvasRect),
    drag.axisPlaneDrag.planePoint,
    drag.axisPlaneDrag.planeNormal,
  );
  if (!currentPoint) return null;

  return dotVector(
    subtractVector(currentPoint, drag.axisPlaneDrag.startPoint),
    drag.axisVector,
  );
}

function applySceneObjectTransform(clipId: string, transform: Partial<ClipTransform>): void {
  const store = useTimelineStore.getState();
  const updates = resolveTransformPropertyUpdates(transform);
  const useKeyframePath = updates.some(([property]) =>
    store.hasKeyframes(clipId, property) || store.isRecording(clipId, property),
  );

  if (useKeyframePath) {
    for (const [property, value] of updates) {
      store.setPropertyValue(clipId, property, value);
    }
  } else {
    store.updateClipTransform(clipId, transform);
  }
  engine.requestRender();
}

function buildScaleUpdate(
  startScale: ClipTransform['scale'],
  values: { x: number; y: number; z?: number },
): ClipTransform['scale'] {
  const scale: ClipTransform['scale'] = {
    x: Math.max(0.001, values.x),
    y: Math.max(0.001, values.y),
  };

  if (values.z !== undefined || startScale.z !== undefined) {
    scale.z = Math.max(0.001, values.z ?? startScale.z ?? 1);
  }

  return scale;
}

function buildAxisResetTransform(
  mode: SceneGizmoMode,
  axis: SceneGizmoAxis,
  object: PreviewSceneObject,
  start: ClipTransform,
): Partial<ClipTransform> {
  if (mode === 'rotate') {
    return {
      rotation: {
        ...start.rotation,
        [axis]: 0,
      },
    };
  }

  if (mode === 'scale') {
    if (object.kind === 'camera') {
      return {
        scale: { x: 1, y: 1, z: 0 },
      };
    }

    return {
      scale: buildScaleUpdate(start.scale, {
        x: axis === 'x' ? 1 : start.scale.x,
        y: axis === 'y' ? 1 : start.scale.y,
        ...(axis === 'z'
          ? { z: 1 }
          : start.scale.z !== undefined
            ? { z: start.scale.z }
            : {}),
      }),
    };
  }

  return {
    position: {
      ...start.position,
      [axis]: 0,
    },
  };
}

function buildCenterResetTransform(
  mode: SceneGizmoMode,
  object: PreviewSceneObject,
  start: ClipTransform,
): Partial<ClipTransform> {
  if (mode === 'rotate') {
    return {
      rotation: { x: 0, y: 0, z: 0 },
    };
  }

  if (mode === 'scale') {
    if (object.kind === 'camera') {
      return {
        scale: { x: 1, y: 1, z: 0 },
      };
    }

    return {
      scale: buildScaleUpdate(start.scale, {
        x: 1,
        y: 1,
        ...(object.kind !== 'plane' || start.scale.z !== undefined ? { z: 1 } : {}),
      }),
    };
  }

  return {
    position: { x: 0, y: 0, z: 0 },
  };
}

function resetSceneObjectTransform(
  clipId: string,
  mode: SceneGizmoMode,
  transform: Partial<ClipTransform>,
): void {
  startBatch(`Reset scene ${mode}`);
  applySceneObjectTransform(clipId, transform);
  endBatch();
}

function normalizeAngleRadians(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function buildRotationMatrixFromDegrees(rotation: ClipTransform['rotation']): number[] {
  const x = (rotation.x * Math.PI) / 180;
  const y = (rotation.y * Math.PI) / 180;
  const z = (rotation.z * Math.PI) / 180;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  return [
    c * e,
    af + be * d,
    bf - ae * d,
    -c * f,
    ae - bf * d,
    be + af * d,
    d,
    -b * c,
    a * c,
  ];
}

function buildLocalAxisRotationMatrix(axis: SceneGizmoAxis, degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);

  if (axis === 'x') {
    return [
      1, 0, 0,
      0, c, s,
      0, -s, c,
    ];
  }

  if (axis === 'y') {
    return [
      c, 0, -s,
      0, 1, 0,
      s, 0, c,
    ];
  }

  return [
    c, s, 0,
    -s, c, 0,
    0, 0, 1,
  ];
}

function multiplyMat3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += a[k * 3 + row] * b[col * 3 + k];
      }
      out[col * 3 + row] = sum;
    }
  }
  return out;
}

function matrixToRotationDegrees(matrix: number[]): ClipTransform['rotation'] {
  const y = Math.asin(Math.max(-1, Math.min(1, matrix[6] ?? 0)));
  const c = Math.cos(y);
  let x: number;
  let z: number;

  if (Math.abs(c) > 0.000001) {
    x = Math.atan2(-(matrix[7] ?? 0), matrix[8] ?? 1);
    z = Math.atan2(-(matrix[3] ?? 0), matrix[0] ?? 1);
  } else {
    x = 0;
    z = Math.atan2(matrix[1] ?? 0, matrix[4] ?? 1);
  }

  return {
    x: (x * 180) / Math.PI,
    y: (y * 180) / Math.PI,
    z: (z * 180) / Math.PI,
  };
}

function unwrapDegreesNear(value: number, target: number): number {
  let unwrapped = value;
  while (unwrapped - target > 180) unwrapped -= 360;
  while (target - unwrapped > 180) unwrapped += 360;
  return unwrapped;
}

function applyLocalAxisRotation(
  startRotation: ClipTransform['rotation'],
  axis: SceneGizmoAxis,
  degrees: number,
): ClipTransform['rotation'] {
  const startMatrix = buildRotationMatrixFromDegrees(startRotation);
  const localDelta = buildLocalAxisRotationMatrix(axis, degrees);
  const rotation = matrixToRotationDegrees(multiplyMat3(startMatrix, localDelta));
  const targetAxisDegrees = startRotation[axis] + degrees;
  return {
    ...rotation,
    [axis]: unwrapDegreesNear(rotation[axis], targetAxisDegrees),
  };
}

function resolveAngularDragDegrees(
  drag: DragState,
  screenDelta: { x: number; y: number },
  runtime?: DragRuntime,
): number | null {
  if (!drag.rotationCenterClient || !drag.rotationStartPointerClient) {
    return null;
  }

  const startVector = {
    x: drag.rotationStartPointerClient.x - drag.rotationCenterClient.x,
    y: drag.rotationStartPointerClient.y - drag.rotationCenterClient.y,
  };
  const currentVector = {
    x: drag.rotationStartPointerClient.x + screenDelta.x - drag.rotationCenterClient.x,
    y: drag.rotationStartPointerClient.y + screenDelta.y - drag.rotationCenterClient.y,
  };
  if (Math.hypot(startVector.x, startVector.y) < 6 || Math.hypot(currentVector.x, currentVector.y) < 6) {
    return null;
  }

  const startAngle = Math.atan2(startVector.y, startVector.x);
  const currentAngle = Math.atan2(currentVector.y, currentVector.x);
  if (runtime) {
    const previousAngle = runtime.rotationAngularLastAngle ?? startAngle;
    runtime.rotationAngularAccumulatedRadians += normalizeAngleRadians(currentAngle - previousAngle);
    runtime.rotationAngularLastAngle = currentAngle;
    return (runtime.rotationAngularAccumulatedRadians * 180) / Math.PI;
  }

  return (normalizeAngleRadians(currentAngle - startAngle) * 180) / Math.PI;
}

function resolveProjectedRingDragDegrees(
  drag: DragState,
  screenDelta: { x: number; y: number },
  runtime?: DragRuntime,
): number | null {
  if (
    !drag.rotationStartPointerClient ||
    !drag.rotationRingClientRect ||
    !drag.rotationRingPoints ||
    drag.rotationStartRingAngle === undefined
  ) {
    return null;
  }

  const currentClient = {
    x: drag.rotationStartPointerClient.x + screenDelta.x,
    y: drag.rotationStartPointerClient.y + screenDelta.y,
  };
  const point = {
    x: ((currentClient.x - drag.rotationRingClientRect.left) * ROTATE_RING_VIEWBOX_SIZE) /
      Math.max(1, drag.rotationRingClientRect.width),
    y: ((currentClient.y - drag.rotationRingClientRect.top) * ROTATE_RING_VIEWBOX_SIZE) /
      Math.max(1, drag.rotationRingClientRect.height),
  };
  const currentAngle = getPointToProjectedRingPointsAngle(point, drag.rotationRingPoints);
  if (currentAngle === null) {
    return null;
  }

  if (runtime) {
    const previousAngle = runtime.rotationRingLastAngle ?? drag.rotationStartRingAngle;
    runtime.rotationRingAccumulatedRadians += normalizeAngleRadians(currentAngle - previousAngle);
    runtime.rotationRingLastAngle = currentAngle;
    return (runtime.rotationRingAccumulatedRadians * 180) / Math.PI;
  }

  return (normalizeAngleRadians(currentAngle - drag.rotationStartRingAngle) * 180) / Math.PI;
}

function applyDragTransform(
  drag: DragState,
  screenDistance: number,
  screenDelta: { x: number; y: number },
  runtime?: DragRuntime,
  applyTransform: (clipId: string, transform: Partial<ClipTransform>) => void = applySceneObjectTransform,
): void {
  const start = drag.startTransform;
  const axis = drag.axis;

  if (drag.mode === 'rotate') {
    if (axis === 'all') return;
    const degrees =
      resolveProjectedRingDragDegrees(drag, screenDelta, runtime) ??
      resolveAngularDragDegrees(drag, screenDelta, runtime) ??
      screenDistance * 0.6;
    applyTransform(drag.clipId, {
      rotation: applyLocalAxisRotation(start.rotation, axis, degrees),
    });
    return;
  }

  if (drag.mode === 'scale') {
    if (drag.kind === 'camera') {
      const scaleDelta = screenDistance / 90;
      if (axis === 'z') {
        applyTransform(drag.clipId, {
          scale: {
            ...start.scale,
            z: (start.scale.z ?? 0) + scaleDelta,
          },
        });
        return;
      }

      const factor = axis === 'all'
        ? Math.max(0.01, 1 + screenDistance / 160)
        : Math.max(0.01, (start.scale.x || 1) + scaleDelta);
      const nextZoom = axis === 'all'
        ? Math.max(0.01, (start.scale.x || 1) * factor)
        : factor;
      applyTransform(drag.clipId, {
        scale: {
          ...start.scale,
          x: nextZoom,
          y: nextZoom,
        },
      });
      return;
    }

    if (axis === 'all') {
      const factor = Math.max(0.001, 1 + screenDistance / 160);
      const includeZ = drag.kind !== 'plane' || start.scale.z !== undefined;
      applyTransform(drag.clipId, {
        scale: buildScaleUpdate(start.scale, {
          x: start.scale.x * factor,
          y: start.scale.y * factor,
          ...(includeZ ? { z: (start.scale.z ?? 1) * factor } : {}),
        }),
      });
      return;
    }

    const scaleDelta = screenDistance / 90;
    if (drag.transformSpace === 'effector') {
      const next = Math.max(0.001, Math.max(start.scale.x, start.scale.y, start.scale.z ?? 1) + scaleDelta);
      applyTransform(drag.clipId, {
        scale: { x: next, y: next, z: next },
      });
      return;
    }

    applyTransform(drag.clipId, {
      scale: buildScaleUpdate(start.scale, {
        x: start.scale.x + (axis === 'x' ? scaleDelta : 0),
        y: start.scale.y + (axis === 'y' ? scaleDelta : 0),
        ...(axis === 'z' ? { z: (start.scale.z ?? 1) + scaleDelta } : {}),
      }),
    });
    return;
  }

  const units = drag.mode === 'move' && axis !== 'all'
    ? resolveAxisPlaneDragUnits(drag, screenDelta) ?? screenDistance / drag.pixelsPerUnit
    : screenDistance / drag.pixelsPerUnit;
  if (drag.kind === 'camera') {
    const position = { ...start.position };
    if (axis === 'all') {
      position.x += screenDelta.x / drag.freePixelsPerUnit.x;
      position.y -= screenDelta.y / drag.freePixelsPerUnit.y;
    } else if (axis === 'x') {
      position.x += units;
    } else if (axis === 'y') {
      position.y += units;
    } else {
      position.z = Math.max(0.01, Math.abs(position.z) + units);
    }
    applyTransform(drag.clipId, { position });
    return;
  }

  const aspect = drag.viewport.width / Math.max(1, drag.viewport.height);
  const position = { ...start.position };
  if (axis === 'all') {
    const unitsX = screenDelta.x / drag.freePixelsPerUnit.x;
    const unitsY = screenDelta.y / drag.freePixelsPerUnit.y;
    if (drag.transformSpace === 'effector') {
      position.x += unitsX / aspect;
      position.y += unitsY;
    } else {
      position.x += unitsX;
      position.y -= unitsY;
    }

    applyTransform(drag.clipId, { position });
    return;
  }

  const delta = {
    x: drag.axisVector.x * units,
    y: drag.axisVector.y * units,
    z: drag.axisVector.z * units,
  };
  if (drag.transformSpace === 'effector') {
    position.x += delta.x / aspect;
    position.y -= delta.y;
    position.z += delta.z;
  } else {
    position.x += delta.x;
    position.y += delta.y;
    position.z += delta.z;
  }

  applyTransform(drag.clipId, { position });
}

function linesToSvgPath(lines: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>): string {
  return lines
    .map((line) => `M ${line.from.x.toFixed(2)} ${line.from.y.toFixed(2)} L ${line.to.x.toFixed(2)} ${line.to.y.toFixed(2)}`)
    .join(' ');
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
        return {
          from: { x: -WORLD_GRID_EXTENT, y: coord, z: 0 },
          to: { x: WORLD_GRID_EXTENT, y: coord, z: 0 },
        };
      }
      return {
        from: { x: coord, y: -WORLD_GRID_EXTENT, z: 0 },
        to: { x: coord, y: WORLD_GRID_EXTENT, z: 0 },
      };
    case 'yz':
      if (axis === 'y') {
        return {
          from: { x: 0, y: -WORLD_GRID_EXTENT, z: coord },
          to: { x: 0, y: WORLD_GRID_EXTENT, z: coord },
        };
      }
      return {
        from: { x: 0, y: coord, z: -WORLD_GRID_EXTENT },
        to: { x: 0, y: coord, z: WORLD_GRID_EXTENT },
      };
    case 'xz':
    default:
      if (axis === 'x') {
        return {
          from: { x: -WORLD_GRID_EXTENT, y: 0, z: coord },
          to: { x: WORLD_GRID_EXTENT, y: 0, z: coord },
        };
      }
      return {
        from: { x: coord, y: 0, z: -WORLD_GRID_EXTENT },
        to: { x: coord, y: 0, z: WORLD_GRID_EXTENT },
      };
  }
}

function buildWorldGridPaths(
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

export function SceneObjectOverlay({
  clips,
  tracks,
  selectedClipId,
  selectClip,
  canvasSize,
  viewport,
  compositionId,
  sceneNavClipId,
  previewCameraOverride,
  editCameraClip,
  editCameraTransform,
  showOnlyEditCamera = false,
  showWorldGrid = false,
  worldGridPlane = 'xz',
  toolbarPortalTarget,
  enabled,
}: SceneObjectOverlayProps) {
  const [mode, setMode] = useState<SceneGizmoMode>('move');
  const setSceneGizmoMode = useEngineStore((state) => state.setSceneGizmoMode);
  const setSceneGizmoHoveredAxis = useEngineStore((state) => state.setSceneGizmoHoveredAxis);
  const [hoveredAxis, setHoveredAxis] = useState<SceneGizmoAxis | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timelineSnapshotTick, setTimelineSnapshotTick] = useState(0);
  const endedDragRef = useRef(false);
  const hoveredAxisRef = useRef<SceneGizmoAxis | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRuntimeRef = useRef<DragRuntime>({
    target: null,
    hasPointerLock: false,
    accumulatedX: 0,
    accumulatedY: 0,
    lastClientX: 0,
    lastClientY: 0,
    rotationRingLastAngle: null,
    rotationRingAccumulatedRadians: 0,
    rotationAngularLastAngle: null,
    rotationAngularAccumulatedRadians: 0,
  });

  const releasePointerLock = useCallback(() => {
    const { target } = dragRuntimeRef.current;
    if (target && document.pointerLockElement === target) {
      document.exitPointerLock();
    }
    dragRuntimeRef.current.hasPointerLock = false;
    dragRuntimeRef.current.target = null;
  }, []);

  const requestPointerLock = useCallback((target: HTMLElement, fallbackTarget?: HTMLElement) => {
    if (!target.requestPointerLock) return;

    try {
      const result = target.requestPointerLock();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => {
            if (dragRuntimeRef.current.target === target) {
              dragRuntimeRef.current.hasPointerLock = document.pointerLockElement === target;
            }
          },
          () => {
            if (fallbackTarget && fallbackTarget !== target) {
              dragRuntimeRef.current.target = fallbackTarget;
              requestPointerLock(fallbackTarget);
            } else if (dragRuntimeRef.current.target === target) {
              dragRuntimeRef.current.hasPointerLock = false;
            }
          },
        );
      } else {
        requestAnimationFrame(() => {
          if (dragRuntimeRef.current.target === target) {
            dragRuntimeRef.current.hasPointerLock = document.pointerLockElement === target;
          }
        });
      }
    } catch {
      if (fallbackTarget && fallbackTarget !== target) {
        dragRuntimeRef.current.target = fallbackTarget;
        requestPointerLock(fallbackTarget);
      } else {
        dragRuntimeRef.current.hasPointerLock = false;
      }
    }
  }, []);

  const updateHoveredAxis = useCallback((axis: SceneGizmoAxis | null) => {
    if (hoveredAxisRef.current === axis) return;
    hoveredAxisRef.current = axis;
    setHoveredAxis(axis);
    setSceneGizmoHoveredAxis(axis);
    engine.requestRender();
  }, [setSceneGizmoHoveredAxis]);

  const handleAxisHover = useCallback((axis: SceneGizmoAxis | null) => {
    if (axis === null && dragRuntimeRef.current.target) {
      return;
    }
    updateHoveredAxis(axis);
  }, [updateHoveredAxis]);

  useEffect(() => () => {
    hoveredAxisRef.current = null;
    setSceneGizmoHoveredAxis(null);
    engine.requestRender();
  }, [setSceneGizmoHoveredAxis]);

  useEffect(() => {
    if (!enabled) return;

    const intervalId = window.setInterval(() => {
      if (useTimelineStore.getState().isPlaying) return;
      setTimelineSnapshotTick((tick) => (tick + 1) % 1000000);
    }, OVERLAY_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setSceneGizmoMode(mode);
    updateHoveredAxis(null);
    engine.requestRender();
  }, [enabled, mode, setSceneGizmoMode, updateHoveredAxis]);

  const { camera, objects } = useMemo(
    () => {
      void timelineSnapshotTick;
      const { clipKeyframes, playheadPosition } = useTimelineStore.getState();
      const collected = collectPreviewSceneObjects({
        clips,
        tracks,
        clipKeyframes,
        playheadPosition,
        viewport,
        canvasSize,
        compositionId,
        sceneNavClipId,
        previewCameraOverride,
      });
      const editCameraObject = editCameraClip && editCameraTransform
        ? buildCameraPreviewSceneObject(editCameraClip, editCameraTransform, collected.camera, viewport, canvasSize)
        : null;
      let mergedObjects: PreviewSceneObject[];
      if (showOnlyEditCamera) {
        mergedObjects = editCameraObject ? [editCameraObject] : [];
      } else if (editCameraObject) {
        mergedObjects = [
          editCameraObject,
          ...collected.objects.filter((object) => object.clipId !== editCameraObject.clipId),
        ];
      } else {
        mergedObjects = collected.objects;
      }
      return { camera: collected.camera, objects: mergedObjects };
    },
    [
      canvasSize,
      clips,
      compositionId,
      editCameraClip,
      editCameraTransform,
      previewCameraOverride,
      sceneNavClipId,
      showOnlyEditCamera,
      timelineSnapshotTick,
      tracks,
      viewport,
    ],
  );

  const selectedObject = useMemo(
    () => objects.find((object) => object.clipId === selectedClipId) ?? null,
    [objects, selectedClipId],
  );
  const displayObjects = useMemo(
    () => resolveDisplayObjects(objects, canvasSize),
    [canvasSize, objects],
  );
  const cameraWireframePaths = useMemo<DisplayCameraWireframePath[]>(
    () => objects.flatMap((object) => {
      const lines = buildCameraWireframeLines(object, camera, canvasSize);
      if (lines.length === 0) return [];

      return (['body', 'frustum', 'direction'] as const).flatMap((role) => {
        const roleLines = lines.filter((line) => line.role === role);
        if (roleLines.length === 0) return [];
        return [{
          key: `${object.clipId}-${role}`,
          d: linesToSvgPath(roleLines),
          role,
          selected: object.clipId === selectedClipId,
        }];
      });
    }),
    [camera, canvasSize, objects, selectedClipId],
  );
  const worldGridPaths = useMemo<DisplayWorldGridPath[]>(
    () => (showWorldGrid ? buildWorldGridPaths(camera, canvasSize, worldGridPlane) : []),
    [camera, canvasSize, showWorldGrid, worldGridPlane],
  );

  const axisHandles = useMemo<SceneAxisScreenHandle[]>(() => {
    if (!selectedObject || !selectedObject.screen.visible) return [];
    return AXES.map((axis) => resolveAxisScreenHandle(
      axis,
      selectedObject.worldPosition,
      camera,
      canvasSize,
      selectedObject.axisBasis[axis],
    ));
  }, [camera, canvasSize, selectedObject]);
  const rotateRings = useMemo<ProjectedRotateRing[]>(() => {
    if (!selectedObject || !selectedObject.screen.visible) return [];
    return axisHandles
      .map((handle) => buildProjectedRotateRing(handle, selectedObject, camera, canvasSize))
      .filter((ring): ring is ProjectedRotateRing => ring !== null);
  }, [axisHandles, camera, canvasSize, selectedObject]);

  const getObjectTransform = useCallback((object: PreviewSceneObject, clip: TimelineClip): ClipTransform => {
    if (object.kind === 'camera' && editCameraClip?.id === object.clipId && editCameraTransform) {
      return cloneTransform(editCameraTransform);
    }
    return cloneTransform(clip.transform);
  }, [editCameraClip?.id, editCameraTransform]);

  const applyObjectTransform = useCallback((clipId: string, transform: Partial<ClipTransform>) => {
    applySceneObjectTransform(clipId, transform);
  }, []);

  const resetObjectTransform = useCallback((
    clipId: string,
    modeToReset: SceneGizmoMode,
    transform: Partial<ClipTransform>,
  ) => {
    resetSceneObjectTransform(clipId, modeToReset, transform);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragState) return;
    releasePointerLock();
    if (!dragState.transient && !endedDragRef.current) {
      endedDragRef.current = true;
      endBatch();
    }
    setDragState(null);
    updateHoveredAxis(null);
  }, [dragState, releasePointerLock, updateHoveredAxis]);

  useEffect(() => {
    if (enabled && selectedObject?.screen.visible) return;
    updateHoveredAxis(null);
  }, [enabled, selectedObject?.clipId, selectedObject?.screen.visible, updateHoveredAxis]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerLockChange = () => {
      const { target } = dragRuntimeRef.current;
      dragRuntimeRef.current.hasPointerLock = target !== null && document.pointerLockElement === target;
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const runtime = dragRuntimeRef.current;
      const pointerLockActive = runtime.target !== null && document.pointerLockElement === runtime.target;
      runtime.hasPointerLock = pointerLockActive;

      let deltaX: number;
      let deltaY: number;
      if (pointerLockActive) {
        deltaX = event.movementX;
        deltaY = event.movementY;
      } else {
        deltaX = event.clientX - runtime.lastClientX;
        deltaY = event.clientY - runtime.lastClientY;
        runtime.lastClientX = event.clientX;
        runtime.lastClientY = event.clientY;
      }

      const speedMultiplier = getDragSpeedMultiplier(event);
      runtime.accumulatedX += deltaX * speedMultiplier;
      runtime.accumulatedY += deltaY * speedMultiplier;

      const screenDistance =
        runtime.accumulatedX * dragState.direction.x +
        runtime.accumulatedY * dragState.direction.y;
      applyDragTransform(dragState, screenDistance, {
        x: runtime.accumulatedX,
        y: runtime.accumulatedY,
      }, runtime, applyObjectTransform);
    };

    const handleMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      endDrag();
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockChange);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      releasePointerLock();
    };
  }, [applyObjectTransform, dragState, endDrag, releasePointerLock]);

  useEffect(() => {
    if (!enabled || !selectedObject) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'KeyW') {
        event.preventDefault();
        setMode('move');
      } else if (event.code === 'KeyE') {
        event.preventDefault();
        setMode('rotate');
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        setMode('scale');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, selectedObject]);

  const handleObjectPointerDown = useCallback((event: ReactPointerEvent, object: PreviewSceneObject) => {
    event.preventDefault();
    event.stopPropagation();
    selectClip(object.clipId, event.shiftKey);
  }, [selectClip]);

  const startGizmoDrag = useCallback((params: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
    object: PreviewSceneObject;
    axis: SceneGizmoDragAxis;
    direction: { x: number; y: number };
    axisVector: { x: number; y: number; z: number };
    pixelsPerUnit: number;
    freePixelsPerUnit: { x: number; y: number };
    rotationRingClientRect?: DragState['rotationRingClientRect'];
    rotationRingPoints?: ProjectedRotateRingPoint[];
    rotationStartRingAngle?: number;
  }) => {
    const clip = clips.find((candidate) => candidate.id === params.object.clipId);
    if (!clip) return;

    const transient = false;
    const lockTarget = overlayRef.current ?? document.body;
    const overlayRect = overlayRef.current?.getBoundingClientRect();
    const fallbackTarget = params.currentTarget instanceof HTMLElement ? params.currentTarget : undefined;
    const axisPlaneDrag = mode === 'move' && params.axis !== 'all' && overlayRect
      ? createAxisPlaneDrag({
          client: { x: params.clientX, y: params.clientY },
          camera,
          canvasRect: {
            left: overlayRect.left,
            top: overlayRect.top,
            width: overlayRect.width,
            height: overlayRect.height,
          },
          worldPosition: params.object.worldPosition,
          axisVector: params.axisVector,
        })
      : undefined;
    endedDragRef.current = false;
    dragRuntimeRef.current = {
      target: lockTarget,
      hasPointerLock: false,
      accumulatedX: 0,
      accumulatedY: 0,
      lastClientX: params.clientX,
      lastClientY: params.clientY,
      rotationRingLastAngle: params.rotationStartRingAngle ?? null,
      rotationRingAccumulatedRadians: 0,
      rotationAngularLastAngle: null,
      rotationAngularAccumulatedRadians: 0,
    };
    requestPointerLock(lockTarget, fallbackTarget);
    if (!transient) {
      startBatch(`Scene ${mode}`);
    }
    updateHoveredAxis(params.axis === 'all' ? null : params.axis);
    setDragState({
      clipId: params.object.clipId,
      mode,
      axis: params.axis,
      kind: params.object.kind,
      transformSpace: params.object.transformSpace,
      startTransform: getObjectTransform(params.object, clip),
      transient,
      direction: params.direction,
      axisVector: params.axisVector,
      pixelsPerUnit: params.pixelsPerUnit,
      freePixelsPerUnit: params.freePixelsPerUnit,
      ...(axisPlaneDrag ? { axisPlaneDrag } : {}),
      ...(params.rotationRingClientRect && params.rotationRingPoints && params.rotationStartRingAngle !== undefined
        ? {
            rotationRingClientRect: params.rotationRingClientRect,
            rotationRingPoints: params.rotationRingPoints,
            rotationStartRingAngle: params.rotationStartRingAngle,
          }
        : {}),
      ...(overlayRect
        ? {
            rotationCenterClient: {
              x: overlayRect.left + params.object.screen.x,
              y: overlayRect.top + params.object.screen.y,
            },
            rotationStartPointerClient: {
              x: params.clientX,
              y: params.clientY,
            },
          }
        : {}),
      viewport,
    });
  }, [camera, clips, getObjectTransform, mode, requestPointerLock, updateHoveredAxis, viewport]);

  const handleAxisMouseDown = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) return;

    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: handle.axis,
      direction: handle.direction,
      axisVector: handle.axisVector,
      pixelsPerUnit: handle.pixelsPerUnit,
      freePixelsPerUnit: { x: handle.pixelsPerUnit, y: handle.pixelsPerUnit },
    });
  }, [selectedObject, startGizmoDrag]);

  const handleAxisDoubleClick = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (!selectedObject) return;
    const clip = clips.find((candidate) => candidate.id === selectedObject.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      selectedObject.clipId,
      mode,
      buildAxisResetTransform(mode, handle.axis, selectedObject, getObjectTransform(selectedObject, clip)),
    );
  }, [clips, getObjectTransform, mode, resetObjectTransform, selectedObject]);

  const resolveRotateRingFromEvent = useCallback((event: ReactMouseEvent<SVGSVGElement>) => (
    resolveNearestRotateRing(getRotateRingEventPoint(event), rotateRings)
  ), [rotateRings]);

  const handleRotateRingMouseMove = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    updateHoveredAxis(ring?.axis ?? null);
  }, [resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleRotateRingMouseDown = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) return;

    const point = getRotateRingEventPoint(event);
    const startAngle = getPointToRingAngle(point, ring);
    const rect = event.currentTarget.getBoundingClientRect();
    updateHoveredAxis(ring.axis);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: ring.axis,
      direction: ring.handle.direction,
      axisVector: ring.handle.axisVector,
      pixelsPerUnit: ring.handle.pixelsPerUnit,
      freePixelsPerUnit: { x: ring.handle.pixelsPerUnit, y: ring.handle.pixelsPerUnit },
      ...(startAngle !== null
        ? {
            rotationRingClientRect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            rotationRingPoints: ring.points,
            rotationStartRingAngle: startAngle,
          }
        : {}),
    });
  }, [resolveRotateRingFromEvent, selectedObject, startGizmoDrag, updateHoveredAxis]);

  const handleRotateRingDoubleClick = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    updateHoveredAxis(ring.axis);
    handleAxisDoubleClick(event, ring.handle);
  }, [handleAxisDoubleClick, resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleCenterPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (event.button !== 0) return;

    if (event.detail > 1) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (object.clipId !== selectedClipId || (mode !== 'move' && mode !== 'scale')) {
      handleObjectPointerDown(event, object);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const freePixelsPerUnit = resolveCenterFreePixelsPerUnit(axisHandles);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object,
      axis: 'all',
      direction: mode === 'scale' ? CENTER_SCALE_DIRECTION : { x: 1, y: 0 },
      axisVector: { x: 0, y: 0, z: 0 },
      pixelsPerUnit: getAveragePixelsPerUnit(freePixelsPerUnit),
      freePixelsPerUnit,
    });
  }, [axisHandles, handleObjectPointerDown, mode, selectedClipId, startGizmoDrag]);

  const handleCenterDoubleClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (object.clipId !== selectedClipId) return;
    const clip = clips.find((candidate) => candidate.id === object.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      object.clipId,
      mode,
      buildCenterResetTransform(mode, object, getObjectTransform(object, clip)),
    );
  }, [clips, getObjectTransform, mode, resetObjectTransform, selectedClipId]);

  if (!enabled || canvasSize.width <= 0 || canvasSize.height <= 0) {
    return null;
  }

  if (objects.length === 0 && worldGridPaths.length === 0) {
    return null;
  }

  const toolbar = selectedObject && selectedObject.screen.visible ? (
    <div className="preview-scene-gizmo-toolbar">
      {(['move', 'rotate', 'scale'] as SceneGizmoMode[]).map((nextMode) => (
        <button
          key={nextMode}
          type="button"
          className={nextMode === mode ? 'active' : ''}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMode(nextMode);
          }}
        >
          {MODE_LABELS[nextMode]}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={overlayRef}
      className="preview-scene-object-overlay"
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
      {worldGridPaths.length > 0 && (
        <svg
          className="preview-scene-world-grid"
          width={canvasSize.width}
          height={canvasSize.height}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          aria-hidden="true"
        >
          {worldGridPaths.map((path) => (
            <path
              key={path.key}
              className={`preview-scene-world-grid-line ${path.kind}`}
              d={path.d}
            />
          ))}
        </svg>
      )}
      {cameraWireframePaths.length > 0 && (
        <svg
          className="preview-camera-wireframe"
          width={canvasSize.width}
          height={canvasSize.height}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          aria-hidden="true"
        >
          {cameraWireframePaths.map((path) => (
            <path
              key={path.key}
              className={`preview-camera-wireframe-line role-${path.role} ${path.selected ? 'selected' : ''}`}
              d={path.d}
            />
          ))}
        </svg>
      )}
      {selectedObject && selectedObject.screen.visible && (
        <>
          {mode === 'rotate' ? (
            <svg
              className="preview-scene-gizmo-rotate"
              style={{
                left: selectedObject.screen.x,
                top: selectedObject.screen.y,
                width: ROTATE_RING_VIEWBOX_SIZE,
                height: ROTATE_RING_VIEWBOX_SIZE,
              }}
              viewBox={`0 0 ${ROTATE_RING_VIEWBOX_SIZE} ${ROTATE_RING_VIEWBOX_SIZE}`}
              aria-hidden="true"
              onMouseMove={handleRotateRingMouseMove}
              onMouseDown={handleRotateRingMouseDown}
              onDoubleClick={handleRotateRingDoubleClick}
              onMouseLeave={() => handleAxisHover(null)}
            >
              {rotateRings.map((ring) => (
                <g
                  key={ring.axis}
                  className={`preview-scene-gizmo-rotate-ring axis-${ring.axis} ${hoveredAxis === ring.axis ? 'is-hovered' : ''}`}
                >
                  <path
                    className="preview-scene-gizmo-rotate-hit"
                    d={ring.path}
                  />
                  <path
                    className="preview-scene-gizmo-rotate-stroke"
                    d={ring.path}
                  />
                </g>
              ))}
            </svg>
          ) : (
            axisHandles.map((handle) => (
              <div key={`${mode}-${handle.axis}`} className="preview-scene-gizmo-axis-layer">
                <button
                  type="button"
                  className={`preview-scene-gizmo-axis axis-${handle.axis} mode-${mode} ${hoveredAxis === handle.axis ? 'is-hovered' : ''}`}
                  style={getAxisStyle(handle)}
                  aria-label={`${MODE_LABELS[mode]} ${AXIS_LABELS[handle.axis]}`}
                  onMouseEnter={() => handleAxisHover(handle.axis)}
                  onMouseLeave={() => handleAxisHover(null)}
                  onMouseDown={(event) => handleAxisMouseDown(event, handle)}
                  onDoubleClick={(event) => handleAxisDoubleClick(event, handle)}
                >
                  <span className="preview-scene-gizmo-axis-line" />
                  <span className="preview-scene-gizmo-end" />
                </button>
                <span
                  className={`preview-scene-gizmo-label axis-${handle.axis}`}
                  style={{
                    left: handle.end.x + handle.direction.x * 12,
                    top: handle.end.y + handle.direction.y * 12,
                  }}
                >
                  {AXIS_LABELS[handle.axis]}
                </span>
              </div>
            ))
          )}
        </>
      )}

      {displayObjects.map((object) => {
        if (!object.screen.visible) return null;
        const selected = object.clipId === selectedClipId;
        if (object.kind === 'camera' && !selected) return null;
        const centerDraggable = selected && (mode === 'move' || mode === 'scale');
        const label = centerDraggable ? getCenterHandleLabel(mode) : object.name;
        return (
          <button
            key={object.clipId}
            type="button"
            className={`preview-scene-object-handle kind-${object.kind} ${selected ? `selected gizmo-center mode-${mode}` : ''} ${centerDraggable ? 'center-draggable' : ''}`}
            style={{
              left: selected ? object.screen.x : object.displayX,
              top: selected ? object.screen.y : object.displayY,
            }}
            title={label}
            aria-label={label}
            onPointerDown={(event) => handleCenterPointerDown(event, object)}
            onDoubleClick={(event) => handleCenterDoubleClick(event, object)}
          >
            <span>{getObjectBadge(object.kind)}</span>
          </button>
        );
      })}
      {toolbarPortalTarget && toolbar ? createPortal(toolbar, toolbarPortalTarget) : null}
    </div>
  );
}
