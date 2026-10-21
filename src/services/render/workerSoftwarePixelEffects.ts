import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import type { RuntimePrimaryColorParams } from '../../types/colorCorrection';
import { applyShadowHighlightTone } from '../../engine/color/shadowHighlightTone';
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
import { applyWorkerSoftwareMirrorPixelEffects } from './workerSoftwareMirrorPixelEffects';
import { applyWorkerSoftwareGlow, prepareWorkerSoftwareGlow } from './workerSoftwareGlow';
import {
  applyChromaKeyAdjustment, applyExposureAdjustment, applyGrainAdjustment, applyLevelsAdjustment, applyPosterizeAdjustment,
  applyScanlineAdjustment, applyTemperatureAdjustment, applyThresholdAdjustment, applyVibranceAdjustment, applyVignetteAdjustment,
  clamp01, finiteNumber, luma,
} from './workerSoftwarePointwiseEffects';

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
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

  [r, g, b] = applyShadowHighlightTone(r, g, b, params.shadows, params.highlights);

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

/** Effects of the per-pixel loop (everything but the image graphs and the whole-frame mirror/pixel pass). */
function hasPerPixelEffects(layer: WorkerRenderSoftwareFrame['layers'][number]): boolean {
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
    || colorGradeNodeCount > 0;
}

export function hasWorkerSoftwarePixelEffects(layer: WorkerRenderSoftwareFrame['layers'][number]): boolean {
  return hasPerPixelEffects(layer)
    || (layer.pixelEffects?.imageOperatorPlans?.length ?? 0) > 0
    || (layer.pixelEffects?.mirrorPixelAdjustments?.length ?? 0) > 0;
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
  if (!hasWorkerSoftwarePixelEffects(layer)) return;

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  applyWorkerSoftwareImageGraphs(data, width, height, layer.pixelEffects?.imageOperatorPlans ?? [], timelineTime, {
    owners: layer.pixelEffects?.imageOperatorPlanOwners, store: feedbackStore, scopeId: feedbackScopeId,
    frame: feedbackFrameMetadata ?? { timelineTimeSeconds: timelineTime },
  });
  // Kaleidoscope, Mirror, RGB Split and Pixelate, with the pointwise effects in front of them,
  // run first on the whole frame in stack order; the rest of the stack follows per pixel.
  applyWorkerSoftwareMirrorPixelEffects(data, width, height, layer.pixelEffects?.mirrorPixelAdjustments ?? [], timelineTime);
  // Nothing left for the per-pixel loop: skip its identity pass over the frame.
  if (!hasPerPixelEffects(layer)) {
    context.putImageData(imageData, 0, 0);
    return;
  }
  const feedbackFrame = createWorkerSoftwareFeedbackFrame({
    pixelEffects: layer.pixelEffects,
    store: feedbackStore,
    scopeId: feedbackScopeId,
    width,
    height,
    frame: feedbackFrameMetadata ?? { timelineTimeSeconds: timelineTime },
  });
  const sourceData = hasWorkerSoftwareFeedbackEffects(layer.pixelEffects)
    || edgeDetectAdjustments.length > 0
    || sharpenAdjustments.length > 0
    || glowAdjustments.length > 0
    || hasWorkerSoftwareSourceResamplingEffects(layer.pixelEffects)
    || colorGradePrimaryNodes.length > 0
    ? new Uint8ClampedArray(data)
    : data;
  // Glow is a separable neighborhood prefilter; build it once per frame, then sample rings per pixel.
  const glowFields = glowAdjustments.map(adjustment => prepareWorkerSoftwareGlow(sourceData, width, height, adjustment));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetIndex = (y * width + x) * 4;
      const sourceIndex = targetIndex;
      let r = sourceData[sourceIndex] / 255 + brightness;
      let g = sourceData[sourceIndex + 1] / 255 + brightness;
      let b = sourceData[sourceIndex + 2] / 255 + brightness;
      let alpha = sourceData[sourceIndex + 3] / 255;
      const sourceResampled = applyWorkerSoftwareSourceResamplingEffects(
        sourceData,
        width,
        height,
        x,
        y,
        layer.pixelEffects,
        timelineTime,
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
        [r, g, b, alpha] = applyEdgeDetectAdjustment(sourceData, width, height, x, y, adjustment);
      }
      for (const adjustment of sharpenAdjustments) {
        const uvX = (x + 0.5) / width;
        const uvY = (y + 0.5) / height;
        [r, g, b, alpha] = applySharpenAdjustment(sourceData, width, height, uvX, uvY, adjustment);
      }
      for (const glow of glowFields) {
        [r, g, b, alpha] = applyWorkerSoftwareGlow(glow, sourceData, x, y);
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
