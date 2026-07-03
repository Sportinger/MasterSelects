import { inferMaskVertexHandleMode } from '../../../utils/maskVertexHandles';
import type { ClipMask, MaskPathKeyframeValue, MaskVertex } from "../../../types/masks";
import type {
  MaskOverlayPoint,
  PenEdgeInsertPreview,
  ProjectMaskPoint,
  SplitSegmentResult,
} from './maskOverlayTypes';

const MIN_HANDLE_LENGTH = 24;

export function constrainHandleDelta(dx: number, dy: number, shiftKey: boolean): MaskOverlayPoint {
  if (!shiftKey) return { x: dx, y: dy };

  const length = Math.hypot(dx, dy);
  if (length < 0.000001) return { x: 0, y: 0 };

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.cos(snappedAngle) * length,
    y: Math.sin(snappedAngle) * length,
  };
}

function lerpPoint(a: MaskOverlayPoint, b: MaskOverlayPoint, t: number): MaskOverlayPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function isZeroHandle(handle: MaskOverlayPoint): boolean {
  return Math.hypot(handle.x, handle.y) < 0.000001;
}

export function getDisplayHandleEndpoint(
  vertex: MaskVertex,
  handleType: 'handleIn' | 'handleOut',
  previousVertex: MaskOverlayPoint | undefined,
  nextVertex: MaskOverlayPoint | undefined,
  minHandleLength = MIN_HANDLE_LENGTH,
): MaskOverlayPoint {
  const handle = handleType === 'handleIn' ? vertex.handleIn : vertex.handleOut;
  const handleLength = Math.hypot(handle.x, handle.y);

  if (handleLength >= minHandleLength) {
    return {
      x: vertex.x + handle.x,
      y: vertex.y + handle.y,
    };
  }

  const neighbor = handleType === 'handleIn' ? previousVertex : nextVertex;
  const fallbackDirection = handleType === 'handleIn' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const rawDirection = handleLength > 0.001
    ? { x: handle.x, y: handle.y }
    : neighbor
      ? { x: neighbor.x - vertex.x, y: neighbor.y - vertex.y }
      : fallbackDirection;
  const directionLength = Math.hypot(rawDirection.x, rawDirection.y);
  const direction = directionLength > 0.001
    ? { x: rawDirection.x / directionLength, y: rawDirection.y / directionLength }
    : fallbackDirection;

  return {
    x: vertex.x + direction.x * minHandleLength,
    y: vertex.y + direction.y * minHandleLength,
  };
}

function cubicPoint(
  p0: MaskOverlayPoint,
  p1: MaskOverlayPoint,
  p2: MaskOverlayPoint,
  p3: MaskOverlayPoint,
  t: number,
): MaskOverlayPoint {
  const a = lerpPoint(p0, p1, t);
  const b = lerpPoint(p1, p2, t);
  const c = lerpPoint(p2, p3, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  return lerpPoint(d, e, t);
}

export function splitMaskSegment(mask: ClipMask, preview: PenEdgeInsertPreview): SplitSegmentResult | null {
  const prev = mask.vertices.find(vertex => vertex.id === preview.prevVertexId);
  const next = mask.vertices.find(vertex => vertex.id === preview.nextVertexId);
  if (!prev || !next) return null;

  const p0 = { x: prev.x, y: prev.y };
  const p1 = { x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y };
  const p2 = { x: next.x + next.handleIn.x, y: next.y + next.handleIn.y };
  const p3 = { x: next.x, y: next.y };
  const t = preview.t;

  if (isZeroHandle(prev.handleOut) && isZeroHandle(next.handleIn)) {
    return {
      vertex: {
        x: preview.x,
        y: preview.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        handleMode: 'none',
      },
      prevHandleOut: { x: 0, y: 0 },
      nextHandleIn: { x: 0, y: 0 },
    };
  }

  const p01 = lerpPoint(p0, p1, t);
  const p12 = lerpPoint(p1, p2, t);
  const p23 = lerpPoint(p2, p3, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const p = lerpPoint(p012, p123, t);
  const insertedVertex: Omit<MaskVertex, 'id'> = {
    x: p.x,
    y: p.y,
    handleIn: { x: p012.x - p.x, y: p012.y - p.y },
    handleOut: { x: p123.x - p.x, y: p123.y - p.y },
  };

  return {
    vertex: {
      ...insertedVertex,
      handleMode: inferMaskVertexHandleMode({ id: 'preview', ...insertedVertex }),
    },
    prevHandleOut: { x: p01.x - p0.x, y: p01.y - p0.y },
    nextHandleIn: { x: p23.x - p3.x, y: p23.y - p3.y },
  };
}

export function buildMaskPathValueWithVertexUpdates(
  mask: ClipMask,
  vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>,
): MaskPathKeyframeValue {
  const updatesById = new Map(vertexUpdates.map(({ id, updates }) => [id, updates]));
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => {
      const updates = updatesById.get(vertex.id);
      const nextVertex = updates ? { ...vertex, ...updates } : vertex;
      return {
        ...nextVertex,
        handleIn: updates?.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
        handleOut: updates?.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
      };
    }),
  };
}

export function getNearestMaskEdgeInsert(
  mask: ClipMask,
  point: MaskOverlayPoint,
  canvasWidth: number,
  canvasHeight: number,
  maxDistancePx: number,
  projectPoint?: ProjectMaskPoint,
  pointerCanvas?: MaskOverlayPoint,
): PenEdgeInsertPreview | null {
  if (mask.vertices.length < 2) return null;

  const posX = mask.position?.x || 0;
  const posY = mask.position?.y || 0;
  const pointerX = pointerCanvas?.x ?? point.x * canvasWidth;
  const pointerY = pointerCanvas?.y ?? point.y * canvasHeight;
  const segmentCount = mask.closed ? mask.vertices.length : mask.vertices.length - 1;
  let closest: PenEdgeInsertPreview | null = null;
  let closestDistance = maxDistancePx;

  for (let index = 0; index < segmentCount; index += 1) {
    const prev = mask.vertices[index];
    const next = mask.vertices[(index + 1) % mask.vertices.length];
    if (!prev || !next) continue;

    const p0 = { x: prev.x, y: prev.y };
    const p1 = { x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y };
    const p2 = { x: next.x + next.handleIn.x, y: next.y + next.handleIn.y };
    const p3 = { x: next.x, y: next.y };

    for (let step = 1; step < 40; step += 1) {
      const t = step / 40;
      const sample = cubicPoint(p0, p1, p2, p3, t);
      const projected = projectPoint
        ? projectPoint({ x: sample.x + posX, y: sample.y + posY })
        : { x: (sample.x + posX) * canvasWidth, y: (sample.y + posY) * canvasHeight };
      const sampleDistance = Math.hypot(projected.x - pointerX, projected.y - pointerY);

      if (sampleDistance < closestDistance) {
        closestDistance = sampleDistance;
        closest = {
          insertIndex: index + 1,
          prevVertexId: prev.id,
          nextVertexId: next.id,
          t,
          x: sample.x,
          y: sample.y,
          canvasX: projected.x,
          canvasY: projected.y,
        };
      }
    }
  }

  return closest;
}
