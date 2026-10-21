import { evaluateFractalNoise2d, pcg2d } from '../../../services/operators/imageNoiseSemantics';

/**
 * Release timing of Pixel Particle Disintegrate: when each cell lets go.
 *
 * The shader first works out a raw delay per cell from the release field (gust pockets mixed with
 * per-cell detail, Release Contrast, Stagger) and the Wind Sweep order. Those raw delays bunch up
 * (the gust field is a smooth noise whose values cluster around its mean), so with the raw delay
 * nearly every cell let go between Progress 0.35 and 0.55. Here the CPU measures how the raw delays
 * of the current settings are spread (RELEASE_QUANTILE_COUNT + 1 quantiles over a sample of the
 * cells, the same field the shader evaluates); the shader turns each raw delay into its rank among
 * the cells and lays the ranks out evenly over the release window, so the visible picture thins
 * out at an even rate while Progress runs. Cells with exactly the same raw delay (a clamped
 * contrast, no Wind Sweep) are ordered by the gust field, so pockets still go together.
 *
 * Window: from RELEASE_START, as wide as RELEASE_SPREAD times the raw spread (Stagger and Wind
 * Sweep), at most RELEASE_WINDOW_MAX: Stagger 0 and Wind Sweep 0 still release everything at once,
 * the defaults spread the releases over Progress 0-0.84. A flight ends at
 * delay + Tail (1 - delay), so every particle has landed (and faded) by Progress 1.
 */
export const RELEASE_QUANTILE_COUNT = 32;
export const RELEASE_START = 0;
export const RELEASE_SPREAD = 1.8;
export const RELEASE_WINDOW_MAX = 0.9;
/** Cells sampled per axis at most (the quantiles need the distribution, not every cell). */
const SAMPLE_AXIS = [64, 36] as const;

/** The packed parameters the release field reads (renderer uniform order, already clamped). */
export interface ReleaseFieldParams {
  readonly seed: number;
  readonly gustStrength: number;
  readonly gustScale: number;
  readonly windSweep: number;
  readonly releaseContrast: number;
  readonly stagger: number;
  readonly directionX: number;
  readonly directionY: number;
}

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(Math.max((value - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
};

const seedBits = (seed: number) => new Uint32Array(new Float32Array([seed]).buffer)[0];

/** The shader's raw delay of a cell: see cellRelease in PixelParticleDisintegrate.wgsl. */
export function rawReleaseDelay(params: ReleaseFieldParams, column: number, row: number, columns: number, rows: number): number {
  const u = (column + 0.5) / columns, v = (row + 0.5) / rows;
  let windX = params.directionX + 0.42, windY = params.directionY - 0.72;
  const length = Math.hypot(windX, windY);
  if (length < 1e-4) { windX = 0.5; windY = -0.8660254; } else { windX /= length; windY /= length; }
  const windOrder = Math.min(Math.max(((u - 0.5) * windX + (v - 0.5) * windY + 0.70710678) * 0.70710678, 0), 1);
  const windDelay = windOrder * Math.min(Math.max(params.windSweep, 0), 1) * 0.45;
  const gustScale = Math.max(params.gustScale, 0.5);
  const noise = evaluateFractalNoise2d([u * gustScale + params.seed * 0.031, v * gustScale + params.seed * 0.047], 4, 0.5);
  const gustField = Math.min(Math.max(0.5 + (noise - 0.5) * 1.4, 0), 1);
  const gustPocket = smoothstep(0.32, 0.9, gustField);
  const detail = (pcg2d((column + Math.imul(seedBits(params.seed), 2654435761)) >>> 0, (row + 0x9e3779b9) >>> 0) >>> 8) / 16777216;
  const blend = Math.min(Math.max(params.gustStrength, 0), 1);
  const field = detail + (gustPocket - detail) * blend;
  const contrasted = Math.min(Math.max((field - 0.5) * (1 + Math.min(Math.max(params.releaseContrast, 0), 2)) + 0.5, 0), 1);
  return Math.min(Math.max((1 - contrasted) * Math.min(Math.max(params.stagger, 0), 0.95) + windDelay, 0), 0.98);
}

const cache = new Map<string, Float32Array>();

/**
 * RELEASE_QUANTILE_COUNT + 1 quantiles (0, 1/32, ..., 1) of the raw delays over the grid's cells
 * (an even sample of at most 64 x 36 cell centres, a few ms). Cached per settings and grid size.
 */
export function releaseQuantiles(params: ReleaseFieldParams, columns: number, rows: number): Float32Array {
  const key = `${Object.values(params).join(',')}|${columns}x${rows}`;
  const known = cache.get(key);
  if (known) return known;
  const sampleColumns = Math.max(1, Math.min(columns, SAMPLE_AXIS[0])), sampleRows = Math.max(1, Math.min(rows, SAMPLE_AXIS[1]));
  const delays = new Float64Array(sampleColumns * sampleRows);
  for (let j = 0; j < sampleRows; j += 1) for (let i = 0; i < sampleColumns; i += 1) {
    const column = Math.floor((i + 0.5) * columns / sampleColumns), row = Math.floor((j + 0.5) * rows / sampleRows);
    delays[j * sampleColumns + i] = rawReleaseDelay(params, column, row, columns, rows);
  }
  delays.sort();
  const quantiles = new Float32Array(RELEASE_QUANTILE_COUNT + 1);
  for (let index = 0; index <= RELEASE_QUANTILE_COUNT; index += 1) {
    const position = index / RELEASE_QUANTILE_COUNT * (delays.length - 1), low = Math.floor(position);
    const high = Math.min(low + 1, delays.length - 1);
    quantiles[index] = delays[low] + (delays[high] - delays[low]) * (position - low);
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, quantiles);
  return quantiles;
}

/** Release window width for the measured quantiles (0 when every cell has the same raw delay). */
export function releaseWindow(quantiles: Float32Array): number {
  return Math.min((quantiles[RELEASE_QUANTILE_COUNT] - quantiles[0]) * RELEASE_SPREAD, RELEASE_WINDOW_MAX);
}
