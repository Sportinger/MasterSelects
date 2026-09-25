import type { NodeCableStyle } from '../../../../../types/nodeGraph';
import { cableRoute, cableRouteBounds, cableRouteMidpoint, sampleCableRoute, type CableRoute, type RouteBounds } from '../cableRoute';
import type { CanvasCable, Point } from './nodeCanvasTypes';

export function makeCanvasCable(from: Point, to: Point, color: string, highlighted = false, draft = false, style?: NodeCableStyle): CanvasCable {
  return { from, to, color, highlighted, draft, ...(style && style !== 'curved' ? { style } : {}) };
}

interface CachedRoute { route: CableRoute; bounds: RouteBounds; middle: { point: Point; angle: number } }
// Scene, glide and drag updates create new cable objects, so identity is a safe key.
const routes = new WeakMap<CanvasCable, CachedRoute>();
export function canvasCableRoute(cable: CanvasCable): CachedRoute {
  let cached = routes.get(cable);
  if (!cached) {
    const route = cableRoute(cable.from, cable.to, cable.style);
    cached = { route, bounds: cableRouteBounds(route), middle: cableRouteMidpoint(route) };
    routes.set(cable, cached);
  }
  return cached;
}

const arcLengths = new WeakMap<CanvasCable, { points: Point[]; distances: number[]; length: number }>();
/** Only active signal animation needs arc-length samples. Keep them on the
 * painter side instead of rebuilding and cloning 49 points per wire per frame. */
export function cableArcLengths(cable: CanvasCable) {
  const cached = arcLengths.get(cable);
  if (cached) return cached;
  const { route } = canvasCableRoute(cable);
  const points = sampleCableRoute(route, route.segments.length === 1 ? 48 : 16);
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
