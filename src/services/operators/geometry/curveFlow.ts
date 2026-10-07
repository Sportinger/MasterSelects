import type { CurveSet } from './geometryEvaluation';

/** Advect material points on a fixed closed path, without creating or deleting stitch crossings. */
export function flowClosedCurves(curves: CurveSet, phase: number): CurveSet {
  const { positions, starts, counts, radius } = curves;
  const output = new Float32Array(positions.length), scales = radius && new Float32Array(radius.length);
  const turn = ((phase % 1) + 1) % 1;
  for (let strand = 0; strand < counts.length; strand++) {
    const start = starts[strand], segments = counts[strand] - 1, end = start + segments;
    if (segments < 2 || Math.hypot(positions[start * 3] - positions[end * 3], positions[start * 3 + 1] - positions[end * 3 + 1],
      positions[start * 3 + 2] - positions[end * 3 + 2]) > 1e-6) throw new Error('Closed Curve Flow requires closed curves with a repeated endpoint.');
    const shift = turn * segments;
    for (let i = 0; i < segments; i++) {
      const at = i + shift, lower = Math.floor(at), mix = at - lower, a = start + lower % segments, b = start + (lower + 1) % segments;
      for (let axis = 0; axis < 3; axis++) output[(start + i) * 3 + axis] = positions[a * 3 + axis] * (1 - mix) + positions[b * 3 + axis] * mix;
      if (scales && radius) scales[start + i] = radius[a] * (1 - mix) + radius[b] * mix;
    }
    output.set(output.subarray(start * 3, start * 3 + 3), end * 3);
    if (scales) scales[end] = scales[start];
  }
  return { ...curves, positions: output, ...(scales ? { radius: scales } : {}) };
}
