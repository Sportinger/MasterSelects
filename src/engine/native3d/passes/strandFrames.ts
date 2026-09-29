import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';

/** Floats per point in the strand point buffer: position, arc length, frame normal, radius scale, tangent. */
export const STRAND_POINT_FLOATS = 12;

/**
 * Packs render data per point: [x, y, z, arcLength, nx, ny, nz, radiusScale, tx, ty, tz, 0]. Normals are
 * rotation-minimizing frames (double reflection, Wang et al. 2008), so yarn twist driven by arc
 * length does not pick up spurious rotation where a curve bends.
 */
export function packStrandPoints(curves: CurveSet): Float32Array {
  const { positions, starts, counts, radius } = curves;
  const packed = new Float32Array((positions.length / 3) * STRAND_POINT_FLOATS);
  const point = (index: number): [number, number, number] => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const normalize = (a: number[], fallback: number[]) => { const length = Math.hypot(a[0], a[1], a[2]); return length > 1e-12 ? a.map(v => v / length) : fallback; };
  const reflect = (v: number[], axis: number[], c: number) => { const k = 2 * dot(axis, v) / c; return [v[0] - k * axis[0], v[1] - k * axis[1], v[2] - k * axis[2]]; };
  for (let strand = 0; strand < counts.length; strand++) {
    const start = starts[strand], count = counts[strand];
    const tangents: number[][] = [];
    for (let i = 0; i < count; i++) {
      const previous = point(start + Math.max(0, i - 1)), next = point(start + Math.min(count - 1, i + 1));
      tangents.push(normalize(sub(next, previous), tangents[i - 1] ?? [1, 0, 0]));
    }
    const first = tangents[0], axis = Math.abs(first[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let normal = normalize(sub(axis, first.map(v => v * dot(axis, first))), [0, 1, 0]);
    let arc = 0;
    for (let i = 0; i < count; i++) {
      const index = start + i, p = point(index), base = index * STRAND_POINT_FLOATS;
      if (i > 0) {
        const v1 = sub(p, point(index - 1)), c1 = dot(v1, v1);
        arc += Math.sqrt(c1);
        if (c1 > 1e-18) {
          const reflectedNormal = reflect(normal, v1, c1), reflectedTangent = reflect(tangents[i - 1], v1, c1);
          const v2 = sub(tangents[i], reflectedTangent), c2 = dot(v2, v2);
          normal = normalize(c2 > 1e-18 ? reflect(reflectedNormal, v2, c2) : reflectedNormal, normal);
        }
      }
      const t = tangents[i];
      packed.set([p[0], p[1], p[2], arc, normal[0], normal[1], normal[2], radius ? radius[index] : 1, t[0], t[1], t[2], 0], base);
    }
  }
  return packed;
}
