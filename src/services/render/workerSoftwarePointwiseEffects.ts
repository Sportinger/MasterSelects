import type { WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';

/**
 * Worker CPU colour effects that read only their own pixel and its place in the frame. Behind
 * the built-in mirror/pixel effects they run in the per-pixel loop (workerSoftwarePixelEffects.ts)
 * or, for Invert, as a canvas filter. In front of one they run as whole-frame steps in stack order
 * (workerSoftwareMirrorPixelEffects.ts), so a key, a vignette or a posterize before Pixelate or
 * Kaleidoscope is exact without the slow graph interpreter. The rebuilt color recipes (Brightness,
 * Contrast, Saturation, Exposure, Levels, Hue Shift, Temperature, Vibrance; COLOR_RECIPE_EFFECT_TYPES)
 * are not steps here: their curves, linear light and OkLCh have no hand-written twin, so a layer
 * with one runs as exact graph plans with memoized pointwise programs (workerSoftwareImageGraphs.ts).
 */
type Adjustment<K extends keyof WorkerRenderSoftwarePixelEffects> = NonNullable<WorkerRenderSoftwarePixelEffects[K]> extends readonly (infer T)[] ? T : never;

export type WorkerSoftwarePointwiseStep =
  | { readonly kind: 'invert' }
  | { readonly kind: 'threshold'; readonly adjustment: Adjustment<'thresholdAdjustments'> }
  | { readonly kind: 'posterize'; readonly adjustment: Adjustment<'posterizeAdjustments'> }
  | { readonly kind: 'vignette'; readonly adjustment: Adjustment<'vignetteAdjustments'> }
  | { readonly kind: 'chroma-key'; readonly adjustment: Adjustment<'chromaKeyAdjustments'> }
  | { readonly kind: 'scanlines'; readonly adjustment: Adjustment<'scanlineAdjustments'> }
  | { readonly kind: 'grain'; readonly adjustment: Adjustment<'grainAdjustments'> };

const POINTWISE_EFFECTS: ReadonlySet<string> = new Set(['invert', 'threshold', 'posterize', 'vignette', 'chroma-key', 'scanlines', 'grain']);

export function isWorkerSoftwarePointwiseEffect(type: string): boolean {
  return POINTWISE_EFFECTS.has(type);
}

/** The step of a pointwise effect (defaults and guards resolved), undefined for other effects. */
export function workerSoftwarePointwiseStep(type: string, params: Readonly<Record<string, unknown>>): WorkerSoftwarePointwiseStep | undefined {
  const value = (key: string, fallback: number) => {
    const raw = params[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  };
  switch (type) {
    case 'invert': return { kind: type };
    case 'threshold': return { kind: type, adjustment: { level: value('level', 0.5) } };
    case 'posterize': return { kind: type, adjustment: { levels: Math.max(2, value('levels', 6)) } };
    case 'vignette': return { kind: type, adjustment: { amount: value('amount', 0.5), size: value('size', 0.5), softness: value('softness', 0.5),
      roundness: value('roundness', 1) } };
    case 'chroma-key': return { kind: type, adjustment: { keyColor: params.keyColor === 'blue' ? 'blue' : 'green', tolerance: value('tolerance', 0.2),
      softness: value('softness', 0.1), spillSuppression: value('spillSuppression', 0.5) } };
    case 'scanlines': return { kind: type, adjustment: { density: value('density', 5), opacity: value('opacity', 0.3), speed: value('speed', 0) } };
    case 'grain': return { kind: type, adjustment: { amount: value('amount', 0.1), size: Math.max(0.001, value('size', 1)), speed: value('speed', 1) } };
    default: return undefined;
  }
}

type Rgb = readonly [number, number, number];

/** One step on a straight pixel (0…1) at uv; returns straight rgba. */
export function applyWorkerSoftwarePointwiseStep(step: WorkerSoftwarePointwiseStep, r: number, g: number, b: number, a: number,
  uvX: number, uvY: number, timelineTime: number): readonly [number, number, number, number] {
  const rgb: Rgb = [r, g, b];
  let out: Rgb;
  switch (step.kind) {
    case 'invert': out = [1 - r, 1 - g, 1 - b]; break;
    case 'threshold': out = applyThresholdAdjustment(rgb, step.adjustment); break;
    case 'posterize': out = applyPosterizeAdjustment(rgb, step.adjustment); break;
    case 'vignette': out = applyVignetteAdjustment(rgb, step.adjustment, uvX, uvY); break;
    case 'scanlines': out = applyScanlineAdjustment(rgb, step.adjustment, uvY, timelineTime); break;
    case 'grain': out = applyGrainAdjustment(rgb, step.adjustment, uvX, uvY, timelineTime); break;
    case 'chroma-key': return applyChromaKeyAdjustment([r, g, b, a], step.adjustment);
  }
  return [out[0], out[1], out[2], a];
}

/** A straight value stored like the GPU's 8-bit effect targets (NaN → 0). */
const store8 = (value: number) => value > 0 ? value < 1 ? Math.round(value * 255) / 255 : 1 : 0;

/** Applies a step in place to a premultiplied float frame (0…1), storing 8-bit straight values between effects as the GPU does. */
export function applyWorkerSoftwarePointwiseFrame(frame: Float32Array, width: number, height: number,
  step: WorkerSoftwarePointwiseStep, timelineTime: number): void {
  for (let y = 0; y < height; y += 1) {
    const uvY = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4, alpha = frame[index + 3], inverse = alpha > 0 ? 1 / alpha : 0;
      const out = applyWorkerSoftwarePointwiseStep(step, frame[index] * inverse, frame[index + 1] * inverse, frame[index + 2] * inverse, alpha,
        (x + 0.5) / width, uvY, timelineTime);
      const nextAlpha = store8(out[3]);
      frame[index] = store8(out[0]) * nextAlpha;
      frame[index + 1] = store8(out[1]) * nextAlpha;
      frame[index + 2] = store8(out[2]) * nextAlpha;
      frame[index + 3] = nextAlpha;
    }
  }
}

export function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function luma(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function applyExposureAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'exposureAdjustments'>,
): readonly [number, number, number] {
  const exposure = 2 ** finiteNumber(adjustment.exposure, 0);
  const offset = finiteNumber(adjustment.offset, 0);
  const gamma = Math.max(finiteNumber(adjustment.gamma, 1), 0.001);
  const adjust = (value: number): number => clamp01(Math.max(value * exposure + offset, 0) ** (1 / gamma));
  return [adjust(input[0]), adjust(input[1]), adjust(input[2])];
}

export function applyTemperatureAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'temperatureAdjustments'>,
): readonly [number, number, number] {
  const temperature = finiteNumber(adjustment.temperature, 0);
  const tint = finiteNumber(adjustment.tint, 0);
  return [
    clamp01(input[0] + temperature * 0.1 + tint * 0.05),
    clamp01(input[1] - tint * 0.1),
    clamp01(input[2] - temperature * 0.1 + tint * 0.05),
  ];
}

function luma601(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function remapLevelsChannel(
  value: number,
  adjustment: Adjustment<'levelsAdjustments'>,
): number {
  const inputBlack = finiteNumber(adjustment.inputBlack, 0);
  const inputWhite = finiteNumber(adjustment.inputWhite, 1);
  const gamma = Math.max(finiteNumber(adjustment.gamma, 1), 0.001);
  const outputBlack = finiteNumber(adjustment.outputBlack, 0);
  const outputWhite = finiteNumber(adjustment.outputWhite, 1);
  const inputRange = inputWhite - inputBlack;
  const normalized = inputRange === 0 ? 0 : clamp01((value - inputBlack) / inputRange);
  const gammaAdjusted = Math.max(normalized, 0) ** (1 / gamma);
  return outputBlack * (1 - gammaAdjusted) + outputWhite * gammaAdjusted;
}

export function applyLevelsAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'levelsAdjustments'>,
): readonly [number, number, number] {
  return [
    remapLevelsChannel(input[0], adjustment),
    remapLevelsChannel(input[1], adjustment),
    remapLevelsChannel(input[2], adjustment),
  ];
}

export function applyThresholdAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'thresholdAdjustments'>,
): readonly [number, number, number] {
  const result = luma(input[0], input[1], input[2]) > finiteNumber(adjustment.level, 0.5) ? 1 : 0;
  return [result, result, result];
}

export function applyPosterizeAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'posterizeAdjustments'>,
): readonly [number, number, number] {
  const levels = Math.max(finiteNumber(adjustment.levels, 6), 2);
  const posterize = (value: number): number => Math.floor(value * levels) / (levels - 1);
  return [posterize(input[0]), posterize(input[1]), posterize(input[2])];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function applyVignetteAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'vignetteAdjustments'>,
  uvX: number,
  uvY: number,
): readonly [number, number, number] {
  const amount = finiteNumber(adjustment.amount, 0.5);
  const size = finiteNumber(adjustment.size, 0.5);
  const softness = finiteNumber(adjustment.softness, 0.5);
  const roundness = finiteNumber(adjustment.roundness, 1);
  const centerX = uvX - 0.5;
  const centerY = uvY - 0.5;
  const distance = Math.hypot(centerX, centerY * roundness) * 2;
  const vignette = 1 - smoothstep(size, size + softness, distance);
  const factor = 1 * (1 - amount) + vignette * amount;
  return [input[0] * factor, input[1] * factor, input[2] * factor];
}

function rgbToYcbcr(input: readonly [number, number, number]): readonly [number, number, number] {
  const y = 0.299 * input[0] + 0.587 * input[1] + 0.114 * input[2];
  const cb = 0.564 * (input[2] - y);
  const cr = 0.713 * (input[0] - y);
  return [y, cb, cr];
}

export function applyChromaKeyAdjustment(
  input: readonly [number, number, number, number],
  adjustment: Adjustment<'chromaKeyAdjustments'>,
): readonly [number, number, number, number] {
  const key: readonly [number, number, number] = adjustment.keyColor === 'blue'
    ? [0, 0, 1]
    : [0, 1, 0];
  const sourceYcbcr = rgbToYcbcr([input[0], input[1], input[2]]);
  const keyYcbcr = rgbToYcbcr(key);
  const cbcrDistance = Math.hypot(sourceYcbcr[1] - keyYcbcr[1], sourceYcbcr[2] - keyYcbcr[2]);
  const alpha = smoothstep(
    finiteNumber(adjustment.tolerance, 0.2),
    finiteNumber(adjustment.tolerance, 0.2) + finiteNumber(adjustment.softness, 0.1),
    cbcrDistance,
  );
  const spillSuppression = Math.max(0, finiteNumber(adjustment.spillSuppression, 0.5));
  let r = input[0];
  let g = input[1];
  let b = input[2];
  if (spillSuppression > 0) {
    if (adjustment.keyColor === 'green') {
      const spillAmount = Math.max(0, g - Math.max(r, b)) * spillSuppression;
      g -= spillAmount;
      r += spillAmount * 0.5;
      b += spillAmount * 0.5;
    } else {
      const spillAmount = Math.max(0, b - Math.max(r, g)) * spillSuppression;
      b -= spillAmount;
      r += spillAmount * 0.5;
      g += spillAmount * 0.5;
    }
  }
  return [r, g, b, input[3] * alpha];
}

function fract(value: number): number {
  return value - Math.floor(value);
}

export function applyScanlineAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'scanlineAdjustments'>,
  uvY: number,
  timelineTime: number,
): readonly [number, number, number] {
  const scrollOffset = timelineTime * finiteNumber(adjustment.speed, 0) * 0.1;
  const scanline = Math.sin((uvY + scrollOffset) * finiteNumber(adjustment.density, 5) * 100) * 0.5 + 0.5;
  const darken = 1 - finiteNumber(adjustment.opacity, 0.3) * (1 - scanline);
  return [input[0] * darken, input[1] * darken, input[2] * darken];
}

export function applyGrainAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'grainAdjustments'>,
  uvX: number,
  uvY: number,
  timelineTime: number,
): readonly [number, number, number] {
  const size = Math.max(finiteNumber(adjustment.size, 1), 0.001);
  const time = timelineTime * finiteNumber(adjustment.speed, 1);
  const grainU = uvX * (100 / size) + time * 0.1;
  const grainV = uvY * (100 / size) + time * 0.07;
  const noise = fract(Math.sin(grainU * 12.9898 + grainV * 78.233) * 43758.5453) * 2 - 1;
  const luminance = luma(input[0], input[1], input[2]);
  const intensity = finiteNumber(adjustment.amount, 0.1) * (1 - luminance * 0.5);
  return [
    clamp01(input[0] + noise * intensity),
    clamp01(input[1] + noise * intensity),
    clamp01(input[2] + noise * intensity),
  ];
}

export function applyVibranceAdjustment(
  input: readonly [number, number, number],
  adjustment: Adjustment<'vibranceAdjustments'>,
): readonly [number, number, number] {
  const maxChannel = Math.max(input[0], input[1], input[2]);
  const minChannel = Math.min(input[0], input[1], input[2]);
  const saturation = (maxChannel - minChannel) / (maxChannel + 0.001);
  const vibrance = finiteNumber(adjustment.amount, 0) * (1 - saturation);
  const gray = luma601(input[0], input[1], input[2]);
  const mixAmount = 1 + vibrance;
  const mix = (channel: number): number => clamp01(gray * (1 - mixAmount) + channel * mixAmount);
  return [mix(input[0]), mix(input[1]), mix(input[2])];
}
