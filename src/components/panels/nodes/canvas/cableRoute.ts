import type { NodeCableStyle } from '../../../../types/nodeGraph';

interface RoutePoint { x: number; y: number }
/** A straight segment, or a cubic when both control points are present. */
export interface CableSegment { to: RoutePoint; c1?: RoutePoint; c2?: RoutePoint }
export interface CableRoute { from: RoutePoint; segments: CableSegment[] }
export interface RouteBounds { x: number; y: number; width: number; height: number }

export const NODE_CABLE_STYLES: readonly NodeCableStyle[] = ['curved', 'angular', 'smart'];
/** Horizontal run out of an output and into an input before a route turns. */
const STUB = 36;
/** Minimum drop below both ports when a backward link has no vertical gap. */
const LOOP_DROP = 120;
/** Corner radius of smart routes, in graph units. */
const CORNER_RADIUS = 56;
/** Softer corners for curved cables that detour around cards. */
const CURVED_DETOUR_RADIUS = 110;
/** Cubic handle factor that approximates a circular quarter arc. */
const ARC = 0.5523;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Orthogonal waypoints: out of the output, one vertical lane, into the input.
 * Backward links leave and enter horizontally and wrap around both ports. */
function orthogonalPoints(from: RoutePoint, to: RoutePoint): RoutePoint[] {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx > 0) {
    const x = from.x + dx / 2;
    return Math.abs(dy) < 0.5 ? [from, to] : [from, { x, y: from.y }, { x, y: to.y }, to];
  }
  const y = Math.abs(dy) > LOOP_DROP ? from.y + dy / 2 : Math.max(from.y, to.y) + LOOP_DROP;
  const out = from.x + STUB, back = to.x - STUB;
  return [from, { x: out, y: from.y }, { x: out, y }, { x: back, y }, { x: back, y: to.y }, to];
}

/** Replaces each corner by a quarter-circle-like cubic, never longer than half a leg. */
function roundCorners(points: RoutePoint[], cornerRadius = CORNER_RADIUS): CableRoute {
  const segments: CableSegment[] = [];
  const unit = (a: RoutePoint, b: RoutePoint) => { const length = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, length }; };
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1], corner = points[index], next = points[index + 1];
    const into = unit(previous, corner), out = unit(corner, next);
    const radius = Math.min(cornerRadius, into.length / 2, out.length / 2);
    const start = { x: corner.x - into.x * radius, y: corner.y - into.y * radius };
    const end = { x: corner.x + out.x * radius, y: corner.y + out.y * radius };
    segments.push({ to: start }, { c1: { x: start.x + into.x * radius * ARC, y: start.y + into.y * radius * ARC },
      c2: { x: end.x - out.x * radius * ARC, y: end.y - out.y * radius * ARC }, to: end });
  }
  segments.push({ to: points.at(-1)! });
  return { from: points[0], segments };
}

/** The single description of a cable path shared by painting, hit testing, bounds and flow signals. */
export function cableRoute(from: RoutePoint, to: RoutePoint, style: NodeCableStyle = 'curved', via?: readonly RoutePoint[]): CableRoute {
  // Obstacle-avoiding waypoints: each style keeps its character along the detour.
  if (via?.length) {
    const points = [from, ...via, to];
    if (style === 'angular') return { from, segments: points.slice(1).map(point => ({ to: point })) };
    // Stay inside the routing clearance instead of cutting across obstacle corners.
    return roundCorners(points, Math.min(24, style === 'curved' ? CURVED_DETOUR_RADIUS : CORNER_RADIUS));
  }
  if (style === 'angular') { const [start, ...rest] = orthogonalPoints(from, to); return { from: start, segments: rest.map(point => ({ to: point })) }; }
  if (style === 'smart') return roundCorners(orthogonalPoints(from, to));
  const dx = to.x - from.x;
  const h = dx > 0 ? Math.min(dx / 2, Math.max(72, dx * 0.42)) : Math.max(72, Math.abs(dx) * 0.42);
  return { from, segments: [{ c1: { x: from.x + h, y: from.y }, c2: { x: to.x - h, y: to.y }, to }] };
}

type PathSink = Pick<Path2D, 'moveTo' | 'lineTo' | 'bezierCurveTo'>;
/** Appends the route to a Canvas 2D path (context or Path2D). */
export function traceCableRoute(path: PathSink, route: CableRoute) {
  path.moveTo(route.from.x, route.from.y);
  for (const { to, c1, c2 } of route.segments) {
    if (c1 && c2) path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    else path.lineTo(to.x, to.y);
  }
}

export function cableRouteSvg(route: CableRoute): string {
  return `M ${route.from.x} ${route.from.y} ${route.segments.map(({ to, c1, c2 }) => c1 && c2
    ? `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}` : `L ${to.x} ${to.y}`).join(' ')}`;
}

function segmentPoint(start: RoutePoint, { to, c1, c2 }: CableSegment, t: number): RoutePoint {
  if (!c1 || !c2) return { x: start.x + (to.x - start.x) * t, y: start.y + (to.y - start.y) * t };
  const u = 1 - t;
  return { x: u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x,
    y: u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y };
}

/** Polyline through the route; straight segments need only their end point. */
export function sampleCableRoute(route: CableRoute, samplesPerCurve = 16): RoutePoint[] {
  const points = [route.from];
  let start = route.from;
  for (const segment of route.segments) {
    const steps = segment.c1 ? samplesPerCurve : 1;
    for (let index = 1; index <= steps; index++) points.push(segmentPoint(start, segment, index / steps));
    start = segment.to;
  }
  return points;
}

/** Point at parameter t in [0, 1], with every segment taking an equal share. */
export function cableRoutePoint(route: CableRoute, t: number): RoutePoint {
  const scaled = clamp(t, 0, 1) * route.segments.length;
  const index = Math.min(route.segments.length - 1, Math.floor(scaled));
  const start = index ? route.segments[index - 1].to : route.from;
  return segmentPoint(start, route.segments[index], scaled - index);
}

/** Midpoint by arc length and the travel direction there, for direction arrows. */
export function cableRouteMidpoint(route: CableRoute): { point: RoutePoint; angle: number } {
  const [only] = route.segments;
  if (route.segments.length === 1 && only.c1 && only.c2) {
    // A single cubic keeps its parametric middle and tangent there.
    const { from } = route, { c1, c2, to } = only;
    return { point: segmentPoint(from, only, 0.5), angle: Math.atan2(to.y + c2.y - c1.y - from.y, to.x + c2.x - c1.x - from.x) };
  }
  const points = sampleCableRoute(route, 12);
  const lengths = [0];
  for (let index = 1; index < points.length; index++) lengths.push(lengths[index - 1]
    + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  const half = lengths.at(-1)! / 2;
  const index = Math.max(1, lengths.findIndex(length => length >= half));
  const a = points[index - 1], b = points[index], t = (half - lengths[index - 1]) / (lengths[index] - lengths[index - 1] || 1);
  return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Conservative bounds: a cubic stays inside the hull of its control points. */
export function cableRouteBounds(route: CableRoute): RouteBounds {
  let left = route.from.x, right = left, top = route.from.y, bottom = top;
  for (const { to, c1, c2 } of route.segments) for (const point of [to, c1, c2]) if (point) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
