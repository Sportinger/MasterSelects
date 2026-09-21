import type { CanvasCable, Point } from './nodeCanvasTypes';

export function cablePoint(from: Point, to: Point, t: number): Point {
  const h = Math.max(72, Math.abs(to.x - from.x) * 0.42), u = 1 - t;
  return { x: u ** 3 * from.x + 3 * u * u * t * (from.x + h) + 3 * u * t * t * (to.x - h) + t ** 3 * to.x,
    y: u ** 3 * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t ** 3 * to.y };
}

export function makeCanvasCable(from: Point, to: Point, color: string, highlighted = false, draft = false): CanvasCable {
  return { from, to, color, highlighted, draft };
}

const arcLengths = new WeakMap<CanvasCable, { points: Point[]; distances: number[]; length: number }>();
/** Only active signal animation needs arc-length samples. Keep them on the
 * painter side instead of rebuilding and cloning 49 points per wire per frame. */
export function cableArcLengths(cable: CanvasCable) {
  const cached = arcLengths.get(cable);
  if (cached) return cached;
  const points = Array.from({ length: 49 }, (_, i) => cablePoint(cable.from, cable.to, i / 48));
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const result = { points, distances, length: distances.at(-1)! };
  arcLengths.set(cable, result);
  return result;
}

export function signalPosition(cable: CanvasCable, fraction: number): Point {
  const { length, distances, points } = cableArcLengths(cable);
  const distance = fraction * length;
  const index = Math.max(1, distances.findIndex(value => value >= distance));
  const before = points[index - 1], after = points[index];
  const t = (distance - distances[index - 1]) / (distances[index] - distances[index - 1] || 1);
  return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
}
