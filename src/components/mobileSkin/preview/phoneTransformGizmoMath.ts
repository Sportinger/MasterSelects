// Pure math of the phone transform handles: one finger moves the clip, two fingers scale (pinch),
// rotate (twist) and move it (midpoint). Values are the crop sheet's transform values (composition
// pixels, uniform scale, degrees); the result is absolute, so a re-applied gesture never adds up.
// Snapping uses the desktop's axis snap (editModeSnapping.resolveAxisSnapDelta) against the frame
// edges, its centre and the composition guides.

import { resolveAxisSnapDelta, type AxisSnapPoints } from '../../preview/editModeSnapping';
import type { LayerOverlayBounds, OverlayPoint } from '../../preview/editModeOverlayMath';
import type { PhoneTransformKey, PhoneTransformValues } from '../crop/phoneCropGeometry';

export const PHONE_GIZMO_MIN_SCALE = 0.01;
export const PHONE_GIZMO_MAX_SCALE = 100;
/** Rotation snaps to whole quarter turns within this many degrees. */
export const PHONE_GIZMO_ROTATION_SNAP_DEG = 4;

export interface PhoneGizmoStart {
  values: PhoneTransformValues;
  /** The clip's box in composition pixels when the gesture began. */
  bounds: LayerOverlayBounds;
  /** Finger positions (composition pixels) when this phase of the gesture began. */
  fingers: OverlayPoint[];
}

export interface PhoneGizmoResult {
  values: PhoneTransformValues;
  keys: PhoneTransformKey[];
  /** Composition-pixel line the clip snapped to on each axis (for the snap guides), or null. */
  snappedX: number | null;
  snappedY: number | null;
  rotationSnapped: boolean;
}

export interface PhoneGizmoSnap {
  enabled: boolean;
  comp: { width: number; height: number };
  guides: AxisSnapPoints;
  /** Snap distance in composition pixels. */
  threshold: number;
}

function midpoint(points: readonly OverlayPoint[]): OverlayPoint {
  const n = Math.max(1, points.length);
  return { x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n };
}

function boxExtents(bounds: LayerOverlayBounds): { xs: number[]; ys: number[] } {
  const corners = [bounds.corners.tl, bounds.corners.tr, bounds.corners.br, bounds.corners.bl];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    xs: [Math.min(...xs), bounds.x, Math.max(...xs)],
    ys: [Math.min(...ys), bounds.y, Math.max(...ys)],
  };
}

/** Snap targets: the frame edges and centre plus the composition guides. */
export function phoneGizmoSnapTargets(comp: { width: number; height: number }, guides: AxisSnapPoints): AxisSnapPoints {
  return {
    x: [0, comp.width / 2, comp.width, ...guides.x],
    y: [0, comp.height / 2, comp.height, ...guides.y],
  };
}

/**
 * Degrees between the line through two fingers and the x axis, in screen orientation (y down, so a
 * clockwise twist grows it). The clip's rotation.z turns the picture counter-clockwise on screen
 * (calculateLayerOverlayBounds, the desktop gizmo's projection), hence the minus below.
 */
function fingerAngle(a: OverlayPoint, b: OverlayPoint): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Wraps a degree difference into -180..180. */
function wrapDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function resolvePhoneGizmo(start: PhoneGizmoStart, fingers: readonly OverlayPoint[], snap: PhoneGizmoSnap): PhoneGizmoResult {
  const from = midpoint(start.fingers);
  const to = midpoint(fingers);
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const values: PhoneTransformValues = { ...start.values };
  const keys: PhoneTransformKey[] = ['position.x', 'position.y'];
  let rotationSnapped = false;

  if (start.fingers.length >= 2 && fingers.length >= 2) {
    const startGap = Math.hypot(start.fingers[1].x - start.fingers[0].x, start.fingers[1].y - start.fingers[0].y);
    const gap = Math.hypot(fingers[1].x - fingers[0].x, fingers[1].y - fingers[0].y);
    if (startGap > 1e-3) {
      const factor = gap / startGap;
      values.scale = Math.min(PHONE_GIZMO_MAX_SCALE, Math.max(PHONE_GIZMO_MIN_SCALE, start.values.scale * factor));
    }
    let rotation = start.values.rotation - wrapDegrees(fingerAngle(fingers[0], fingers[1]) - fingerAngle(start.fingers[0], start.fingers[1]));
    if (snap.enabled) {
      const quarter = Math.round(rotation / 90) * 90;
      if (Math.abs(rotation - quarter) <= PHONE_GIZMO_ROTATION_SNAP_DEG) {
        rotation = quarter;
        rotationSnapped = true;
      }
    }
    values.rotation = rotation + 0;
    keys.push('scale.all', 'rotation.z');
  }

  let snappedX: number | null = null;
  let snappedY: number | null = null;
  // Snap only a pure move: while pinching the box changes size, the fingers decide.
  if (snap.enabled && keys.length === 2) {
    const targets = phoneGizmoSnapTargets(snap.comp, snap.guides);
    const extents = boxExtents(start.bounds);
    const sx = resolveAxisSnapDelta(extents.xs.map((x) => x + dx), targets.x, snap.threshold);
    const sy = resolveAxisSnapDelta(extents.ys.map((y) => y + dy), targets.y, snap.threshold);
    if (sx !== 0 || extents.xs.some((x) => targets.x.some((t) => Math.abs(x + dx - t) < 1e-6))) {
      dx += sx;
      snappedX = targets.x.find((t) => extents.xs.some((x) => Math.abs(x + dx - t) < 1e-6)) ?? null;
    }
    if (sy !== 0 || extents.ys.some((y) => targets.y.some((t) => Math.abs(y + dy - t) < 1e-6))) {
      dy += sy;
      snappedY = targets.y.find((t) => extents.ys.some((y) => Math.abs(y + dy - t) < 1e-6)) ?? null;
    }
  }

  values.x = start.values.x + dx;
  values.y = start.values.y + dy;
  return { values, keys, snappedX, snappedY, rotationSnapped };
}
