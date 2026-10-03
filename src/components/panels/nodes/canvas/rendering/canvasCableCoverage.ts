import { cableRouteBounds, type CableRoute, type CableSegment } from '../cableRoute';
import { canvasCableRoute } from './cableGeometry';
import { queryCanvasCableCovers } from './cableOcclusion';
import type { CanvasCable, Point, Rect } from './nodeCanvasTypes';

export interface CoverageCounters { visits: number; segments: number; boundaries: number; pieces: number }
export interface CoveredRoute { route: CableRoute; depth: number }
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
function point(from: Point, s: CableSegment, t: number): Point {
  if (!s.c1 || !s.c2) return lerp(from, s.to, t);
  return lerp(lerp(lerp(from, s.c1, t), lerp(s.c1, s.c2, t), t),
    lerp(lerp(s.c1, s.c2, t), lerp(s.c2, s.to, t), t), t);
}
function split(from: Point, s: CableSegment, t: number): [CableSegment, CableSegment] {
  if (!s.c1 || !s.c2) return [{ to: lerp(from, s.to, t) }, s];
  const a = lerp(from, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.to, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  return [{ c1: a, c2: d, to: lerp(d, e, t) }, { c1: e, c2: c, to: s.to }];
}
function portion(from: Point, segment: CableSegment, lo: number, hi: number): CableRoute {
  const left = hi === 1 ? segment : split(from, segment, hi)[0];
  return { from: lo === 0 ? from : point(from, segment, lo),
    segments: [lo === 0 ? left : split(from, left, lo / hi)[1]] };
}

/** Roots at rectangle boundaries. Split cubics into monotone intervals first,
 * so bisection also finds backward bends without approximating the drawn curve. */
function crossings(from: Point, segment: CableSegment, axis: 'x' | 'y', value: number): number[] {
  const p0 = from[axis], p3 = segment.to[axis];
  if (!segment.c1 || !segment.c2) {
    const t = (value - p0) / (p3 - p0);
    return t > 0 && t < 1 ? [t] : [];
  }
  const p1 = segment.c1[axis], p2 = segment.c2[axis];
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 3 * p0 - 6 * p1 + 3 * p2, c = 3 * (p1 - p0);
  const at = (t: number) => ((a * t + b) * t + c) * t + p0 - value;
  const turns = [0, 1];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) turns.push(-c / (2 * b)); }
  else {
    const discriminant = 4 * b * b - 12 * a * c;
    if (discriminant >= 0) { const d = Math.sqrt(discriminant); turns.push((-2 * b - d) / (6 * a), (-2 * b + d) / (6 * a)); }
  }
  const intervals = turns.filter(t => t >= 0 && t <= 1).toSorted((x, y) => x - y), roots: number[] = [];
  for (let i = 1; i < intervals.length; i++) {
    let lo = intervals[i - 1], hi = intervals[i];
    const first = at(lo), last = at(hi);
    if (Math.abs(first) < 1e-9) roots.push(lo);
    if (first * last >= 0) continue;
    for (let step = 0; step < 32; step++) { const mid = (lo + hi) / 2; if ((at(mid) < 0) === (first < 0)) lo = mid; else hi = mid; }
    roots.push((lo + hi) / 2);
  }
  return roots.filter(t => t > 0 && t < 1);
}

/** Clip the one-dimensional route, not a partition of the entire group plane.
 * Work follows visible segment/group intersections. Long smart routes query each
 * narrow leg separately, avoiding the thousands of covers in their overall hull.
 * De Casteljau subdivision preserves the original cubic exactly. */
export function coveredCanvasCableRoutes(cable: CanvasCable, viewport: Rect, counters?: CoverageCounters): CoveredRoute[] {
  const route = canvasCableRoute(cable).route, result: CoveredRoute[] = [];
  const appearance = !cable.disappearing ? cable.appearance ?? 1 : 1;
  let from = route.from;
  for (let i = 0; i < route.segments.length; i++) {
    const original = route.segments[i], amount = Math.min(1, appearance * route.segments.length - i);
    if (amount <= 0) break;
    const segment = amount < 1 ? split(from, original, amount)[0] : original;
    if (counters) counters.segments++;
    const bounds = cableRouteBounds({ from, segments: [segment] });
    const x = Math.max(bounds.x, viewport.x), y = Math.max(bounds.y, viewport.y);
    const right = Math.min(bounds.x + bounds.width, viewport.x + viewport.width);
    const bottom = Math.min(bounds.y + bounds.height, viewport.y + viewport.height);
    if (right < x || bottom < y) { from = original.to; continue; }
    const covers = queryCanvasCableCovers(cable, { x, y, width: right - x, height: bottom - y }, counters);
    const xs = new Set([viewport.x, viewport.x + viewport.width]), ys = new Set([viewport.y, viewport.y + viewport.height]);
    for (const r of covers) { xs.add(r.x); xs.add(r.x + r.width); ys.add(r.y); ys.add(r.y + r.height); }
    const cuts = [0, 1];
    for (const [axis, values] of [['x', xs], ['y', ys]] as const) for (const value of values) {
      if (value < bounds[axis] || value > bounds[axis] + bounds[axis === 'x' ? 'width' : 'height']) continue;
      if (counters) counters.boundaries++;
      cuts.push(...crossings(from, segment, axis, value));
    }
    const sorted = cuts.toSorted((a, b) => a - b);
    let last: { lo: number; hi: number; depth: number } | undefined;
    const flush = () => {
      if (!last) return;
      const part = portion(from, segment, last.lo, last.hi), previous = result.at(-1);
      const end = previous?.route.segments.at(-1)?.to;
      if (previous?.depth === last.depth && end && Math.abs(end.x - part.from.x) < 1e-7 && Math.abs(end.y - part.from.y) < 1e-7) previous.route.segments.push(...part.segments);
      else { result.push({ route: part, depth: last.depth }); if (counters) counters.pieces++; }
    };
    for (let j = 1; j < sorted.length; j++) {
      const lo = sorted[j - 1], hi = sorted[j];
      if (hi - lo < 1e-10) continue;
      const p = point(from, segment, (lo + hi) / 2);
      if (!inside(p, viewport)) { flush(); last = undefined; continue; }
      const depth = queryCanvasCableCovers(cable, { ...p, width: 0, height: 0 }, counters).length;
      if (last?.depth === depth) last.hi = hi;
      else { flush(); last = { lo, hi, depth }; }
    }
    flush(); from = original.to;
  }
  return result;
}
