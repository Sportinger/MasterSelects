import { describe, expect, it } from 'vitest';
import { packSphericalHarmonics, shWordsPerSplat, unpackSphericalHarmonic } from '../../src/engine/gaussian/loaders/shPacking';

describe('spherical harmonic packing', () => {
  it('packs three bands per splat into 13 words and decodes within 8-bit precision', () => {
    const columns = Array.from({ length: 45 }, (_, j) => Float32Array.from([j % 2 ? 0.5 : -0.25, 0, (j - 22) / 22]));
    const packed = packSphericalHarmonics(columns, 3, (column, index) => column[index])!;
    expect(packed.coeffsPerChannel).toBe(15);
    expect(packed.wordsPerSplat).toBe(shWordsPerSplat(15)).toBe(13);
    expect(packed.data.length).toBe(39);
    for (let j = 0; j < 45; j += 1) {
      expect(unpackSphericalHarmonic(packed, 0, j)).toBeCloseTo(columns[j][0], 2);
      expect(unpackSphericalHarmonic(packed, 2, j)).toBeCloseTo(columns[j][2], 2);
    }
    // A splat without view-dependent color keeps a zero scale, which the shader skips.
    expect(Math.abs(unpackSphericalHarmonic(packed, 1, 7))).toBe(0);
  });
  it('returns nothing for assets without rest coefficients', () => {
    expect(packSphericalHarmonics([], 10, () => 0)).toBeUndefined();
  });
});
