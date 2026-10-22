/**
 * Graph-against-twin parity for the two-tone-pattern looks whose graph has cached passes (the Cell Filter of Halftone,
 * Riso and Dithering, Riso Glow's glow cache) or rounds a coordinate differently from its twin (Drift Lines' Rotate UV).
 * The graph box-averages rows and then columns centred on each pixel, keeps them in rgba16float caches and reads them
 * bilinearly at each tap; the single-pass WGSL twin averages the picture around the tap itself. The tone of a cell then
 * differs by a fraction of an 8-bit step, which moves a channel one step, and a dot, dither or band edge that sits
 * exactly on its threshold may land on the other side (a large delta on a single pixel). A limit names both shares.
 */
export interface ParityLimit {
  /** Largest share of bytes that may differ by exactly one 8-bit step. */
  readonly oneStep: number;
  /** Largest share of pixels that may differ by more (a pattern edge on its threshold). */
  readonly flipped: number;
}
export interface ParityStats { oneStep: number; flipped: number; maxDelta: number }

export function parityStats(expected: Uint8Array, actual: Uint8Array): ParityStats {
  let oneStep = 0, maxDelta = 0;
  const flippedPixels = new Set<number>();
  expected.forEach((value, index) => {
    const delta = Math.abs(value - actual[index]);
    maxDelta = Math.max(maxDelta, delta);
    if (delta === 1) oneStep++; else if (delta > 1) flippedPixels.add(index >> 2);
  });
  return { oneStep: oneStep / expected.length, flipped: flippedPixels.size / (expected.length / 4), maxDelta };
}

/** Null when `actual` is within `limit` of `expected`, else what went over. Every comparison is recorded for the probe page. */
export function parityProblem(name: string, expected: Uint8Array, actual: Uint8Array, limit: ParityLimit): string | null {
  const stats = parityStats(expected, actual);
  const record = globalThis as { __patternParity?: Array<{ name: string } & ParityStats> };
  (record.__patternParity ??= []).push({ name, ...stats });
  if (stats.oneStep <= limit.oneStep && stats.flipped <= limit.flipped) return null;
  const percent = (share: number) => `${(share * 100).toFixed(2)} %`;
  return `${name}: ${percent(stats.oneStep)} of bytes one step apart (limit ${percent(limit.oneStep)}), `
    + `${percent(stats.flipped)} of pixels further apart (limit ${percent(limit.flipped)}), max delta ${stats.maxDelta}`;
}
