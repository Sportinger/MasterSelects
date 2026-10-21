import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import { GLOW_DEFAULTS, GLOW_LEVELS, glowContribution, glowLevelWeights } from '../../effects/stylize/glow/glowBloom';

type GlowAdjustment = NonNullable<WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['glowAdjustments']>[number];
type Rgba = [number, number, number, number];

/**
 * The current Glow (glowBloom.ts) for graphless Glows in the worker software path, such as the
 * Vignette Bloom transition builds: the same bright pass, a CPU pyramid of half-size levels
 * ([1 3 3 1] down, bilinear up) added by the same Radius weights, the same spread gain and the
 * same screen resolve. It follows the GPU graph closely at a fraction of a generic graph
 * evaluation's cost; only the levels the Radius uses are built.
 */
export interface WorkerSoftwareBloom {
  readonly width: number;
  readonly height: number;
  readonly amount: number;
  /** Premultiplied glow light per pixel (three floats), already divided by the spread. */
  readonly glow: Float32Array;
}

interface Level { readonly width: number; readonly height: number; readonly data: Float32Array }

const finite = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const DOWN_TAPS = [1, 3, 3, 1];

/** Half-size [1 3 3 1] x [1 3 3 1] reduction with clamp-to-edge addressing. */
function halve(level: Level): Level {
  const width = Math.max(1, Math.round(level.width / 2)), height = Math.max(1, Math.round(level.height / 2));
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, total = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const sx = Math.min(level.width - 1, Math.max(0, 2 * x - 1 + i)), sy = Math.min(level.height - 1, Math.max(0, 2 * y - 1 + j));
      const weight = DOWN_TAPS[i] * DOWN_TAPS[j], offset = (sy * level.width + sx) * 3;
      r += level.data[offset] * weight; g += level.data[offset + 1] * weight; b += level.data[offset + 2] * weight; total += weight;
    }
    const offset = (y * width + x) * 3;
    data[offset] = r / total; data[offset + 1] = g / total; data[offset + 2] = b / total;
  }
  return { width, height, data };
}

/** `fine` + bilinear upsample of `coarse` (clamp to edge), in place on a copy of `fine` scaled by `weight`. */
function addUpsampled(coarse: Level, fine: Level, weight: number): Level {
  const data = new Float32Array(fine.data.length);
  for (let y = 0; y < fine.height; y++) for (let x = 0; x < fine.width; x++) {
    const px = (x + 0.5) * coarse.width / fine.width - 0.5, py = (y + 0.5) * coarse.height / fine.height - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
    const column = (value: number) => Math.min(coarse.width - 1, Math.max(0, value)), row = (value: number) => Math.min(coarse.height - 1, Math.max(0, value));
    const a = (row(y0) * coarse.width + column(x0)) * 3, b = (row(y0) * coarse.width + column(x0 + 1)) * 3;
    const c = (row(y0 + 1) * coarse.width + column(x0)) * 3, d = (row(y0 + 1) * coarse.width + column(x0 + 1)) * 3;
    const offset = (y * fine.width + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      const top = coarse.data[a + channel] + (coarse.data[b + channel] - coarse.data[a + channel]) * tx;
      const bottom = coarse.data[c + channel] + (coarse.data[d + channel] - coarse.data[c + channel]) * tx;
      data[offset + channel] = top + (bottom - top) * ty + fine.data[offset + channel] * weight;
    }
  }
  return { width: fine.width, height: fine.height, data };
}

export function prepareWorkerSoftwareBloom(source: Uint8ClampedArray, width: number, height: number, adjustment: GlowAdjustment): WorkerSoftwareBloom {
  const threshold = finite(adjustment.threshold, GLOW_DEFAULTS.threshold), softness = finite(adjustment.softness, GLOW_DEFAULTS.softness);
  const radius = Math.max(0, finite(adjustment.radius, GLOW_DEFAULTS.radius));
  const bright = new Float32Array(width * height * 3);
  for (let index = 0; index < width * height; index++) {
    const r = source[index * 4] / 255, g = source[index * 4 + 1] / 255, b = source[index * 4 + 2] / 255;
    const light = glowContribution(Math.max(r, g, b), threshold, softness) * source[index * 4 + 3] / 255;
    bright[index * 3] = r * light; bright[index * 3 + 1] = g * light; bright[index * 3 + 2] = b * light;
  }
  const weights = glowLevelWeights(radius, Math.max(1, Math.min(width, height)));
  let deepest = 0;
  for (let level = 1; level <= GLOW_LEVELS; level++) if (weights[level] > 1e-6) deepest = level;
  const levels: Level[] = [{ width, height, data: bright }];
  for (let level = 1; level <= deepest; level++) levels.push(halve(levels[level - 1]));
  // From the deepest level back up: each level adds its own light by its weight.
  let sum: Level = { ...levels[deepest], data: levels[deepest].data.map(value => value * weights[deepest]) };
  for (let level = deepest - 1; level >= 0; level--) sum = addUpsampled(sum, levels[level], weights[level]);
  const spread = Math.sqrt(Math.max(1, weights.reduce((total, weight) => total + weight, 0)));
  const glow = sum.data.map(value => value / spread);
  return { width, height, amount: Math.max(0, finite(adjustment.amount, GLOW_DEFAULTS.amount)), glow };
}

/** Glow output for pixel (x, y): 1 - (1 - premultiplied picture) * exp(-glow * Amount), alpha grown to carry the halo. */
export function applyWorkerSoftwareBloom(bloom: WorkerSoftwareBloom, source: Uint8ClampedArray, x: number, y: number): Rgba {
  const pixel = (y * bloom.width + x) * 4, light = (y * bloom.width + x) * 3, alpha = source[pixel + 3] / 255;
  const result = [0, 1, 2].map(channel => 1 - (1 - source[pixel + channel] / 255 * alpha) * Math.exp(-bloom.glow[light + channel] * bloom.amount));
  const coverage = clamp01(Math.max(alpha, ...result)), safe = Math.max(coverage, 1e-6);
  return [clamp01(result[0] / safe), clamp01(result[1] / safe), clamp01(result[2] / safe), coverage];
}
