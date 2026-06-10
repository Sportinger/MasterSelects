import type { Bounds2D, Point2D, TextShape } from './types';

export const EPSILON = 1e-5;

export function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

export function pointsEqual(a: Point2D, b: Point2D): boolean {
  return approxEqual(a.x, b.x) && approxEqual(a.y, b.y);
}

export function clonePoint(point: Point2D): Point2D {
  return { x: point.x, y: point.y };
}

export function polygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += (current?.x ?? 0) * (next?.y ?? 0) - (next?.x ?? 0) * (current?.y ?? 0);
  }
  return area * 0.5;
}

export function isClockwise(points: Point2D[]): boolean {
  return polygonArea(points) < 0;
}

export function ensureWinding(points: Point2D[], clockwise: boolean): Point2D[] {
  const normalized = points.map(clonePoint);
  if (normalized.length < 3) {
    return normalized;
  }
  return isClockwise(normalized) === clockwise ? normalized : normalized.reverse();
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      ((a?.y ?? 0) > point.y) !== ((b?.y ?? 0) > point.y) &&
      point.x < (((b?.x ?? 0) - (a?.x ?? 0)) * (point.y - (a?.y ?? 0))) /
        (((b?.y ?? 0) - (a?.y ?? 0)) || 1e-9) +
        (a?.x ?? 0);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function normalize2D(x: number, y: number): Point2D {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

export function computeShapesBounds(shapes: TextShape[]): Bounds2D | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (point: Point2D) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const shape of shapes) {
    shape.contour.forEach(visit);
    shape.holes.forEach((hole) => hole.forEach(visit));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function translateShapes(shapes: TextShape[], offsetX: number, offsetY: number): TextShape[] {
  return shapes.map((shape) => ({
    contour: shape.contour.map((point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    })),
    holes: shape.holes.map((hole) =>
      hole.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      }))),
  }));
}
