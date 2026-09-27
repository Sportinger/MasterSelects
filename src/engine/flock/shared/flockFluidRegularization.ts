import { hashU32 } from './flockMath';

/** Position regularization is independent of velocity and affine history. */
export interface FlockFluidRegularization {
  separationStrength: number;
  /** Minimum spacing as a fraction of a grid cell, limited to half a cell. */
  separationDistance: number;
  /** Per-axis position noise in grid-cell units at 60 substeps per second. */
  jitter: number;
  step: number;
}

// Use 24 bits so integer-to-float conversion is exact on both CPU and GPU.
export function fluidSignedNoise(key: number): number {
  return (hashU32(key) >>> 8) / 8388608 - 1;
}

export function fluidJitter(identity: number, generation: number, step: number, axis: number): number {
  return fluidSignedNoise(identity ^ hashU32(generation) ^ hashU32(step) ^ Math.imul(axis + 1, 0x9e3779b9));
}

/** Antisymmetric even for exactly coincident particles. */
export function fluidPairDirection(identity: number, other: number): [number, number, number] {
  const key = Math.min(identity, other) ^ hashU32(Math.max(identity, other));
  const x = fluidSignedNoise(key ^ 0x9e3779b9);
  const y = fluidSignedNoise(key ^ 0x3c6ef372);
  const z = fluidSignedNoise(key ^ 0xdaa66d2b);
  const scale = (identity < other ? 1 : -1) / Math.max(Math.hypot(x, y, z), 1e-12);
  return [x * scale, y * scale, z * scale];
}
