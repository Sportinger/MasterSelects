import type {
  MotionVector2,
  PathShapeDefinition,
} from '../../../types/motionDesign';
import { MOTION_PATH_MAX_FLATTENED_VERTICES } from '../../../types/motionDesign';

export interface FlattenedMotionPath {
  /** Polyline points. For closed paths the LAST point is a duplicate of the first,
   *  so consumers always walk simple consecutive edges without wrap logic. */
  points: MotionVector2[];
  /** cumulativeLengths[i] = arc length from points[0] to points[i]; [0] === 0. */
  cumulativeLengths: number[];
  totalLength: number;
  closed: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const DEFAULT_FLATTEN_TOLERANCE = 0.25;
const MAX_SUBDIVISION_DEPTH = 20;

function midpoint(left: MotionVector2, right: MotionVector2): MotionVector2 {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function squaredDistanceToLine(
  point: MotionVector2,
  start: MotionVector2,
  end: MotionVector2,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLengthSquared = dx * dx + dy * dy;
  if (chordLengthSquared === 0) {
    const pointDx = point.x - start.x;
    const pointDy = point.y - start.y;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  return (cross * cross) / chordLengthSquared;
}

function isFlatEnough(
  p0: MotionVector2,
  c1: MotionVector2,
  c2: MotionVector2,
  p1: MotionVector2,
  toleranceSquared: number,
): boolean {
  return Math.max(
    squaredDistanceToLine(c1, p0, p1),
    squaredDistanceToLine(c2, p0, p1),
  ) <= toleranceSquared;
}

function appendPoint(points: MotionVector2[], point: MotionVector2): void {
  const previous = points[points.length - 1];
  if (previous?.x === point.x && previous.y === point.y) return;
  points.push({ x: point.x, y: point.y });
}

function flattenCubic(
  points: MotionVector2[],
  p0: MotionVector2,
  c1: MotionVector2,
  c2: MotionVector2,
  p1: MotionVector2,
  toleranceSquared: number,
  depth: number,
): void {
  if (
    depth >= MAX_SUBDIVISION_DEPTH
    || isFlatEnough(p0, c1, c2, p1, toleranceSquared)
  ) {
    appendPoint(points, p1);
    return;
  }

  const p01 = midpoint(p0, c1);
  const p12 = midpoint(c1, c2);
  const p23 = midpoint(c2, p1);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);

  flattenCubic(points, p0, p01, p012, split, toleranceSquared, depth + 1);
  flattenCubic(points, split, p123, p23, p1, toleranceSquared, depth + 1);
}

function appendSegment(
  points: MotionVector2[],
  start: PathShapeDefinition['vertices'][number],
  end: PathShapeDefinition['vertices'][number],
  toleranceSquared: number,
): void {
  const isStraight =
    start.handleOut.x === 0 && start.handleOut.y === 0
    && end.handleIn.x === 0 && end.handleIn.y === 0;
  if (isStraight) {
    appendPoint(points, end);
    return;
  }

  flattenCubic(
    points,
    start,
    { x: start.x + start.handleOut.x, y: start.y + start.handleOut.y },
    { x: end.x + end.handleIn.x, y: end.y + end.handleIn.y },
    end,
    toleranceSquared,
    0,
  );
}

function decimatePoints(points: MotionVector2[]): MotionVector2[] {
  if (points.length <= MOTION_PATH_MAX_FLATTENED_VERTICES) return points;

  const lastIndex = points.length - 1;
  return Array.from(
    { length: MOTION_PATH_MAX_FLATTENED_VERTICES },
    (_, index) => points[Math.round(
      index * lastIndex / (MOTION_PATH_MAX_FLATTENED_VERTICES - 1),
    )],
  );
}

export function flattenMotionPath(
  path: PathShapeDefinition,
  tolerance = DEFAULT_FLATTEN_TOLERANCE,
): FlattenedMotionPath | null {
  if (path.vertices.length < 2) return null;

  const resolvedTolerance = Number.isFinite(tolerance) && tolerance > 0
    ? tolerance
    : DEFAULT_FLATTEN_TOLERANCE;
  const toleranceSquared = resolvedTolerance * resolvedTolerance;
  const first = path.vertices[0];
  let points: MotionVector2[] = [{ x: first.x, y: first.y }];

  for (let index = 1; index < path.vertices.length; index += 1) {
    appendSegment(
      points,
      path.vertices[index - 1],
      path.vertices[index],
      toleranceSquared,
    );
  }

  if (path.closed) {
    appendSegment(
      points,
      path.vertices[path.vertices.length - 1],
      first,
      toleranceSquared,
    );
    const last = points[points.length - 1];
    if (last.x !== first.x || last.y !== first.y) {
      points.push({ x: first.x, y: first.y });
    }
  }

  points = decimatePoints(points);

  const cumulativeLengths = [0];
  let totalLength = 0;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    cumulativeLengths.push(totalLength);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (totalLength === 0) return null;

  return {
    points,
    cumulativeLengths,
    totalLength,
    closed: path.closed,
    bounds: { minX, minY, maxX, maxY },
  };
}
