import { valueNoise3 } from '../../../engine/procedural/latticeNoise';

/**
 * Pure per-element field functions. The CPU curve executor calls them directly; a GPU executor
 * must provide WGSL mirrors of the same names (`requires: 'field-functions'` in the pointwise table)
 * and match these results.
 */

export const FIELD_SHAPES = ['sphere', 'box', 'plane'] as const;

/** Signed distance to a sphere (radius), a cube (half extent) or the horizontal plane through `center`. */
export function fieldShapeDistance(position: readonly number[], center: readonly number[], size: number, shape: number): number {
  const d = [position[0] - center[0], position[1] - center[1], position[2] - center[2]];
  if (shape === 2) return d[1];
  if (shape === 1) {
    const q = d.map(value => Math.abs(value) - size);
    const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
    return outside + Math.min(Math.max(q[0], q[1], q[2]), 0);
  }
  return Math.hypot(d[0], d[1], d[2]) - size;
}

/** Fractal lattice value noise in [-amplitude, amplitude]; `seed` selects an independent channel. */
export function fieldNoise(position: readonly number[], frequency: number, amplitude: number, seed: number, octaves: number): number {
  let sum = 0, weight = 1, total = 0, scale = frequency;
  const channel = Math.max(0, Math.trunc(seed)) >>> 0;
  for (let octave = 0; octave < Math.max(1, Math.min(6, Math.trunc(octaves))); octave++) {
    sum += (valueNoise3(position[0] * scale, position[1] * scale, position[2] * scale, channel + octave) * 2 - 1) * weight;
    total += weight; weight *= 0.5; scale *= 2.03;
  }
  return total > 0 ? sum / total * amplitude : 0;
}

/** Smooth three-key curve: holds the first and last value outside the key range. */
export function fieldRamp(value: number, keys: readonly number[]): number {
  const [x0, y0, x1, y1, x2, y2] = keys;
  const segment = (a: number, ya: number, b: number, yb: number) => {
    const t = b > a ? Math.min(1, Math.max(0, (value - a) / (b - a))) : value < a ? 0 : 1;
    return ya + (yb - ya) * t * t * (3 - 2 * t);
  };
  return value <= x1 ? segment(x0, y0, x1, y1) : segment(x1, y1, x2, y2);
}
