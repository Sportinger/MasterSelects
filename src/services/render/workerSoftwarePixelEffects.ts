import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import type { RuntimePrimaryColorParams } from '../../types/colorCorrection';
import {
  applyWorkerSoftwareSourceResamplingEffects,
  hasWorkerSoftwareSourceResamplingEffects,
} from './workerSoftwareSourceResamplingEffects';
import {
  applyWorkerSoftwareFeedbackEffects,
  commitWorkerSoftwareFeedbackFrame,
  createWorkerSoftwareFeedbackFrame,
  hasWorkerSoftwareFeedbackEffects,
  type WorkerSoftwareFeedbackStore,
  type WorkerSoftwareFeedbackFrameMetadata,
} from './workerSoftwareFeedbackEffects';
import { applyWorkerSoftwareImageGraphs } from './workerSoftwareImageGraphs';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function luma(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function hueRotate(
  r: number,
  g: number,
  b: number,
  degrees: number,
): readonly [number, number, number] {
  const angle = degrees * Math.PI / 180;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const y = r * 0.299 + g * 0.587 + b * 0.114;
  const inPhase = r * 0.596 - g * 0.274 - b * 0.322;
  const quadrature = r * 0.211 - g * 0.523 + b * 0.312;
  const rotatedI = inPhase * cosine - quadrature * sine;
  const rotatedQ = inPhase * sine + quadrature * cosine;
  return [
    y + 0.956 * rotatedI + 0.621 * rotatedQ,
    y - 0.272 * rotatedI - 0.647 * rotatedQ,
    y - 1.106 * rotatedI + 1.703 * rotatedQ,
  ];
}

function applyPrimaryColorGrade(
  input: readonly [number, number, number],
  params: RuntimePrimaryColorParams,
): readonly [number, number, number] {
  const range = Math.max(params.whitePoint - params.blackPoint, 0.001);
  let r = clamp01((input[0] - params.blackPoint) / range);
  let g = clamp01((input[1] - params.blackPoint) / range);
  let b = clamp01((input[2] - params.blackPoint) / range);

  r += params.lift + params.offset + params.liftR + params.liftY + params.offsetR + params.offsetY;
  g += params.lift + params.offset + params.liftG + params.liftY + params.offsetG + params.offsetY;
  b += params.lift + params.offset + params.liftB + params.liftY + params.offsetB + params.offsetY;

  const exposure = 2 ** params.exposure;
  r *= exposure;
  g *= exposure;
  b *= exposure;

  const toneY = luma(r, g, b);
  const shadowMask = clamp01(1 - toneY * 2);
  const highlightMask = clamp01(toneY * 2 - 1);
  const toneDelta = params.shadows * 0.35 * shadowMask + params.highlights * 0.35 * highlightMask;
  r += toneDelta;
  g += toneDelta;
  b += toneDelta;

  const gammaR = Math.max(params.gamma * params.gammaR * params.gammaY, 0.001);
  const gammaG = Math.max(params.gamma * params.gammaG * params.gammaY, 0.001);
  const gammaB = Math.max(params.gamma * params.gammaB * params.gammaY, 0.001);
  r = Math.max(r, 0) ** (1 / gammaR);
  g = Math.max(g, 0) ** (1 / gammaG);
  b = Math.max(b, 0) ** (1 / gammaB);

  r *= params.gain * params.gainR * params.gainY;
  g *= params.gain * params.gainG * params.gainY;
  b *= params.gain * params.gainB * params.gainY;

  r = (r - params.pivot) * params.contrast + params.pivot;
  g = (g - params.pivot) * params.contrast + params.pivot;
  b = (b - params.pivot) * params.contrast + params.pivot;

  const y = luma(r, g, b);
  r = y + (r - y) * params.saturation;
  g = y + (g - y) * params.saturation;
  b = y + (b - y) * params.saturation;

  const chroma = Math.hypot(r - y, g - y, b - y);
  const vibranceMask = clamp01(1 - chroma * 1.8);
  const vibrance = 1 + params.vibrance * vibranceMask;
  r = y + (r - y) * vibrance;
  g = y + (g - y) * vibrance;
  b = y + (b - y) * vibrance;

  [r, g, b] = hueRotate(r, g, b, params.hue);
  r += params.temperature * 0.08;
  g += params.tint * 0.05;
  b -= params.temperature * 0.08;
  return [r, g, b];
}

function applyExposureAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['exposureAdjustments']
  >[number],
): readonly [number, number, number] {
  const exposure = 2 ** finiteNumber(adjustment.exposure, 0);
  const offset = finiteNumber(adjustment.offset, 0);
  const gamma = Math.max(finiteNumber(adjustment.gamma, 1), 0.001);
  const adjust = (value: number): number => clamp01(Math.max(value * exposure + offset, 0) ** (1 / gamma));
  return [adjust(input[0]), adjust(input[1]), adjust(input[2])];
}

function applyTemperatureAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['temperatureAdjustments']
  >[number],
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
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['levelsAdjustments']
  >[number],
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

function applyLevelsAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['levelsAdjustments']
  >[number],
): readonly [number, number, number] {
  return [
    remapLevelsChannel(input[0], adjustment),
    remapLevelsChannel(input[1], adjustment),
    remapLevelsChannel(input[2], adjustment),
  ];
}

function applyThresholdAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['thresholdAdjustments']
  >[number],
): readonly [number, number, number] {
  const result = luma(input[0], input[1], input[2]) > finiteNumber(adjustment.level, 0.5) ? 1 : 0;
  return [result, result, result];
}

function applyPosterizeAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['posterizeAdjustments']
  >[number],
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

function applyVignetteAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['vignetteAdjustments']
  >[number],
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

function applyChromaKeyAdjustment(
  input: readonly [number, number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['chromaKeyAdjustments']
  >[number],
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

function sampleLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const sampleX = clampIndex(x, width);
  const sampleY = clampIndex(y, height);
  const index = (sampleY * width + sampleX) * 4;
  return luma(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255);
}

function sampleRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
): readonly [number, number, number, number] {
  const sampleX = clampIndex(Math.round(uvX * (width - 1)), width);
  const sampleY = clampIndex(Math.round(uvY * (height - 1)), height);
  const index = (sampleY * width + sampleX) * 4;
  return [
    data[index] / 255,
    data[index + 1] / 255,
    data[index + 2] / 255,
    data[index + 3] / 255,
  ];
}

function applyEdgeDetectAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['edgeDetectAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const tl = sampleLuma(sourceData, width, height, x - 1, y - 1);
  const t = sampleLuma(sourceData, width, height, x, y - 1);
  const tr = sampleLuma(sourceData, width, height, x + 1, y - 1);
  const left = sampleLuma(sourceData, width, height, x - 1, y);
  const right = sampleLuma(sourceData, width, height, x + 1, y);
  const bl = sampleLuma(sourceData, width, height, x - 1, y + 1);
  const bottom = sampleLuma(sourceData, width, height, x, y + 1);
  const br = sampleLuma(sourceData, width, height, x + 1, y + 1);
  const gx = -tl - 2 * left - bl + tr + 2 * right + br;
  const gy = -tl - 2 * t - tr + bl + 2 * bottom + br;
  let edge = clamp01(Math.hypot(gx, gy) * finiteNumber(adjustment.strength, 1));
  if (adjustment.invert) edge = 1 - edge;
  return [edge, edge, edge, 1];
}

function applySharpenAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['sharpenAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const center = sampleRgba(sourceData, width, height, uvX, uvY);
  const amount = finiteNumber(adjustment.amount, 1);
  const radius = Math.max(0, finiteNumber(adjustment.radius, 1));
  if (amount === 0 || radius === 0) return center;

  const sigma = radius * 0.5 + 0.5;
  let r = 0;
  let g = 0;
  let b = 0;
  let weightTotal = 0;
  for (let sampleX = -3; sampleX <= 3; sampleX += 1) {
    for (let sampleY = -3; sampleY <= 3; sampleY += 1) {
      const weight = Math.exp(-(sampleX * sampleX + sampleY * sampleY) / (2 * sigma * sigma));
      const sample = sampleRgba(
        sourceData,
        width,
        height,
        uvX + (sampleX / width) * radius,
        uvY + (sampleY / height) * radius,
      );
      r += sample[0] * weight;
      g += sample[1] * weight;
      b += sample[2] * weight;
      weightTotal += weight;
    }
  }

  return [
    clamp01(center[0] + (center[0] - r / weightTotal) * amount),
    clamp01(center[1] + (center[1] - g / weightTotal) * amount),
    clamp01(center[2] + (center[2] - b / weightTotal) * amount),
    center[3],
  ];
}

function gaussian(value: number, sigma: number): number {
  const safeSigma = Math.max(sigma, 0.001);
  return Math.exp(-(value * value) / (2 * safeSigma * safeSigma));
}

function applyGlowAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['glowAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const color = sampleRgba(sourceData, width, height, uvX, uvY);
  const rings = Math.max(1, Math.min(32, Math.round(finiteNumber(adjustment.rings, 6.85))));
  const samplesPerRing = Math.max(4, Math.min(64, Math.round(finiteNumber(adjustment.samplesPerRing, 17.95))));
  const radius = Math.max(0, finiteNumber(adjustment.radius, 1));
  const softness = Math.max(0.001, finiteNumber(adjustment.softness, 0.496));
  const threshold = finiteNumber(adjustment.threshold, 0.7935);
  let glowR = 0;
  let glowG = 0;
  let glowB = 0;
  let weightTotal = 0;

  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = ring * radius * (1 / Math.max(width, 1)) * 10;
    const ringWeight = gaussian(ring / rings, softness + 0.3);
    for (let sampleIndex = 0; sampleIndex < samplesPerRing; sampleIndex += 1) {
      const angle = sampleIndex * Math.PI * 2 / samplesPerRing + ring * 0.5;
      const sample = sampleRgba(
        sourceData,
        width,
        height,
        clamp01(uvX + Math.cos(angle) * ringRadius),
        clamp01(uvY + Math.sin(angle) * ringRadius),
      );
      const sampleLuma = luma(sample[0], sample[1], sample[2]);
      const brightFactor = smoothstep(threshold - 0.1, threshold + 0.1, sampleLuma);
      glowR += sample[0] * brightFactor * ringWeight;
      glowG += sample[1] * brightFactor * ringWeight;
      glowB += sample[2] * brightFactor * ringWeight;
      weightTotal += ringWeight;
    }
  }

  const centerBright = smoothstep(threshold - 0.1, threshold + 0.1, luma(color[0], color[1], color[2]));
  glowR += color[0] * centerBright * 2;
  glowG += color[1] * centerBright * 2;
  glowB += color[2] * centerBright * 2;
  weightTotal += 2;

  const amount = finiteNumber(adjustment.amount, 1) * 2;
  return [
    clamp01(color[0] + (glowR / weightTotal) * amount),
    clamp01(color[1] + (glowG / weightTotal) * amount),
    clamp01(color[2] + (glowB / weightTotal) * amount),
    color[3],
  ];
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function applyScanlineAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['scanlineAdjustments']
  >[number],
  uvY: number,
  timelineTime: number,
): readonly [number, number, number] {
  const scrollOffset = timelineTime * finiteNumber(adjustment.speed, 0) * 0.1;
  const scanline = Math.sin((uvY + scrollOffset) * finiteNumber(adjustment.density, 5) * 100) * 0.5 + 0.5;
  const darken = 1 - finiteNumber(adjustment.opacity, 0.3) * (1 - scanline);
  return [input[0] * darken, input[1] * darken, input[2] * darken];
}

function applyGrainAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['grainAdjustments']
  >[number],
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

function applyVibranceAdjustment(
  input: readonly [number, number, number],
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['vibranceAdjustments']
  >[number],
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

export function hasWorkerSoftwarePixelEffects(layer: WorkerRenderSoftwareFrame['layers'][number]): boolean {
  const feedbackEffectCount = (layer.pixelEffects?.acuarelaAdjustments?.length ?? 0)
    + (layer.pixelEffects?.rom1Adjustments?.length ?? 0);
  const colorGradeNodeCount = layer.pixelEffects?.colorGradePrimaryNodes?.length ?? 0;
  const exposureAdjustmentCount = layer.pixelEffects?.exposureAdjustments?.length ?? 0;
  const temperatureAdjustmentCount = layer.pixelEffects?.temperatureAdjustments?.length ?? 0;
  const vibranceAdjustmentCount = layer.pixelEffects?.vibranceAdjustments?.length ?? 0;
  const levelsAdjustmentCount = layer.pixelEffects?.levelsAdjustments?.length ?? 0;
  const thresholdAdjustmentCount = layer.pixelEffects?.thresholdAdjustments?.length ?? 0;
  const posterizeAdjustmentCount = layer.pixelEffects?.posterizeAdjustments?.length ?? 0;
  const vignetteAdjustmentCount = layer.pixelEffects?.vignetteAdjustments?.length ?? 0;
  const chromaKeyAdjustmentCount = layer.pixelEffects?.chromaKeyAdjustments?.length ?? 0;
  const edgeDetectAdjustmentCount = layer.pixelEffects?.edgeDetectAdjustments?.length ?? 0;
  const sharpenAdjustmentCount = layer.pixelEffects?.sharpenAdjustments?.length ?? 0;
  const glowAdjustmentCount = layer.pixelEffects?.glowAdjustments?.length ?? 0;
  const scanlineAdjustmentCount = layer.pixelEffects?.scanlineAdjustments?.length ?? 0;
  const grainAdjustmentCount = layer.pixelEffects?.grainAdjustments?.length ?? 0;
  return feedbackEffectCount > 0
    || (layer.pixelEffects?.imageOperatorPlans?.length ?? 0) > 0
    || Math.abs(finiteNumber(layer.pixelEffects?.brightness, 0)) > 0.0001
    || exposureAdjustmentCount > 0
    || temperatureAdjustmentCount > 0
    || vibranceAdjustmentCount > 0
    || levelsAdjustmentCount > 0
    || thresholdAdjustmentCount > 0
    || posterizeAdjustmentCount > 0
    || vignetteAdjustmentCount > 0
    || chromaKeyAdjustmentCount > 0
    || edgeDetectAdjustmentCount > 0
    || sharpenAdjustmentCount > 0
    || glowAdjustmentCount > 0
    || scanlineAdjustmentCount > 0
    || grainAdjustmentCount > 0
    || hasWorkerSoftwareSourceResamplingEffects(layer.pixelEffects)
    || layer.pixelEffects?.mirrorHorizontal === true
    || layer.pixelEffects?.mirrorVertical === true
    || finiteNumber(layer.pixelEffects?.pixelateSize, 0) > 1
    || finiteNumber(layer.pixelEffects?.rgbSplit?.amount, 0) > 0
    || colorGradeNodeCount > 0;
}

export function applyWorkerSoftwarePixelEffects(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  layer: WorkerRenderSoftwareFrame['layers'][number],
  timelineTime: number,
  feedbackStore?: WorkerSoftwareFeedbackStore,
  feedbackScopeId = 'default',
  feedbackFrameMetadata?: WorkerSoftwareFeedbackFrameMetadata,
): void {
  const brightness = finiteNumber(layer.pixelEffects?.brightness, 0);
  const mirrorHorizontal = layer.pixelEffects?.mirrorHorizontal === true;
  const mirrorVertical = layer.pixelEffects?.mirrorVertical === true;
  const pixelateSize = Math.floor(finiteNumber(layer.pixelEffects?.pixelateSize, 0));
  const rgbSplit = layer.pixelEffects?.rgbSplit;
  const rgbSplitAmount = Math.max(0, finiteNumber(rgbSplit?.amount, 0));
  const exposureAdjustments = layer.pixelEffects?.exposureAdjustments ?? [];
  const temperatureAdjustments = layer.pixelEffects?.temperatureAdjustments ?? [];
  const vibranceAdjustments = layer.pixelEffects?.vibranceAdjustments ?? [];
  const levelsAdjustments = layer.pixelEffects?.levelsAdjustments ?? [];
  const thresholdAdjustments = layer.pixelEffects?.thresholdAdjustments ?? [];
  const posterizeAdjustments = layer.pixelEffects?.posterizeAdjustments ?? [];
  const vignetteAdjustments = layer.pixelEffects?.vignetteAdjustments ?? [];
  const chromaKeyAdjustments = layer.pixelEffects?.chromaKeyAdjustments ?? [];
  const edgeDetectAdjustments = layer.pixelEffects?.edgeDetectAdjustments ?? [];
  const sharpenAdjustments = layer.pixelEffects?.sharpenAdjustments ?? [];
  const glowAdjustments = layer.pixelEffects?.glowAdjustments ?? [];
  const scanlineAdjustments = layer.pixelEffects?.scanlineAdjustments ?? [];
  const grainAdjustments = layer.pixelEffects?.grainAdjustments ?? [];
  const colorGradePrimaryNodes = layer.pixelEffects?.colorGradePrimaryNodes ?? [];
  const hasPixelate = pixelateSize > 1;
  const hasRgbSplit = rgbSplitAmount > 0;
  if (!hasWorkerSoftwarePixelEffects(layer)) return;

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  applyWorkerSoftwareImageGraphs(data, width, height, layer.pixelEffects?.imageOperatorPlans ?? [], timelineTime, {
    owners: layer.pixelEffects?.imageOperatorPlanOwners, store: feedbackStore, scopeId: feedbackScopeId,
    frame: feedbackFrameMetadata ?? { timelineTimeSeconds: timelineTime },
  });
  const feedbackFrame = createWorkerSoftwareFeedbackFrame({
    pixelEffects: layer.pixelEffects,
    store: feedbackStore,
    scopeId: feedbackScopeId,
    width,
    height,
    frame: feedbackFrameMetadata ?? { timelineTimeSeconds: timelineTime },
  });
  const sourceData = mirrorHorizontal
    || mirrorVertical
    || hasPixelate
    || hasRgbSplit
    || hasWorkerSoftwareFeedbackEffects(layer.pixelEffects)
    || edgeDetectAdjustments.length > 0
    || sharpenAdjustments.length > 0
    || glowAdjustments.length > 0
    || hasWorkerSoftwareSourceResamplingEffects(layer.pixelEffects)
    || colorGradePrimaryNodes.length > 0
    ? new Uint8ClampedArray(data)
    : data;
  const splitDx = hasRgbSplit ? Math.round(Math.cos(finiteNumber(rgbSplit?.angle, 0)) * rgbSplitAmount * width) : 0;
  const splitDy = hasRgbSplit ? Math.round(Math.sin(finiteNumber(rgbSplit?.angle, 0)) * rgbSplitAmount * height) : 0;
  for (let y = 0; y < height; y += 1) {
    const sampleY = mirrorVertical && y >= height / 2 ? height - 1 - y : y;
    const pixelY = hasPixelate ? Math.floor(sampleY / pixelateSize) * pixelateSize : sampleY;
    for (let x = 0; x < width; x += 1) {
      const sampleX = mirrorHorizontal && x >= width / 2 ? width - 1 - x : x;
      const pixelX = hasPixelate ? Math.floor(sampleX / pixelateSize) * pixelateSize : sampleX;
      const targetIndex = (y * width + x) * 4;
      const sourceIndex = (pixelY * width + pixelX) * 4;
      const rIndex = hasRgbSplit
        ? (clampIndex(pixelY + splitDy, height) * width + clampIndex(pixelX + splitDx, width)) * 4
        : sourceIndex;
      const bIndex = hasRgbSplit
        ? (clampIndex(pixelY - splitDy, height) * width + clampIndex(pixelX - splitDx, width)) * 4
        : sourceIndex;
      let r = sourceData[rIndex] / 255 + brightness;
      let g = sourceData[sourceIndex + 1] / 255 + brightness;
      let b = sourceData[bIndex + 2] / 255 + brightness;
      let alpha = sourceData[sourceIndex + 3] / 255;
      const sourceResampled = applyWorkerSoftwareSourceResamplingEffects(
        sourceData,
        width,
        height,
        x,
        y,
        layer.pixelEffects,
      );
      if (sourceResampled) {
        [r, g, b, alpha] = sourceResampled;
      }
      [r, g, b, alpha] = applyWorkerSoftwareFeedbackEffects({
        frame: feedbackFrame,
        sourceData,
        width,
        height,
        x,
        y,
        current: [r, g, b, alpha],
        timelineTime,
      });
      for (const adjustment of exposureAdjustments) {
        [r, g, b] = applyExposureAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of temperatureAdjustments) {
        [r, g, b] = applyTemperatureAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of vibranceAdjustments) {
        [r, g, b] = applyVibranceAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of levelsAdjustments) {
        [r, g, b] = applyLevelsAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of thresholdAdjustments) {
        [r, g, b] = applyThresholdAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of posterizeAdjustments) {
        [r, g, b] = applyPosterizeAdjustment([r, g, b], adjustment);
      }
      for (const adjustment of vignetteAdjustments) {
        const uvX = (x + 0.5) / width;
        const uvY = (y + 0.5) / height;
        [r, g, b] = applyVignetteAdjustment([r, g, b], adjustment, uvX, uvY);
      }
      for (const adjustment of chromaKeyAdjustments) {
        [r, g, b, alpha] = applyChromaKeyAdjustment([r, g, b, alpha], adjustment);
      }
      for (const adjustment of edgeDetectAdjustments) {
        [r, g, b, alpha] = applyEdgeDetectAdjustment(sourceData, width, height, pixelX, pixelY, adjustment);
      }
      for (const adjustment of sharpenAdjustments) {
        const uvX = (x + 0.5) / width;
        const uvY = (y + 0.5) / height;
        [r, g, b, alpha] = applySharpenAdjustment(sourceData, width, height, uvX, uvY, adjustment);
      }
      for (const adjustment of glowAdjustments) {
        const uvX = (x + 0.5) / width;
        const uvY = (y + 0.5) / height;
        [r, g, b, alpha] = applyGlowAdjustment(sourceData, width, height, uvX, uvY, adjustment);
      }
      for (const adjustment of scanlineAdjustments) {
        const uvY = (y + 0.5) / height;
        [r, g, b] = applyScanlineAdjustment([r, g, b], adjustment, uvY, timelineTime);
      }
      for (const adjustment of grainAdjustments) {
        const uvX = (x + 0.5) / width;
        const uvY = (y + 0.5) / height;
        [r, g, b] = applyGrainAdjustment([r, g, b], adjustment, uvX, uvY, timelineTime);
      }
      for (const node of colorGradePrimaryNodes) {
        [r, g, b] = applyPrimaryColorGrade([r, g, b], node);
      }
      data[targetIndex] = clampByte(r * 255);
      data[targetIndex + 1] = clampByte(g * 255);
      data[targetIndex + 2] = clampByte(b * 255);
      data[targetIndex + 3] = clampByte(alpha * 255);
    }
  }
  commitWorkerSoftwareFeedbackFrame(feedbackFrame);
  context.putImageData(imageData, 0, 0);
}
