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
import type { AnimatableProperty, ClipTransform, TimelineClip, TimelineTrack } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import type { SceneViewport } from '../../engine/scene/types';
import {
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
  enabled: boolean;
}

type SceneGizmoDragAxis = SceneGizmoAxis | 'all';

interface DragState {
  clipId: string;
  mode: SceneGizmoMode;
  axis: SceneGizmoDragAxis;
  kind: PreviewSceneObject['kind'];
  transformSpace: PreviewSceneObject['transformSpace'];
  startTransform: ClipTransform;
  direction: { x: number; y: number };
  axisVector: { x: number; y: number; z: number };
  pixelsPerUnit: number;
  freePixelsPerUnit: { x: number; y: number };
  rotationCenterClient?: { x: number; y: number };
  rotationStartPointerClient?: { x: number; y: number };
  rotationRingClientRect?: { left: number; top: number; width: number; height: number };
  rotationRingPoints?: ProjectedRotateRingPoint[];
  rotationStartRingAngle?: number;
  viewport: SceneViewport;
}

interface DragRuntime {
  target: HTMLElement | null;
  hasPointerLock: boolean;
  accumulatedX: number;
  accumulatedY: number;
  lastClientX: number;
  lastClientY: number;
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
const ROTATE_RING_SCREEN_RADIUS = 112;
const ROTATE_RING_SEGMENTS = 96;
const ROTATE_RING_HIT_THRESHOLD = 28;

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

function applyLocalAxisRotation(
  startRotation: ClipTransform['rotation'],
  axis: SceneGizmoAxis,
  degrees: number,
): ClipTransform['rotation'] {
  const startMatrix = buildRotationMatrixFromDegrees(startRotation);
  const localDelta = buildLocalAxisRotationMatrix(axis, degrees);
  return matrixToRotationDegrees(multiplyMat3(startMatrix, localDelta));
}

function resolveAngularDragDegrees(
  drag: DragState,
  screenDelta: { x: number; y: number },
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
  return (normalizeAngleRadians(currentAngle - startAngle) * 180) / Math.PI;
}

function resolveProjectedRingDragDegrees(
  drag: DragState,
  screenDelta: { x: number; y: number },
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

  return (normalizeAngleRadians(currentAngle - drag.rotationStartRingAngle) * 180) / Math.PI;
}

function applyDragTransform(drag: DragState, screenDistance: number, screenDelta: { x: number; y: number }): void {
  const units = screenDistance / drag.pixelsPerUnit;
  const start = drag.startTransform;
  const axis = drag.axis;

  if (drag.mode === 'rotate') {
    if (axis === 'all') return;
    const degrees =
      resolveProjectedRingDragDegrees(drag, screenDelta) ??
      resolveAngularDragDegrees(drag, screenDelta) ??
      screenDistance * 0.6;
    applySceneObjectTransform(drag.clipId, {
      rotation: applyLocalAxisRotation(start.rotation, axis, degrees),
    });
    return;
  }

  if (drag.mode === 'scale') {
    if (axis === 'all') {
      const factor = Math.max(0.001, 1 + screenDistance / 160);
      const includeZ = drag.kind !== 'plane' || start.scale.z !== undefined;
      applySceneObjectTransform(drag.clipId, {
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
      applySceneObjectTransform(drag.clipId, {
        scale: { x: next, y: next, z: next },
      });
      return;
    }

    applySceneObjectTransform(drag.clipId, {
      scale: buildScaleUpdate(start.scale, {
        x: start.scale.x + (axis === 'x' ? scaleDelta : 0),
        y: start.scale.y + (axis === 'y' ? scaleDelta : 0),
        ...(axis === 'z' ? { z: (start.scale.z ?? 1) + scaleDelta } : {}),
      }),
    });
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

    applySceneObjectTransform(drag.clipId, { position });
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

  applySceneObjectTransform(drag.clipId, { position });
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
      return collectPreviewSceneObjects({
        clips,
        tracks,
        clipKeyframes,
        playheadPosition,
        viewport,
        canvasSize,
        compositionId,
        sceneNavClipId,
      });
    },
    [canvasSize, clips, compositionId, sceneNavClipId, timelineSnapshotTick, tracks, viewport],
  );

  const selectedObject = useMemo(
    () => objects.find((object) => object.clipId === selectedClipId) ?? null,
    [objects, selectedClipId],
  );
  const displayObjects = useMemo(
    () => resolveDisplayObjects(objects, canvasSize),
    [canvasSize, objects],
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

  const endDrag = useCallback(() => {
    if (!dragState) return;
    releasePointerLock();
    if (!endedDragRef.current) {
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
      });
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
  }, [dragState, endDrag, releasePointerLock]);

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

    const lockTarget = overlayRef.current ?? document.body;
    const overlayRect = overlayRef.current?.getBoundingClientRect();
    const fallbackTarget = params.currentTarget instanceof HTMLElement ? params.currentTarget : undefined;
    endedDragRef.current = false;
    dragRuntimeRef.current = {
      target: lockTarget,
      hasPointerLock: false,
      accumulatedX: 0,
      accumulatedY: 0,
      lastClientX: params.clientX,
      lastClientY: params.clientY,
    };
    requestPointerLock(lockTarget, fallbackTarget);
    startBatch(`Scene ${mode}`);
    updateHoveredAxis(params.axis === 'all' ? null : params.axis);
    setDragState({
      clipId: params.object.clipId,
      mode,
      axis: params.axis,
      kind: params.object.kind,
      transformSpace: params.object.transformSpace,
      startTransform: cloneTransform(clip.transform),
      direction: params.direction,
      axisVector: params.axisVector,
      pixelsPerUnit: params.pixelsPerUnit,
      freePixelsPerUnit: params.freePixelsPerUnit,
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
  }, [clips, mode, requestPointerLock, updateHoveredAxis, viewport]);

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
    resetSceneObjectTransform(
      selectedObject.clipId,
      mode,
      buildAxisResetTransform(mode, handle.axis, clip.transform),
    );
  }, [clips, mode, selectedObject]);

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
    resetSceneObjectTransform(
      object.clipId,
      mode,
      buildCenterResetTransform(mode, object, clip.transform),
    );
  }, [clips, mode, selectedClipId]);

  if (!enabled || canvasSize.width <= 0 || canvasSize.height <= 0 || objects.length === 0) {
    return null;
  }

  const toolbarOffsetX = mode === 'rotate' ? ROTATE_RING_SCREEN_RADIUS + 28 : 18;

  return (
    <div
      ref={overlayRef}
      className="preview-scene-object-overlay"
      style={{ width: canvasSize.width, height: canvasSize.height }}
    >
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
          <div
            className="preview-scene-gizmo-toolbar"
            style={{
              left: Math.min(canvasSize.width - 180, Math.max(8, selectedObject.screen.x + toolbarOffsetX)),
              top: Math.min(canvasSize.height - 34, Math.max(8, selectedObject.screen.y - 50)),
            }}
          >
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
        </>
      )}

      {displayObjects.map((object) => {
        if (!object.screen.visible) return null;
        const selected = object.clipId === selectedClipId;
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
    </div>
  );
}
