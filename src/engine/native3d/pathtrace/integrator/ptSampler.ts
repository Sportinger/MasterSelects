/**
 * Owen-scrambled, shuffled Sobol points (Burley 2020, "Practical Hash-based Owen Scrambling"), the
 * CPU mirror of PtSampler.wgsl. Four dimensions per pattern; further dimensions (bounces, light
 * choices) use a new pattern seed, so every pixel gets a decorrelated 4D Sobol sequence.
 */

/** Direction numbers of the first four Sobol dimensions (Joe & Kuo), as in Burley's paper. */
export const SOBOL_DIRECTIONS: readonly (readonly number[])[] = [
  Array.from({ length: 32 }, (_, i) => (0x80000000 >>> i) >>> 0),
  [0x80000000, 0xc0000000, 0xa0000000, 0xf0000000, 0x88000000, 0xcc000000, 0xaa000000, 0xff000000,
    0x80800000, 0xc0c00000, 0xa0a00000, 0xf0f00000, 0x88880000, 0xcccc0000, 0xaaaa0000, 0xffff0000,
    0x80008000, 0xc000c000, 0xa000a000, 0xf000f000, 0x88008800, 0xcc00cc00, 0xaa00aa00, 0xff00ff00,
    0x80808080, 0xc0c0c0c0, 0xa0a0a0a0, 0xf0f0f0f0, 0x88888888, 0xcccccccc, 0xaaaaaaaa, 0xffffffff],
  [0x80000000, 0xc0000000, 0x60000000, 0x90000000, 0xe8000000, 0x5c000000, 0x8e000000, 0xc5000000,
    0x68800000, 0x9cc00000, 0xee600000, 0x55900000, 0x80680000, 0xc09c0000, 0x60ee0000, 0x90550000,
    0xe8808000, 0x5cc0c000, 0x8e606000, 0xc5909000, 0x6868e800, 0x9c9c5c00, 0xeeee8e00, 0x5555c500,
    0x8000e880, 0xc0005cc0, 0x60008e60, 0x9000c590, 0xe8006868, 0x5c009c9c, 0x8e00eeee, 0xc5005555],
  [0x80000000, 0xc0000000, 0x20000000, 0x50000000, 0xf8000000, 0x74000000, 0xa2000000, 0x93000000,
    0xd8800000, 0x25400000, 0x59e00000, 0xe6d00000, 0x78080000, 0xb40c0000, 0x82020000, 0xc3050000,
    0x208f8000, 0x51474000, 0xfbea2000, 0x75d93000, 0xa0858800, 0x914e5400, 0xdbe79e00, 0x25db6d00,
    0x58800080, 0xe54000c0, 0x79e00020, 0xe6d00050, 0x780800f8, 0xb40c0074, 0x820200a2, 0xc3050093],
];

export function sobol(index: number, dimension: number): number {
  let x = 0;
  const directions = SOBOL_DIRECTIONS[dimension];
  for (let bit = 0; bit < 32; bit++) if ((index >>> bit) & 1) x ^= directions[bit];
  return x >>> 0;
}

export function reverseBits(value: number): number {
  let x = value >>> 0;
  x = ((x >>> 1) & 0x55555555) | ((x & 0x55555555) << 1);
  x = ((x >>> 2) & 0x33333333) | ((x & 0x33333333) << 2);
  x = ((x >>> 4) & 0x0f0f0f0f) | ((x & 0x0f0f0f0f) << 4);
  x = ((x >>> 8) & 0x00ff00ff) | ((x & 0x00ff00ff) << 8);
  return ((x >>> 16) | (x << 16)) >>> 0;
}

/** Laine-Karras style permutation from Burley's paper (improved constants). */
function laineKarras(value: number, seed: number): number {
  let x = (value + seed) >>> 0;
  x = (x ^ Math.imul(x, 0x6c50b47c)) >>> 0;
  x = (x ^ Math.imul(x, 0xb82f1e52)) >>> 0;
  x = (x ^ Math.imul(x, 0xc7afe638)) >>> 0;
  x = (x ^ Math.imul(x, 0x8d22f6e6)) >>> 0;
  return x;
}

export function nestedUniformScramble(value: number, seed: number): number {
  return reverseBits(laineKarras(reverseBits(value), seed));
}

export function hashCombine(seed: number, value: number): number {
  return (seed ^ (value + (seed << 6) + (seed >>> 2))) >>> 0;
}

/** `index`-th point of the shuffled, scrambled 4D Sobol sequence for `seed`, in [0, 1). */
export function sobolOwen4(index: number, seed: number): [number, number, number, number] {
  const shuffled = nestedUniformScramble(index >>> 0, seed);
  return [0, 1, 2, 3].map(dimension => {
    const x = nestedUniformScramble(sobol(shuffled, dimension), hashCombine(seed, dimension));
    return (x >>> 8) / 16777216;
  }) as [number, number, number, number];
}

/** Seed of a pixel's pattern for one sampling dimension group (camera, bounce n, light choice …). */
export function patternSeed(pixelX: number, pixelY: number, frameSeed: number, pattern: number): number {
  let h = (Math.imul(pixelX, 0x8da6b343) ^ Math.imul(pixelY, 0xd8163841) ^ Math.imul(frameSeed, 0xcb1ab31f) ^ Math.imul(pattern, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
