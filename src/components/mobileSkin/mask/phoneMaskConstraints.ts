// Constrained mask point editing on the phone: touch toggles for what the desktop mask overlay does
// with modifier keys while dragging. Each rule calls the desktop's own math, so a constrained drag
// on the phone gives exactly the desktop result:
//   Lock axis      = Ctrl+Shift on a point (move along the dominant axis only)
//   Whole shape    = Ctrl on a point (resize the whole shape; rectangles stay rectangles with
//                    their angles, ellipses stay ellipses, other shapes scale about their centre)
//   Handles only   = Shift on a point (scale the point's curve handles, the point stays)
//   Snap handles   = Shift on a handle (45° steps)
//   Straight edges = Shift on an edge (keep it exactly horizontal or vertical)
//   Align neighbours = Ctrl on an edge (line the edge's points up with their outer neighbours)
// Pure functions on the phone pen path (clip uv space, the editor's mask vertex space).

import type { ClipMask } from '../../../types/masks';
import { buildMaskEdgeDragUpdates } from '../../preview/maskEdgeDragMath';
import {
  buildAngleLockedQuadVertexUpdates, buildEllipseResizeVertexUpdates, buildGlobalMaskScaleVertexUpdates, constrainHandleDelta,
} from '../../preview/useMaskVertexDrag';
import { bakedPhoneMaskVertices, type PhoneMaskParams, type PhoneMaskShape } from './phoneMaskGeometry';
import { phonePenVertices, type PhonePenPath } from './phonePenModel';

export interface PhonePenConstraints {
  axisLock: boolean;
  wholeShape: boolean;
  handlesOnly: boolean;
  snapHandles: boolean;
  straightEdges: boolean;
  alignNeighbours: boolean;
}

export type PhonePenConstraintKey = keyof PhonePenConstraints;

export const NO_PHONE_PEN_CONSTRAINTS: PhonePenConstraints = {
  axisLock: false, wholeShape: false, handlesOnly: false, snapHandles: false, straightEdges: false, alignNeighbours: false,
};

export const PHONE_PEN_CONSTRAINT_OPTIONS: readonly { key: PhonePenConstraintKey; label: string; hint: string }[] = [
  { key: 'axisLock', label: 'Lock axis', hint: 'Points move only straight across or straight up and down.' },
  { key: 'wholeShape', label: 'Whole shape', hint: 'Dragging a point resizes the whole shape; rectangles and ellipses keep their form.' },
  { key: 'handlesOnly', label: 'Handles only', hint: 'Dragging a point sideways scales its curve handles; the point stays.' },
  { key: 'snapHandles', label: 'Snap handles', hint: 'Curve handles snap to 45° steps.' },
  { key: 'straightEdges', label: 'Straight edges', hint: 'A dragged edge stays exactly horizontal or vertical.' },
  { key: 'alignNeighbours', label: 'Align neighbours', hint: 'A dragged edge lines its points up with the points next to it.' },
];

interface Point { x: number; y: number }

const MASK_ID = 'phone-constraint';

function asMask(path: PhonePenPath): ClipMask {
  return { id: MASK_ID, vertices: phonePenVertices(path, MASK_ID), closed: path.closed } as unknown as ClipMask;
}

function applyUpdates(path: PhonePenPath, updates: Array<{ id: string; updates: { x?: number; y?: number; handleOut?: Point } }>): PhonePenPath {
  const byId = new Map(updates.map((entry) => [entry.id.slice(MASK_ID.length + 1), entry.updates]));
  return {
    ...path,
    points: path.points.map((point) => {
      const change = byId.get(point.id);
      if (!change) return point;
      return {
        ...point,
        x: change.x ?? point.x,
        y: change.y ?? point.y,
        handleX: change.handleOut?.x ?? point.handleX,
        handleY: change.handleOut?.y ?? point.handleY,
      };
    }),
  };
}

/** Drops the smaller part of a move (Lock axis). */
export function lockPhoneAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

/**
 * Point `index` of `start` dragged by `delta` (uv) under the constraints. Returns the new path and
 * which rule decided it ('whole-shape' says when the desktop's shape-keeping resize applied).
 */
export function constrainPhonePointDrag(
  start: PhonePenPath, index: number, delta: Point, constraints: PhonePenConstraints,
): { path: PhonePenPath; rule: 'move' | 'axis' | 'handles' | 'ellipse' | 'rectangle' | 'scale' } {
  const point = start.points[index];
  if (!point) return { path: start, rule: 'move' };
  if (constraints.handlesOnly && !constraints.wholeShape) {
    // Desktop Shift on a point: the handles scale with the sideways drag, five times per frame width.
    const factor = 1 + delta.x * 5;
    return {
      path: { ...start, points: start.points.map((p, i) => (i === index ? { ...p, handleX: p.handleX * factor, handleY: p.handleY * factor } : p)) },
      rule: 'handles',
    };
  }
  const moved = constraints.axisLock ? lockPhoneAxis(delta) : delta;
  const target = { x: point.x + moved.x, y: point.y + moved.y };
  if (constraints.wholeShape) {
    const mask = asMask(start);
    const vertexId = `${MASK_ID}-${point.id}`;
    const ellipse = buildEllipseResizeVertexUpdates(mask, vertexId, target);
    if (ellipse) return { path: applyUpdates(start, ellipse), rule: 'ellipse' };
    const quad = buildAngleLockedQuadVertexUpdates(mask, vertexId, target);
    if (quad) return { path: applyUpdates(start, quad), rule: 'rectangle' };
    const scaled = buildGlobalMaskScaleVertexUpdates(mask, vertexId, target);
    if (scaled) return { path: applyUpdates(start, scaled), rule: 'scale' };
  }
  return {
    path: { ...start, points: start.points.map((p, i) => (i === index ? { ...p, x: target.x, y: target.y } : p)) },
    rule: constraints.axisLock ? 'axis' : 'move',
  };
}

/** A curve handle pulled to (handleX, handleY), snapped to 45° steps when asked (desktop Shift). */
export function constrainPhoneHandle(handle: Point, constraints: PhonePenConstraints): Point {
  return constrainHandleDelta(handle.x, handle.y, constraints.snapHandles);
}

/** The edge from point `index` to the next one dragged by `delta` (desktop edge drag). */
export function constrainPhoneEdgeDrag(start: PhonePenPath, index: number, delta: Point, constraints: PhonePenConstraints): PhonePenPath {
  const count = start.points.length;
  const a = start.points[index];
  const nextIndex = start.closed ? (index + 1) % count : index + 1;
  const b = start.points[nextIndex];
  if (!a || !b || a === b) return start;
  const before = start.closed || index > 0 ? start.points[(index - 1 + count) % count] : null;
  const after = start.closed || nextIndex < count - 1 ? start.points[(nextIndex + 1) % count] : null;
  const pick = (p: typeof a | null) => (p && p !== a && p !== b ? { id: p.id, x: p.x, y: p.y } : null);
  const moved = constraints.axisLock ? lockPhoneAxis(delta) : delta;
  const updates = buildMaskEdgeDragUpdates(
    { vertexA: { id: a.id, x: a.x, y: a.y }, vertexB: { id: b.id, x: b.x, y: b.y }, previousA: pick(before), nextB: pick(after) },
    moved.x, moved.y, constraints.straightEdges, constraints.alignNeighbours,
  );
  const byId = new Map(updates.map((entry) => [entry.id, entry.updates]));
  return { ...start, points: start.points.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id)! } : p)) };
}

/** Distance from `p` to the segment a-b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/**
 * Index of the segment (start point index) whose curve passes within `radius` of `target`, or -1.
 * `segments` holds each segment's projected cubic (a, c1, c2, b) in display pixels.
 */
export function hitPhonePenSegment(segments: readonly [Point, Point, Point, Point][], target: Point, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  segments.forEach(([a, c1, c2, b], index) => {
    let previous = a;
    for (let step = 1; step <= 16; step += 1) {
      const next = cubic(a, c1, c2, b, step / 16);
      const distance = segmentDistance(target, previous, next);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = index;
      }
      previous = next;
    }
  });
  return best;
}

/** Shapes the phone can turn into editable points (their curve handles are mirrored or straight). */
export const PHONE_POINT_SHAPES: ReadonlySet<PhoneMaskShape> = new Set(['rectangle', 'circle', 'star', 'heart']);

/** A phone shape mask as an editable pen path, exactly where it is drawn (rotation and position baked in). */
export function phoneShapeToPenPath(shape: PhoneMaskShape, params: PhoneMaskParams, aspect: number): PhonePenPath | null {
  if (!PHONE_POINT_SHAPES.has(shape)) return null;
  const vertices = bakedPhoneMaskVertices(shape, params, aspect, 'shape');
  const mirrored = vertices.every((v) => Math.abs(v.handleIn.x + v.handleOut.x) < 1e-6 && Math.abs(v.handleIn.y + v.handleOut.y) < 1e-6);
  if (!mirrored || vertices.length < 3) return null;
  return {
    points: vertices.map((vertex, index) => ({ id: `p${index + 1}`, x: vertex.x, y: vertex.y, handleX: vertex.handleOut.x, handleY: vertex.handleOut.y })),
    closed: true,
    nextId: vertices.length + 1,
  };
}
