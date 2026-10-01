import type { CurveSet } from './geometryEvaluation';

/** Extend stage: `points` new points continue each end straight over `length`. */
export interface ExtendSpec { length: number; points: number }

/**
 * Direction leaving a curve at its end: the second-order one-sided tangent 3·p0 - 4·p1 + p2, so a
 * curve sampled at a turning point (a knit loop head) leaves straight; else from the nearest distinct point.
 */
function outward(positions: Float32Array, end: number, step: number, count: number, out: number[]) {
  if (count >= 3) {
    const a = end * 3, b = (end + step) * 3, c = (end + 2 * step) * 3;
    for (let axis = 0; axis < 3; axis++) out[axis] = 3 * positions[a + axis] - 4 * positions[b + axis] + positions[c + axis];
    const size = Math.hypot(out[0], out[1], out[2]);
    if (size > 1e-9) { out[0] /= size; out[1] /= size; out[2] /= size; return; }
  }
  for (let k = 1; k < count; k++) {
    const inner = end + step * k;
    const dx = positions[end * 3] - positions[inner * 3], dy = positions[end * 3 + 1] - positions[inner * 3 + 1];
    const dz = positions[end * 3 + 2] - positions[inner * 3 + 2], size = Math.hypot(dx, dy, dz);
    if (size > 1e-9) { out[0] = dx / size; out[1] = dy / size; out[2] = dz / size; return; }
  }
  out[0] = 0; out[1] = 0; out[2] = 0;
}

/**
 * Continues every curve straight beyond both ends along its end direction, so threads of a fabric
 * run on out of frame. Rings open at their seam. Radius scales carry over from the end points.
 */
export function extendCurves(spec: ExtendSpec, curves: CurveSet): CurveSet {
  const { positions, starts, counts, radius } = curves, strands = counts.length, extra = 2 * spec.points;
  const next: CurveSet = { positions: new Float32Array(positions.length + strands * extra * 3), starts: new Uint32Array(strands),
    counts: new Uint32Array(strands), ...(radius ? { radius: new Float32Array(radius.length + strands * extra) } : {}) };
  const direction = [0, 0, 0];
  let cursor = 0;
  for (let strand = 0; strand < strands; strand++) {
    const first = starts[strand], count = counts[strand], last = first + count - 1;
    next.starts[strand] = cursor; next.counts[strand] = count + extra;
    const tail = (end: number, k: number) => {
      const along = spec.length * k / spec.points;
      for (let axis = 0; axis < 3; axis++) next.positions[cursor * 3 + axis] = positions[end * 3 + axis] + direction[axis] * along;
      if (radius) next.radius![cursor] = radius[end];
      cursor++;
    };
    outward(positions, first, 1, count, direction);
    for (let k = spec.points; k >= 1; k--) tail(first, k);
    next.positions.set(positions.subarray(first * 3, (last + 1) * 3), cursor * 3);
    if (radius) next.radius!.set(radius.subarray(first, last + 1), cursor);
    cursor += count;
    outward(positions, last, -1, count, direction);
    for (let k = 1; k <= spec.points; k++) tail(last, k);
  }
  return next;
}
