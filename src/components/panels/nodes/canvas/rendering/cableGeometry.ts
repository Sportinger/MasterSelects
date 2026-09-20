import type { CanvasCable, Point } from './nodeCanvasTypes';

export function cablePoint(from: Point, to: Point, t: number): Point {
  const h = Math.max(72, Math.abs(to.x - from.x) * 0.42), u = 1 - t;
  return { x: u ** 3 * from.x + 3 * u * u * t * (from.x + h) + 3 * u * t * t * (to.x - h) + t ** 3 * to.x,
    y: u ** 3 * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t ** 3 * to.y };
}

export function makeCanvasCable(from: Point, to: Point, color: string, highlighted = false, draft = false): CanvasCable {
  const points = Array.from({ length: 49 }, (_, i) => cablePoint(from, to, i / 48));
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { from, to, color, highlighted, draft, points, distances, length: distances.at(-1)! };
}

export function signalPosition(cable: CanvasCable, fraction: number): Point {
  const distance = fraction * cable.length;
  const index = Math.max(1, cable.distances.findIndex(value => value >= distance));
  const before = cable.points[index - 1], after = cable.points[index];
  const t = (distance - cable.distances[index - 1]) / (cable.distances[index] - cable.distances[index - 1] || 1);
  return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
}
