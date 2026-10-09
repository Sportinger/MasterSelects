import type { CurveSet } from './geometryEvaluation';

/** Advect material points on a fixed closed path, without creating or deleting stitch crossings. */
export function flowClosedCurves(curves: CurveSet, phase: number, distance = false): CurveSet {
  if (!Number.isFinite(phase)) throw new Error('Closed Curve Flow needs a finite travel value.');
  const { positions, starts, counts, radius } = curves;
  const output = new Float32Array(positions.length), scales = radius && new Float32Array(radius.length);
  const turn = ((phase % 1) + 1) % 1;
  for (let strand = 0; strand < counts.length; strand++) {
    const start = starts[strand], segments = counts[strand] - 1, end = start + segments;
    if (segments < 2 || Math.hypot(positions[start * 3] - positions[end * 3], positions[start * 3 + 1] - positions[end * 3 + 1],
      positions[start * 3 + 2] - positions[end * 3 + 2]) > 1e-6) throw new Error('Closed Curve Flow requires closed curves with a repeated endpoint.');
    const arc = distance ? new Float64Array(segments + 1) : null;
    if (arc) for (let i = 1; i <= segments; i++) {
      const a = (start + i - 1) * 3, b = a + 3;
      arc[i] = arc[i - 1] + Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    }
    const length = arc?.[segments] ?? 0;
    if (arc && !Number.isFinite(length)) throw new Error('Closed Curve Flow received non-finite curve positions.');
    const travel = arc && length > 0 ? ((phase % length) + length) % length : 0;
    const shift = turn * segments;
    for (let i = 0; i < segments; i++) {
      let at = i + shift;
      if (arc) {
        // Keep the incoming material spacing and find its shifted distance on the
        // current polyline. Empty/duplicate segments must never divide by zero.
        at = i;
        if (length > 0 && travel !== 0) {
          const position = (arc[i] + travel) % length;
          let low = 0, high = segments;
          while (low + 1 < high) {
            const mid = Math.floor((low + high) / 2);
            if (arc[mid] <= position) low = mid; else high = mid;
          }
          const span = arc[high] - arc[low];
          at = low + (span > 0 ? (position - arc[low]) / span : 0);
        }
      }
      const lower = Math.floor(at), mix = at - lower, a = start + lower % segments, b = start + (lower + 1) % segments;
      for (let axis = 0; axis < 3; axis++) output[(start + i) * 3 + axis] = positions[a * 3 + axis] * (1 - mix) + positions[b * 3 + axis] * mix;
      if (scales && radius) scales[start + i] = radius[a] * (1 - mix) + radius[b] * mix;
    }
    output.set(output.subarray(start * 3, start * 3 + 3), end * 3);
    if (scales) scales[end] = scales[start];
  }
  return { ...curves, positions: output, ...(scales ? { radius: scales } : {}) };
}
