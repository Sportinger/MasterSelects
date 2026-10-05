import type { CurveSet } from './geometryEvaluation';

export interface CloseCurvesSpec {
  offset: [number, number, number];
  handle: number;
  points: number;
}

/** Append a tangent-continuous return through a waypoint behind each open strand.
 * Repeating the first point makes the seam a real closed rod edge when used before Rod Simulation.
 * This changes geometry only: closing a rope does not make its motion periodic.
 */
export function closeCurves(curves: CurveSet, spec: CloseCurvesSpec): CurveSet {
  const total = curves.positions.length / 3 + spec.points * curves.counts.length;
  const positions = new Float32Array(total * 3), starts = new Uint32Array(curves.counts.length);
  const counts = new Uint32Array(curves.counts.length), radius = curves.radius && new Float32Array(total);
  let cursor = 0;
  for (let strand = 0; strand < curves.counts.length; strand++) {
    const first = curves.starts[strand], count = curves.counts[strand], last = first + count - 1;
    const point = (index: number) => Array.from(curves.positions.subarray(index * 3, index * 3 + 3));
    const start = point(first), end = point(last);
    if (count < 2 || Math.hypot(...start.map((value, axis) => value - end[axis])) < 1e-7) {
      throw new Error('Close Curve needs open curves with distinct endpoints.');
    }
    const tangent = (from: number[], to: number[]) => {
      const delta = to.map((value, axis) => value - from[axis]), length = Math.hypot(...delta);
      return delta.map(value => value * spec.handle / Math.max(length, 1e-9));
    };
    const departing = tangent(point(last - 1), end), arriving = tangent(start, point(first + 1));
    const middle = start.map((value, axis) => (value + end[axis]) * 0.5 + spec.offset[axis]);
    const through = start.map((value, axis) => (value - end[axis]) * 0.25);
    starts[strand] = cursor; counts[strand] = count + spec.points;
    positions.set(curves.positions.subarray(first * 3, (last + 1) * 3), cursor * 3);
    if (radius && curves.radius) radius.set(curves.radius.subarray(first, last + 1), cursor);
    cursor += count;
    for (let index = 1; index <= spec.points; index++, cursor++) {
      const phase = index / spec.points, second = phase > 0.5;
      const t = second ? phase * 2 - 1 : phase * 2, s = 1 - t;
      for (let axis = 0; axis < 3; axis++) {
        const a = second ? middle[axis] : end[axis];
        const b = second ? middle[axis] + through[axis] : end[axis] + departing[axis];
        const c = second ? start[axis] - arriving[axis] : middle[axis] - through[axis];
        const d = second ? start[axis] : middle[axis];
        positions[cursor * 3 + axis] = s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
      }
      if (radius && curves.radius) radius[cursor] = curves.radius[last] * (1 - phase) + curves.radius[first] * phase;
    }
    // Exact repeated endpoint is the closed-curve contract shared by the renderer and rod solver.
    positions.set(positions.subarray(starts[strand] * 3, starts[strand] * 3 + 3), (cursor - 1) * 3);
  }
  return { positions, starts, counts, ...(radius ? { radius } : {}) };
}
