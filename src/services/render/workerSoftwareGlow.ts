import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import {
  GLOW_AMOUNT_GAIN, GLOW_CENTER_WEIGHT, GLOW_SOFTNESS_OFFSET, GLOW_THRESHOLD_SOFTNESS,
  glowPrefilterOffsetPx, glowRingOffsetUv, resolveGlowSampling, type GlowSamplingPlan,
} from '../../effects/stylize/glow/glowSampling';

type GlowAdjustment = NonNullable<WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['glowAdjustments']>[number];
type Rgba = [number, number, number, number];

/** Prefiltered bright light for one Glow adjustment on one straight-alpha RGBA8 raster. */
export interface WorkerSoftwareGlow {
  readonly plan: GlowSamplingPlan;
  readonly width: number;
  readonly height: number;
  readonly amount: number;
  readonly thresholdLow: number;
  readonly thresholdHigh: number;
  /** Prefiltered premultiplied light, three floats per pixel. */
  readonly light: Float32Array;
  /** Ring samples as (u offset, v offset, weight) triples. */
  readonly ringSamples: Float64Array;
  readonly ringWeightSum: number;
}

const finite = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const luma = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const gaussian = (value: number, sigma: number) => Math.exp(-(value * value) / ((2 * sigma) * sigma));
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Linear filtering with clamp-to-edge addressing, matching the effect sampler. */
function bilinear(width: number, height: number, u: number, v: number) {
  const px = u * width - 0.5, py = v * height - 0.5, x0 = Math.floor(px), y0 = Math.floor(py);
  const column = (x: number) => Math.max(0, Math.min(width - 1, x)), row = (y: number) => Math.max(0, Math.min(height - 1, y));
  return { a: row(y0) * width + column(x0), b: row(y0) * width + column(x0 + 1), c: row(y0 + 1) * width + column(x0),
    d: row(y0 + 1) * width + column(x0 + 1), tx: px - x0, ty: py - y0 };
}

function sampleLight(data: Float32Array, width: number, height: number, u: number, v: number, out: number[]): void {
  const { a, b, c, d, tx, ty } = bilinear(width, height, u, v);
  for (let channel = 0; channel < 3; channel++) {
    const top = data[a * 3 + channel] + (data[b * 3 + channel] - data[a * 3 + channel]) * tx;
    const bottom = data[c * 3 + channel] + (data[d * 3 + channel] - data[c * 3 + channel]) * tx;
    out[channel] = top + (bottom - top) * ty;
  }
}

/**
 * Separable bright-pass prefilter shared with the GPU graph (see glowSampling.ts):
 * light = rgb * alpha * smoothstep(threshold ± 0.1, luma), blurred horizontally then vertically.
 */
export function prepareWorkerSoftwareGlow(source: Uint8ClampedArray, width: number, height: number,
  adjustment: GlowAdjustment): WorkerSoftwareGlow {
  const plan = resolveGlowSampling(adjustment);
  const threshold = finite(adjustment.threshold, 0.7935);
  const thresholdLow = threshold - GLOW_THRESHOLD_SOFTNESS, thresholdHigh = threshold + GLOW_THRESHOLD_SOFTNESS;
  const taps = plan.prefilterTapsPerSide * 2, offsets = new Float64Array(taps), weights = new Float64Array(taps);
  let weightSum = 0;
  for (let index = 0; index < taps; index++) {
    offsets[index] = glowPrefilterOffsetPx(index, plan.prefilterTapsPerSide);
    weights[index] = gaussian(offsets[index], plan.prefilterSigmaPx);
    weightSum += weights[index];
  }
  const horizontal = new Float32Array(width * height * 3), light = new Float32Array(width * height * 3);
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (y + 0.5) / height;
    let r = 0, g = 0, b = 0;
    for (let index = 0; index < taps; index++) {
      const tap = bilinear(width, height, (x + 0.5 + offsets[index]) / width, v);
      for (let channel = 0; channel < 4; channel++) {
        const top = source[tap.a * 4 + channel] + (source[tap.b * 4 + channel] - source[tap.a * 4 + channel]) * tap.tx;
        const bottom = source[tap.c * 4 + channel] + (source[tap.d * 4 + channel] - source[tap.c * 4 + channel]) * tap.tx;
        sample[channel] = (top + (bottom - top) * tap.ty) / 255;
      }
      const emission = smoothstep(thresholdLow, thresholdHigh, luma(sample[0], sample[1], sample[2])) * sample[3] * weights[index];
      r += sample[0] * emission; g += sample[1] * emission; b += sample[2] * emission;
    }
    const offset = (y * width + x) * 3;
    horizontal[offset] = r / weightSum; horizontal[offset + 1] = g / weightSum; horizontal[offset + 2] = b / weightSum;
  }
  const tap = [0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width;
    let r = 0, g = 0, b = 0;
    for (let index = 0; index < taps; index++) {
      sampleLight(horizontal, width, height, u, (y + 0.5 + offsets[index]) / height, tap);
      r += tap[0] * weights[index]; g += tap[1] * weights[index]; b += tap[2] * weights[index];
    }
    const offset = (y * width + x) * 3;
    light[offset] = r / weightSum; light[offset + 1] = g / weightSum; light[offset + 2] = b / weightSum;
  }
  const ringSamples = new Float64Array(plan.rings * plan.effectiveSamplesPerRing * 3);
  const sigma = finite(adjustment.softness, 0.496) + GLOW_SOFTNESS_OFFSET;
  const share = plan.samplesPerRing / plan.effectiveSamplesPerRing;
  let ringWeightSum = 0, cursor = 0;
  for (let ring = 1; ring <= plan.rings; ring++) {
    const weight = gaussian(ring / plan.rings, sigma) * share;
    for (let sample = 0; sample < plan.effectiveSamplesPerRing; sample++) {
      const [u, v] = glowRingOffsetUv(ring, sample, plan, width, height);
      ringSamples[cursor++] = u; ringSamples[cursor++] = v; ringSamples[cursor++] = weight;
      ringWeightSum += weight;
    }
  }
  return { plan, width, height, amount: finite(adjustment.amount, 5), thresholdLow, thresholdHigh, light, ringSamples, ringWeightSum };
}

/** Glow output for pixel (x, y): premultiplied additive light, alpha grown to carry the halo. */
export function applyWorkerSoftwareGlow(glow: WorkerSoftwareGlow, source: Uint8ClampedArray, x: number, y: number): Rgba {
  const { width, height } = glow, offset = (y * width + x) * 4;
  const r = source[offset] / 255, g = source[offset + 1] / 255, b = source[offset + 2] / 255, alpha = source[offset + 3] / 255;
  const u = (x + 0.5) / width, v = (y + 0.5) / height, tap = [0, 0, 0];
  let glowR = 0, glowG = 0, glowB = 0;
  for (let index = 0; index < glow.ringSamples.length; index += 3) {
    sampleLight(glow.light, width, height, u + glow.ringSamples[index], v + glow.ringSamples[index + 1], tap);
    const weight = glow.ringSamples[index + 2];
    glowR += tap[0] * weight; glowG += tap[1] * weight; glowB += tap[2] * weight;
  }
  const centerLight = smoothstep(glow.thresholdLow, glow.thresholdHigh, luma(r, g, b)) * alpha * GLOW_CENTER_WEIGHT;
  const total = glow.ringWeightSum + GLOW_CENTER_WEIGHT, gain = glow.amount * GLOW_AMOUNT_GAIN;
  const premultiplied = [
    r * alpha + ((glowR + r * centerLight) / total) * gain,
    g * alpha + ((glowG + g * centerLight) / total) * gain,
    b * alpha + ((glowB + b * centerLight) / total) * gain,
  ];
  const coverage = clamp01(Math.max(alpha, premultiplied[0], premultiplied[1], premultiplied[2]));
  const safe = Math.max(coverage, 1e-6);
  return [clamp01(premultiplied[0] / safe), clamp01(premultiplied[1] / safe), clamp01(premultiplied[2] / safe), coverage];
}
