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
}

export function threadAlong(stage: ThreadAlongStage, curves: CurveSet): CurveSet {
  const { positions, starts, counts } = curves;
  const next = Float32Array.from(positions), radius = new Float32Array(positions.length / 3);
  const progressAt = stage.progress ? evaluateFieldColumn(stage.progress, curves) : () => stage.value;
  const stagger = Math.min(0.99, Math.max(0, stage.stagger)), liftLength = Math.max(1e-6, stage.liftLength);
  const strands = counts.length;
  for (let strand = 0; strand < strands; strand++) {
    const start = starts[strand], count = counts[strand];
    let total = 0;
    for (let point = 1; point < count; point++) {
      const a = (start + point - 1) * 3, b = a + 3;
      total += Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    }
    let arc = 0;
    for (let point = 0; point < count; point++) {
      const index = start + point, base = index * 3;
      if (point > 0) arc += Math.hypot(positions[base] - positions[base - 3], positions[base + 1] - positions[base - 2], positions[base + 2] - positions[base - 1]);
      const raw = Number(progressAt(index));
      const progress = Math.min(1, Math.max(0, ((Number.isFinite(raw) ? raw : 0) - stagger * strand / strands) / (1 - stagger)));
      const behind = progress * (total + SETTLE_LENGTHS * liftLength) - arc;
      radius[index] = progress > 0 && behind >= 0 ? (curves.radius ? curves.radius[index] : 1) : 0;
      // Hidden points ahead of the tip continue its rise along the same slope, so the tip's spline stays smooth.
      const x = Math.max(-1, behind / liftLength);
      next[base + 2] += stage.lift * (x < 0 ? 1 - stage.settle * x : Math.exp(-stage.settle * x) * Math.cos(0.5 * Math.PI * x));
    }
  }
  return { ...curves, positions: next, radius };
}
