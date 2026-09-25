import type { NodeGraphPoint } from './canvasGeometry';
import type { NodeCableStyle } from '../../../../types/nodeGraph';
import { cableRoute, sampleCableRoute } from './cableRoute';

const SAMPLES = 20;
const CELL = 256;

interface Segment { edgeId: string; ax: number; ay: number; bx: number; by: number }

/** Same route as the painted cable, sampled into a polyline. */
function cablePolyline(from: NodeGraphPoint, to: NodeGraphPoint, style: NodeCableStyle): NodeGraphPoint[] {
  return sampleCableRoute(cableRoute(from, to, style), SAMPLES);
}

/** Closest approach between segments p0-p1 and q0-q1: distance and parameter on p. */
function segmentApproach(p0x: number, p0y: number, p1x: number, p1y: number, s: Segment) {
  const dx = p1x - p0x, dy = p1y - p0y, ex = s.bx - s.ax, ey = s.by - s.ay;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) > 1e-9) {
    const wx = s.ax - p0x, wy = s.ay - p0y;
    const t = (wx * ey - wy * ex) / denominator, u = (wx * dy - wy * dx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { distance: 0, along: t };
  }
  let best = { distance: Infinity, along: 0 };
  const consider = (px: number, py: number, along: number, ax: number, ay: number, bx: number, by: number) => {
    const lx = bx - ax, ly = by - ay, length = lx * lx + ly * ly;
    const k = length ? Math.max(0, Math.min(1, ((px - ax) * lx + (py - ay) * ly) / length)) : 0;
    const distance = Math.hypot(px - (ax + lx * k), py - (ay + ly * k));
    if (distance < best.distance) best = { distance, along };
  };
  consider(p0x, p0y, 0, s.ax, s.ay, s.bx, s.by);
  consider(p1x, p1y, 1, s.ax, s.ay, s.bx, s.by);
  const lengthP = dx * dx + dy * dy;
  for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]] as const) {
    const k = lengthP ? Math.max(0, Math.min(1, ((x - p0x) * dx + (y - p0y) * dy) / lengthP)) : 0;
    const distance = Math.hypot(x - (p0x + dx * k), y - (p0y + dy * k));
    if (distance < best.distance) best = { distance, along: k };
  }
  return best;
}

/**
 * Spatial grid over sampled cable curves. Pointer events arrive once per frame,
 * so a fast sweep jumps across thin cables; querying the swept segment between
 * two pointer samples finds every cable crossed and returns the latest one.
 */
export function createEdgeHitIndex(cables: Iterable<{ id: string; from: NodeGraphPoint; to: NodeGraphPoint }>, style: NodeCableStyle = 'curved') {
  const cells = new Map<string, Segment[]>();
  for (const cable of cables) {
    const points = cablePolyline(cable.from, cable.to, style);
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const segment = { edgeId: cable.id, ax: a.x, ay: a.y, bx: b.x, by: b.y };
      for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) {
        for (let cy = Math.floor(Math.min(a.y, b.y) / CELL); cy <= Math.floor(Math.max(a.y, b.y) / CELL); cy++) {
          const key = `${cx},${cy}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(segment); else cells.set(key, [segment]);
        }
      }
    }
  }
  return {
    /** Latest cable crossed moving from `from` to `to`, within `tolerance` world units. */
    query(from: NodeGraphPoint, to: NodeGraphPoint, tolerance: number): string | null {
      const seen = new Set<Segment>();
      let hit: { edgeId: string; along: number; distance: number } | null = null;
      for (let cx = Math.floor((Math.min(from.x, to.x) - tolerance) / CELL); cx <= Math.floor((Math.max(from.x, to.x) + tolerance) / CELL); cx++) {
        for (let cy = Math.floor((Math.min(from.y, to.y) - tolerance) / CELL); cy <= Math.floor((Math.max(from.y, to.y) + tolerance) / CELL); cy++) {
          for (const segment of cells.get(`${cx},${cy}`) ?? []) {
            if (seen.has(segment)) continue;
            seen.add(segment);
            const approach = segmentApproach(from.x, from.y, to.x, to.y, segment);
            if (approach.distance > tolerance) continue;
            if (!hit || approach.along > hit.along + 1e-6 || (Math.abs(approach.along - hit.along) <= 1e-6 && approach.distance < hit.distance)) {
              hit = { edgeId: segment.edgeId, along: approach.along, distance: approach.distance };
            }
          }
        }
      }
      return hit?.edgeId ?? null;
    },
  };
}
