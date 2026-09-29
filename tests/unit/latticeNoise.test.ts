import { describe, expect, it } from 'vitest';
import { curlNoise3, fade, hashU32, latticeCellHash, valueNoise1, valueNoise3 } from '../../src/engine/procedural/latticeNoise';
import { LATTICE_HASH_WGSL, LATTICE_NOISE_WGSL } from '../../src/engine/procedural/latticeNoiseWgsl';
import * as flockMath from '../../src/engine/flock/shared/flockMath';
import { FLOCK_WGSL_MATH } from '../../src/engine/flock/shaders/flockWgslShared';

describe('shared lattice noise', () => {
  it('is the implementation Flock uses on CPU and GPU', () => {
    expect(flockMath.valueNoise3).toBe(valueNoise3);
    expect(flockMath.valueNoise1).toBe(valueNoise1);
    expect(flockMath.curlNoise3).toBe(curlNoise3);
    expect(flockMath.hashU32).toBe(hashU32);
    expect(FLOCK_WGSL_MATH).toContain(LATTICE_HASH_WGSL);
    expect(FLOCK_WGSL_MATH).toContain(LATTICE_NOISE_WGSL);
  });

  it('keeps the masked Flock spatial hash on the shared lattice hash', () => {
    for (const [x, y, z] of [[0, 0, 0], [-3, 7, 12], [1_000_000, -5, 2]]) {
      expect(flockMath.cellHash(x, y, z, 0xff)).toBe(latticeCellHash(x, y, z) & 0xff);
      expect(latticeCellHash(x, y, z)).toBeGreaterThanOrEqual(0);
    }
  });

  it('interpolates lattice values smoothly within [0, 1)', () => {
    expect(fade(0)).toBe(0);
    expect(fade(1)).toBe(1);
    expect(fade(0.5)).toBe(0.5);
    const corner = valueNoise3(2, -3, 5, 1);
    expect(valueNoise3(2 + 1e-7, -3, 5, 1)).toBeCloseTo(corner, 6);
    for (let i = 0; i < 200; i++) {
      const value = valueNoise3(i * 0.37 - 20, i * 0.11, -i * 0.53, i % 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(valueNoise3(0.3, 0.3, 0.3, 1)).not.toBe(valueNoise3(0.3, 0.3, 0.3, 2));
  });

  it('evaluates curl flow deterministically', () => {
    const first = curlNoise3(0.3, 1.7, -2.2);
    expect(curlNoise3(0.3, 1.7, -2.2)).toEqual(first);
    expect(first.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...first)).toBeGreaterThan(0);
  });
});
