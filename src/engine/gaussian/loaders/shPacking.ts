/**
 * Compact GPU layout for spherical-harmonic rest coefficients (bands 1-3).
 *
 * Per splat: word 0 holds the float32 bits of the largest absolute coefficient; every coefficient is
 * then stored as an unsigned byte `(c / max * 0.5 + 0.5) * 255`, four per u32 word. Coefficients keep
 * the PLY channel-major order (all red coefficients, then green, then blue), so a splat with all three
 * bands takes 1 + ceil(45 / 4) = 13 words instead of 45 floats.
 */
export interface PackedSphericalHarmonics {
  data: Uint32Array;
  /** Rest coefficients per color channel: 3 (band 1), 8 (bands 1-2) or 15 (bands 1-3). */
  coeffsPerChannel: number;
  wordsPerSplat: number;
}

export function shWordsPerSplat(coeffsPerChannel: number): number {
  return 1 + Math.ceil((coeffsPerChannel * 3) / 4);
}

/** `columns` are the f_rest columns sorted by index; `valueAt` reads one splat's value of a column. */
export function packSphericalHarmonics<T>(
  columns: readonly T[],
  splatCount: number,
  valueAt: (column: T, index: number) => number,
): PackedSphericalHarmonics | undefined {
  const coeffsPerChannel = Math.floor(columns.length / 3);
  if (coeffsPerChannel <= 0) return undefined;
  const total = coeffsPerChannel * 3;
  const wordsPerSplat = shWordsPerSplat(coeffsPerChannel);
  const data = new Uint32Array(splatCount * wordsPerSplat);
  const scaleView = new Float32Array(data.buffer);
  const values = new Float32Array(total);
  for (let i = 0; i < splatCount; i += 1) {
    let max = 0;
    for (let j = 0; j < total; j += 1) {
      const value = valueAt(columns[j], i);
      values[j] = Number.isFinite(value) ? value : 0;
      max = Math.max(max, Math.abs(values[j]));
    }
    const base = i * wordsPerSplat;
    scaleView[base] = max;
    if (max === 0) continue;
    for (let j = 0; j < total; j += 1) {
      const byte = Math.round((values[j] / max * 0.5 + 0.5) * 255);
      data[base + 1 + (j >> 2)] |= byte << ((j & 3) * 8);
    }
  }
  return { data, coeffsPerChannel, wordsPerSplat };
}

/** CPU mirror of the shader decode, for tests and diagnostics. */
export function unpackSphericalHarmonic(packed: PackedSphericalHarmonics, splat: number, coefficient: number): number {
  const base = splat * packed.wordsPerSplat;
  const max = new Float32Array(packed.data.buffer, packed.data.byteOffset + base * 4, 1)[0];
  const byte = (packed.data[base + 1 + (coefficient >> 2)] >>> ((coefficient & 3) * 8)) & 0xff;
  return (byte / 255 * 2 - 1) * max;
}
