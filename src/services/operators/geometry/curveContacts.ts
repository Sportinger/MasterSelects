import type { CurveSet } from './geometryEvaluation';
import { RodContacts, type RodSegments } from './rodContacts';

export const CONTACT_POINT_LIMIT = 16_384;
export interface CurveContactSpec { radius: number; iterations: number; smoothing: number }

/** Frame-local capsule projection. No integration, friction, or playback-order-dependent state. */
export function separateCurveContacts(curves: CurveSet, spec: CurveContactSpec): CurveSet {
  const { positions, starts, counts } = curves;
  if (positions.length / 3 > CONTACT_POINT_LIMIT) throw new Error(`Curve Contact supports up to ${CONTACT_POINT_LIMIT} points.`);
  if (!positions.length || spec.radius <= 0) return curves;
  const source: number[] = [], map = new Uint32Array(positions.length / 3), ranges: { start: number; count: number; closed: boolean }[] = [];
  // Weld the repeated end of closed yarn rings, preserving the original output topology and colors.
  for (let strand = 0; strand < counts.length; strand++) {
    const first = starts[strand], count = counts[strand], end = first + count - 1;
    const closed = count > 2 && Math.hypot(positions[first * 3] - positions[end * 3],
      positions[first * 3 + 1] - positions[end * 3 + 1], positions[first * 3 + 2] - positions[end * 3 + 2]) < 1e-6;
    const start = source.length, unique = count - Number(closed);
    for (let i = 0; i < unique; i++) { map[first + i] = source.length; source.push(first + i); }
    if (closed) map[end] = start;
    ranges.push({ start, count: unique, closed });
  }
  const p = new Float64Array(source.length * 3), radii = new Float64Array(source.length), weights = new Float64Array(source.length).fill(1);
  for (let i = 0; i < source.length; i++) {
    p.set(positions.subarray(source[i] * 3, source[i] * 3 + 3), i * 3);
    radii[i] = spec.radius * Math.max(0, Math.min(1, curves.radius?.[source[i]] ?? 1));
  }
  const original = p.slice(), previous = new Int32Array(source.length).fill(-1), next = previous.slice();
  const a: number[] = [], b: number[] = [], rest: number[] = [], rod: number[] = [], arc: number[] = [];
  const rodLength = new Float64Array(ranges.length), rodClosed = new Uint8Array(ranges.length);
  ranges.forEach((range, strand) => {
    const { start, count, closed } = range;
    rodClosed[strand] = Number(closed);
    for (let i = 0; i < count - Number(!closed); i++) {
      const u = start + i, v = start + (i + 1) % count;
      const length = Math.hypot(p[u * 3] - p[v * 3], p[u * 3 + 1] - p[v * 3 + 1], p[u * 3 + 2] - p[v * 3 + 2]);
      a.push(u); b.push(v); rest.push(length); rod.push(strand); arc.push(rodLength[strand] + length / 2);
      rodLength[strand] += length; previous[v] = u; next[u] = v;
    }
  });
  const segments: RodSegments = { a: Uint32Array.from(a), b: Uint32Array.from(b), rest: Float64Array.from(rest),
    rod: Uint32Array.from(rod), arc: Float64Array.from(arc), rodLength, rodClosed };
  const contacts = new RodContacts(segments, spec.radius, { deforming: true, radii, sequential: true });
  const smooth = p.slice();
  for (let iteration = 0; iteration < spec.iterations; iteration++) {
    // Spread corrections, not the input shape. Finish with contact-only passes so smoothing cannot reintroduce overlap.
    if (iteration > 0 && iteration < spec.iterations / 2 && spec.smoothing > 0) {
      smooth.set(p);
      for (let i = 0; i < source.length; i++) {
        const left = previous[i], right = next[i];
        if (left < 0 || right < 0) continue;
        for (let axis = 0; axis < 3; axis++) {
          const index = i * 3 + axis, l = left * 3 + axis, r = right * 3 + axis;
          const correction = (smooth[l] - original[l] + smooth[r] - original[r]) / 2;
          p[index] += spec.smoothing * (correction - (smooth[index] - original[index]));
        }
      }
    }
    contacts.update(p);
    const penetration = contacts.solve(p, original, weights, 0);
    if (penetration < spec.radius * 0.001) break;
  }
  const output = new Float32Array(positions.length);
  for (let i = 0; i < map.length; i++) output.set(p.subarray(map[i] * 3, map[i] * 3 + 3), i * 3);
  return { ...curves, positions: output };
}
