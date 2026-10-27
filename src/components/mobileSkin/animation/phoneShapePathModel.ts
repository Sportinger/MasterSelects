// Pure geometry of the phone shape path editor. Motion shape paths live in local pixels with the
// origin at the shape centre (MotionPathVertex); the engine renders the shape into a texture of
// getMotionRenderSize() centred on that origin and places it with the clip transform, so a local
// point maps to the composition through the texture's box (the desktop gizmo's
// calculateLayerOverlayBounds). Finger strokes become a few smooth vertices (Ramer-Douglas-Peucker
// simplification, then Catmull-Rom handles).

import { getMotionRenderSize } from '../../../engine/motion/MotionTypes';
import type { MotionLayerDefinition, MotionPathVertex } from '../../../types/motionDesign';
import { calculateLayerOverlayBounds, type OverlayPoint } from '../../preview/editModeOverlayMath';

export const PHONE_PATH_MAX_VERTICES = 128;
export const PHONE_PATH_MIN_VERTICES = 2;

export interface PhoneShapeFrame {
  origin: OverlayPoint;
  /** Composition pixels per local unit along local x and local y (the texture box edges, normalized). */
  u: OverlayPoint;
  v: OverlayPoint;
}

/** The affine frame local pixels -> composition pixels for a motion shape clip at its transform. */
export function phoneShapeFrame(
  motion: MotionLayerDefinition,
  transform: { position: { x: number; y: number }; scale: { x: number; y: number }; rotationRadians: number },
  comp: { width: number; height: number },
): PhoneShapeFrame {
  const size = getMotionRenderSize(motion);
  const bounds = calculateLayerOverlayBounds({
    sourceWidth: size.width, sourceHeight: size.height,
    outputWidth: comp.width, outputHeight: comp.height, canvasWidth: comp.width, canvasHeight: comp.height,
    position: transform.position, scale: transform.scale, rotation: transform.rotationRadians,
  });
  const { tl, tr, bl } = bounds.corners;
  const u = { x: (tr.x - tl.x) / size.width, y: (tr.y - tl.y) / size.width };
  const v = { x: (bl.x - tl.x) / size.height, y: (bl.y - tl.y) / size.height };
  return { origin: { x: bounds.x, y: bounds.y }, u, v };
}

export function localToComp(frame: PhoneShapeFrame, point: OverlayPoint): OverlayPoint {
  return { x: frame.origin.x + point.x * frame.u.x + point.y * frame.v.x, y: frame.origin.y + point.x * frame.u.y + point.y * frame.v.y };
}

export function compToLocal(frame: PhoneShapeFrame, point: OverlayPoint): OverlayPoint {
  const det = frame.u.x * frame.v.y - frame.u.y * frame.v.x;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  const dx = point.x - frame.origin.x;
  const dy = point.y - frame.origin.y;
  return { x: (dx * frame.v.y - dy * frame.v.x) / det, y: (frame.u.x * dy - frame.u.y * dx) / det };
}

function perpendicularDistance(p: OverlayPoint, a: OverlayPoint, b: OverlayPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

/** Ramer-Douglas-Peucker: the stroke's corner points within `tolerance` (same units as the points). */
export function simplifyPhoneStroke(points: readonly OverlayPoint[], tolerance: number): OverlayPoint[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  let index = -1;
  let distance = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > distance) { distance = d; index = i; }
  }
  if (distance <= tolerance || index < 0) return [{ ...points[0] }, { ...points[points.length - 1] }];
  const left = simplifyPhoneStroke(points.slice(0, index + 1), tolerance);
  const right = simplifyPhoneStroke(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * A finger stroke (local pixels) as smooth path vertices: simplified, capped at 128 points, with
 * Catmull-Rom tangents as mirrored handles (the ends keep straight handles).
 */
export function phoneStrokeToVertices(stroke: readonly OverlayPoint[], tolerance: number, closed = false): MotionPathVertex[] {
  let points = simplifyPhoneStroke(stroke, tolerance);
  let grow = tolerance;
  while (points.length > PHONE_PATH_MAX_VERTICES) {
    grow *= 1.5;
    points = simplifyPhoneStroke(stroke, grow);
  }
  if (closed && points.length > 2 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < tolerance * 3) points = points.slice(0, -1);
  const count = points.length;
  return points.map((point, index) => {
    const hasPrev = closed || index > 0;
    const hasNext = closed || index < count - 1;
    if (!hasPrev || !hasNext || count < 3) return { x: point.x, y: point.y, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } };
    const prev = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    const tangent = { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 };
    return { x: point.x, y: point.y, handleIn: { x: -tangent.x, y: -tangent.y }, handleOut: { ...tangent } };
  });
}

/** Each segment's cubic (point, out handle, next in handle, next point), in local pixels. */
export function phonePathSegments(vertices: readonly MotionPathVertex[], closed: boolean): [OverlayPoint, OverlayPoint, OverlayPoint, OverlayPoint][] {
  const count = vertices.length;
  const last = closed ? count : count - 1;
  const segments: [OverlayPoint, OverlayPoint, OverlayPoint, OverlayPoint][] = [];
  for (let index = 0; index < last; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % count];
    segments.push([
      { x: a.x, y: a.y },
      { x: a.x + a.handleOut.x, y: a.y + a.handleOut.y },
      { x: b.x + b.handleIn.x, y: b.y + b.handleIn.y },
      { x: b.x, y: b.y },
    ]);
  }
  return segments;
}

/** Moves vertex `index` to `to`, keeping its handles. */
export function movePhonePathVertex(vertices: readonly MotionPathVertex[], index: number, to: OverlayPoint): MotionPathVertex[] {
  return vertices.map((vertex, i) => (i === index ? { ...vertex, x: to.x + 0, y: to.y + 0 } : vertex));
}
