import type { CurveSet } from './geometryEvaluation';
import type { GeometryField } from './geometryProgram';
import { evaluateFieldColumn } from './curveFieldColumns';

/** Lift lengths the tip travels past the curve end, so the thread lies still at progress 1. */
const SETTLE_LENGTHS = 4;

/**
 * Thread Along: each curve is pulled in along its own path behind a tip. `progress` (0 … 1, per
 * point when a field is connected) moves the tip from the start to four lift lengths past the end,
 * so the swing has settled (below 1 %) when the curve is complete;
 * `stagger` spreads the curves' starts over the progress range in curve order. Behind the tip the
 * thread rises `lift` along +Z (the rest sheet's normal) and settles with a damped swing:
 * lift · e^(−settle·x) · cos(πx/2), x in lift lengths behind the tip. Ahead of the tip the
 * curve is hidden through its radius scale. Analytic in progress, so scrubbing needs no state.
 */
export interface ThreadAlongStage {
  progress?: GeometryField;
  value: number;
  stagger: number;
  lift: number;
  liftLength: number;
  settle: number;
  /**
   * Unit direction for Ahead = Trail: the part ahead of the tip stays visible and streams from the
   * lifted tip along this direction, keeping its length, like thread still coming off the spool.
   */
  trail?: readonly [number, number, number];
}

/** Rest position at arc length `arc` along strand points `start` … `start + count - 1`. */
function pointAt(positions: Float32Array, start: number, count: number, arcs: Float64Array, arc: number): [number, number, number] {
  let k = 1;
  while (k < count - 1 && arcs[k] < arc) k++;
  const span = arcs[k] - arcs[k - 1], f = span > 0 ? Math.min(1, Math.max(0, (arc - arcs[k - 1]) / span)) : 0;
  const a = (start + k - 1) * 3, b = a + 3;
  return [positions[a] + (positions[b] - positions[a]) * f, positions[a + 1] + (positions[b + 1] - positions[a + 1]) * f,
    positions[a + 2] + (positions[b + 2] - positions[a + 2]) * f];
}

export function threadAlong(stage: ThreadAlongStage, curves: CurveSet): CurveSet {
  const { positions, starts, counts } = curves;
  const next = Float32Array.from(positions), radius = new Float32Array(positions.length / 3);
  const progressAt = stage.progress ? evaluateFieldColumn(stage.progress, curves) : () => stage.value;
  const stagger = Math.min(0.99, Math.max(0, stage.stagger)), liftLength = Math.max(1e-6, stage.liftLength);
  const strands = counts.length;
  let longest = 1;
  for (const count of counts) longest = Math.max(longest, count);
  const arcs = new Float64Array(longest);
  for (let strand = 0; strand < strands; strand++) {
    const start = starts[strand], count = counts[strand];
    for (let point = 1; point < count; point++) {
      const a = (start + point - 1) * 3, b = a + 3;
      arcs[point] = arcs[point - 1] + Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    }
    const total = count > 1 ? arcs[count - 1] : 0;
    let tip: [number, number, number] | null = null;
    for (let point = 0; point < count; point++) {
      const index = start + point, base = index * 3, arc = arcs[point];
      const raw = Number(progressAt(index));
      const progress = Math.min(1, Math.max(0, ((Number.isFinite(raw) ? raw : 0) - stagger * strand / strands) / (1 - stagger)));
      const behind = progress * (total + SETTLE_LENGTHS * liftLength) - arc;
      if (stage.trail && behind < 0) {
        // Trailing: the thread ahead of the tip leaves the lifted tip along the trail direction.
        tip ??= pointAt(positions, start, count, arcs, progress * (total + SETTLE_LENGTHS * liftLength));
        for (let axis = 0; axis < 3; axis++) next[base + axis] = tip[axis] + stage.trail[axis] * -behind;
        next[base + 2] += stage.lift;
        radius[index] = curves.radius ? curves.radius[index] : 1;
        continue;
      }
      radius[index] = progress > 0 && behind >= 0 ? (curves.radius ? curves.radius[index] : 1) : 0;
      // Hidden points ahead of the tip continue its rise along the same slope, so the tip's spline stays smooth.
      const x = Math.max(-1, behind / liftLength);
      next[base + 2] += stage.lift * (x < 0 ? 1 - stage.settle * x : Math.exp(-stage.settle * x) * Math.cos(0.5 * Math.PI * x));
    }
  }
  return { ...curves, positions: next, radius };
}
