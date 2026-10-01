import type { CurveSet } from './geometryEvaluation';

/**
 * Weft-knit (stockinette) courses: one curve per row, its yarn running in loops along +X. Per
 * stitch, with t over 2π: x = (t + lean·sin 2t)·width/2π, y = height·cos t, z = depth·cos 2t
 * (Leaf et al. 2018). The loop head (t = 0) and the sinker loop (t = π) lie in front, the legs
 * behind. Rows are stacked `spacing` apart; below twice the loop height, each head reaches in front
 * of the legs of the row above and that row's sinker in front of its own legs, so the rows
 * interlock loop through loop without touching.
 */
export interface KnitSpec { stitches: number; rows: number; width: number; height: number; spacing: number; depth: number; lean: number; resolution: number }

export const knitPointCount = (spec: { stitches: number; rows: number; resolution: number }) => spec.rows * (spec.stitches * spec.resolution + 1);

/** Knit rows centred on the origin, the first row at the bottom. */
export function knitCurves(spec: KnitSpec): CurveSet {
  const { stitches, rows, width, height, spacing, depth, lean, resolution } = spec, count = stitches * resolution + 1;
  const positions = new Float32Array(rows * count * 3), starts = new Uint32Array(rows), counts = new Uint32Array(rows).fill(count);
  for (let row = 0; row < rows; row++) {
    starts[row] = row * count;
    const y = (row - (rows - 1) / 2) * spacing;
    for (let point = 0; point < count; point++) {
      const t = 2 * Math.PI * point / resolution;
      positions.set([(t + lean * Math.sin(2 * t)) * width / (2 * Math.PI) - stitches * width / 2, y + height * Math.cos(t), depth * Math.cos(2 * t)],
        (row * count + point) * 3);
    }
  }
  return { positions, starts, counts };
}
