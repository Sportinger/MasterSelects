// Pen path of the phone mask sheet as plain data: points in clip coordinates (0..1, the editor's mask
// vertex space) with mirrored or corner Bezier handles. Pure functions: the overlay and the sheet
// change a path only through these, and toPhonePenMaskPatch turns it into the full ClipMask state the
// sheet writes with the timeline store's updateMask (the same data the desktop pen tool produces).

import type { ClipMask, MaskVertex } from '../../../types/masks';

export interface PhonePenPoint {
  /** Stable within one path; the vertex id is `${maskId}-${id}`. */
  id: string;
  x: number;
  y: number;
  /** Outgoing handle relative to the point; the incoming handle mirrors it. Zero = a sharp corner. */
  handleX: number;
  handleY: number;
}

export interface PhonePenPath {
  points: PhonePenPoint[];
  closed: boolean;
  /** Next point id number; never reused inside one path, so undo + add never collides. */
  nextId: number;
}

export const PHONE_PEN_MASK_NAME = 'Pen Mask';
/** A closed area needs three points. */
export const PHONE_PEN_MIN_POINTS = 3;

export const EMPTY_PHONE_PEN_PATH: PhonePenPath = { points: [], closed: false, nextId: 1 };

function finite(value: number): number {
  return Number.isFinite(value) ? value + 0 : 0;
}

export function addPhonePenPoint(path: PhonePenPath, x: number, y: number): PhonePenPath {
  if (path.closed) return path;
  const point: PhonePenPoint = { id: `p${path.nextId}`, x: finite(x), y: finite(y), handleX: 0, handleY: 0 };
  return { ...path, points: [...path.points, point], nextId: path.nextId + 1 };
}

export function movePhonePenPoint(path: PhonePenPath, index: number, x: number, y: number): PhonePenPath {
  if (!path.points[index]) return path;
  return { ...path, points: path.points.map((point, i) => (i === index ? { ...point, x: finite(x), y: finite(y) } : point)) };
}

/** Sets the outgoing handle of point `index` (the incoming one mirrors it). */
export function setPhonePenHandle(path: PhonePenPath, index: number, handleX: number, handleY: number): PhonePenPath {
  if (!path.points[index]) return path;
  return { ...path, points: path.points.map((point, i) => (i === index ? { ...point, handleX: finite(handleX), handleY: finite(handleY) } : point)) };
}

/** Removes the last point while drawing; on a closed path it first reopens the path. */
export function undoPhonePenPoint(path: PhonePenPath): PhonePenPath {
  if (path.closed) return { ...path, closed: false };
  if (path.points.length === 0) return path;
  return { ...path, points: path.points.slice(0, -1) };
}

export function canClosePhonePenPath(path: PhonePenPath): boolean {
  return !path.closed && path.points.length >= PHONE_PEN_MIN_POINTS;
}

export function closePhonePenPath(path: PhonePenPath): PhonePenPath {
  return canClosePhonePenPath(path) ? { ...path, closed: true } : path;
}

export function phonePenVertices(path: PhonePenPath, maskId: string): MaskVertex[] {
  return path.points.map((point) => {
    const sharp = point.handleX === 0 && point.handleY === 0;
    return {
      id: `${maskId}-${point.id}`,
      x: point.x,
      y: point.y,
      handleIn: { x: finite(-point.handleX), y: finite(-point.handleY) },
      handleOut: { x: point.handleX, y: point.handleY },
      handleMode: sharp ? 'none' : 'mirrored',
    };
  });
}

/** Full mask state for the pen path: what the sheet writes with updateMask (absolute, never a delta). */
export function toPhonePenMaskPatch(path: PhonePenPath, maskId: string, look: { feather: number; inverted: boolean }): Partial<ClipMask> {
  return {
    name: PHONE_PEN_MASK_NAME,
    vertices: phonePenVertices(path, maskId),
    closed: path.closed,
    mode: 'add',
    opacity: 1,
    enabled: true,
    inverted: look.inverted,
    feather: Math.max(0, finite(look.feather)),
    featherOffset: 0,
    featherBalance: 0,
    rotation: 0,
    position: { x: 0, y: 0 },
  };
}

/** Index of the point nearest to `target` within `radius` (all in display pixels), or -1. */
export function hitPhonePenPoint(points: readonly { x: number; y: number }[], target: { x: number; y: number }, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** One line for the sheet: what the next tap does. */
export function describePhonePenPath(path: PhonePenPath): string {
  const count = path.points.length;
  if (path.closed) return `Closed path with ${count} points. Drag a point to move it, drag its round handle to bend the curve.`;
  if (count === 0) return 'Tap the preview to place the first point. Keep your finger down and drag to pull a curve.';
  if (count < PHONE_PEN_MIN_POINTS) return `${count} point${count === 1 ? '' : 's'}. Tap to add more; a mask needs at least ${PHONE_PEN_MIN_POINTS}.`;
  return `${count} points. Tap the first point (or Close path) to close the mask.`;
}
