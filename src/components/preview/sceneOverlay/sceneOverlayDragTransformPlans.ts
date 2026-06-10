import type { ClipTransform } from "../../../types/timelineCore";
import type { SceneGizmoAxis } from '../sceneObjectOverlayMath';
import { getPointToProjectedRingPointsAngle, normalizeAngleRadians, ROTATE_RING_VIEWBOX_SIZE } from './sceneOverlayProjectionPlans';
import { buildScaleUpdate } from './sceneOverlayTransformPlans';
import { resolveAxisPlaneDragUnits } from './sceneOverlayDragGeometry';
import type { ClipTransformPatch, DragRuntime, DragState } from './sceneOverlayTypes';

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

export function applyDragTransform(
  drag: DragState,
  screenDistance: number,
  screenDelta: { x: number; y: number },
  runtime: DragRuntime | undefined,
  applyTransform: (clipId: string, transform: ClipTransformPatch) => void,
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

      const startAll = start.scale.all ?? 1;
      const factor = axis === 'all'
        ? Math.max(0.01, 1 + screenDistance / 160)
        : Math.max(0.01, startAll + scaleDelta);
      const nextZoom = axis === 'all'
        ? Math.max(0.01, startAll * factor)
        : factor;
      applyTransform(drag.clipId, {
        scale: {
          all: nextZoom,
        },
      });
      return;
    }

    if (axis === 'all') {
      const factor = Math.max(0.001, 1 + screenDistance / 160);
      applyTransform(drag.clipId, {
        scale: { all: (start.scale.all ?? 1) * factor },
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
