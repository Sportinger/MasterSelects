import type { WorkerRenderSoftwareFrame, WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';
import { projectImageRadius, rotateImageCoordinate, unprojectImageRadius } from '../operators/imageOpticsSemantics';
import {
  directionalBlurPlan, directionalBlurStreakPx, fillCoveredCellTaps, type DirectionalBlurPlan, type DirectionalBlurType,
} from '../../effects/blur/blurSampling';
import { Logger } from '../logger';
import { applyWorkerSoftwareUvDistort } from './workerSoftwareUvDistortEffects';

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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

function mirrorEdgeUv(value: number): number {
  const wrapped = value - Math.floor(value * 0.5) * 2;
  return wrapped > 1 ? 2 - wrapped : wrapped;
}

type DirectionalAdjustment = { readonly amount: number; readonly angle?: number; readonly centerX?: number;
  readonly centerY?: number; readonly mode?: 'zoom' | 'spin' };
const SOFTWARE_DIRECTIONAL_MAX_TAPS = 64;
const directionalPlans = new WeakMap<DirectionalAdjustment, CachedDirectionalPlan>();
const log = Logger.create('SoftwareBlur');
const reportedTapCaps = new Set<string>();

/** Longer streaks than the tap cap step visibly in the CPU preview: say so once per effect, size and streak. */
function reportSoftwareTapCap(type: DirectionalBlurType, adjustment: DirectionalAdjustment, width: number, height: number): void {
  const streak = directionalBlurStreakPx(type, adjustment, width, height);
  if (!(streak > SOFTWARE_DIRECTIONAL_MAX_TAPS)) return;
  const key = `${type}:${width}x${height}:${Math.round(streak)}`;
  if (reportedTapCaps.has(key)) return;
  if (reportedTapCaps.size > 256) reportedTapCaps.clear();
  reportedTapCaps.add(key);
  log.warn(`${type} in the software preview at ${width}×${height}: the ${Math.round(streak)} px streak is read with `
    + `${SOFTWARE_DIRECTIONAL_MAX_TAPS} taps about ${(streak / SOFTWARE_DIRECTIONAL_MAX_TAPS).toFixed(1)} px apart, so it can look stepped `
    + '(the GPU preview and the export use the two-stage graph).');
}

/** Reused tap buffers of the CPU directional blurs (one frame is painted pixel by pixel, never re-entrantly). */
const tapOffsets = new Float64Array(SOFTWARE_DIRECTIONAL_MAX_TAPS), tapWeights = new Float64Array(SOFTWARE_DIRECTIONAL_MAX_TAPS);

type CachedDirectionalPlan = {
  width: number; height: number; plan: DirectionalBlurPlan;
  /** Motion Blur's taps are the same at every pixel: offsets and tapered weights, computed once per plan. */
  motionTaps?: { count: number; offsets: Float64Array; weights: Float64Array; total: number };
};

/**
 * Motion, Radial and Zoom Blur on the CPU: the shared sampling contract (blurSampling.ts) in one
 * stage of covered one-pixel cells along each pixel's own range (coveredCellTaps, as stage A of
 * the GPU graph), up to 64 taps, read bilinearly (premultiplied, texel centres at i + 0.5, edge
 * texels repeat, like the GPU sampler). An animated amount therefore changes the picture
 * continuously; streaks longer than 64 px spread their cells and are logged (the GPU graph uses
 * two stages and stays continuous). This runs once per pixel, so it builds no arrays per pixel
 * or per tap: taps go into reused typed arrays, coordinates and corners stay scalar.
 */
function applyDirectionalBlurAdjustment(
  type: DirectionalBlurType,
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: DirectionalAdjustment,
): readonly [number, number, number, number] {
  let cached: CachedDirectionalPlan | undefined = directionalPlans.get(adjustment);
  if (!cached || cached.width !== width || cached.height !== height) {
    cached = { width, height, plan: directionalBlurPlan(type, adjustment, width, height) };
    directionalPlans.set(adjustment, cached);
    reportSoftwareTapCap(type, adjustment, width, height);
  }
  const plan = cached.plan, pixelX = uvX * width, pixelY = uvY * height, pixel: [number, number] = [pixelX, pixelY];
  const { start, length } = plan.range(pixel), span = Math.abs(length);
  const middle = start + length * 0.5, sign = length < 0 ? -1 : 1;
  let count: number, offsets: Float64Array, weights: Float64Array, weightTotal: number;
  if (plan.group === 'translate' && cached.motionTaps) {
    ({ count, offsets, weights, total: weightTotal } = cached.motionTaps);
  } else {
    const reachPx = span * plan.speed(pixel);
    offsets = tapOffsets; weights = tapWeights; weightTotal = 0;
    // No streak: the pixel's own texel (the taps converge on it as the amount goes to 0).
    if (reachPx > 1e-6) count = fillCoveredCellTaps(span, reachPx, SOFTWARE_DIRECTIONAL_MAX_TAPS, offsets, weights);
    else { count = 1; offsets[0] = 0; weights[0] = 1; }
    for (let index = 0; index < count; index += 1) {
      weights[index] *= plan.taper(span > 0 ? 0.5 + offsets[index] / span : 0.5);
      weightTotal += weights[index];
    }
    if (plan.group === 'translate') {
      cached.motionTaps = { count, offsets: offsets.slice(0, count), weights: weights.slice(0, count), total: weightTotal };
    }
  }
  const [directionX, directionY] = plan.direction, [centerX, centerY] = plan.center;
  const dx = pixelX - centerX, dy = pixelY - centerY;
  let red = 0, green = 0, blue = 0, coverageSum = 0;
  for (let index = 0; index < count; index += 1) {
    const u = middle + sign * offsets[index], weight = weights[index];
    let px: number, py: number;
    if (plan.group === 'translate') {
      px = mirrorEdgeUv((pixelX + directionX * u) / width) * width; py = mirrorEdgeUv((pixelY + directionY * u) / height) * height;
    } else if (plan.group === 'scale') {
      const scale = Math.exp(u); px = centerX + dx * scale; py = centerY + dy * scale;
    } else {
      const cos = Math.cos(u), sin = Math.sin(u); px = centerX + dx * cos - dy * sin; py = centerY + dx * sin + dy * cos;
    }
    // Premultiplied bilinear read: a tap that moves by a fraction of a pixel changes the result by that fraction.
    const fx = px - 0.5, fy = py - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const xa = clampIndex(x0, width), xb = clampIndex(x0 + 1, width), ya = clampIndex(y0, height), yb = clampIndex(y0 + 1, height);
    const i00 = (ya * width + xa) * 4, i10 = (ya * width + xb) * 4, i01 = (yb * width + xa) * 4, i11 = (yb * width + xb) * 4;
    const s00 = (1 - tx) * (1 - ty) * weight * sourceData[i00 + 3], s10 = tx * (1 - ty) * weight * sourceData[i10 + 3];
    const s01 = (1 - tx) * ty * weight * sourceData[i01 + 3], s11 = tx * ty * weight * sourceData[i11 + 3];
    red += sourceData[i00] * s00 + sourceData[i10] * s10 + sourceData[i01] * s01 + sourceData[i11] * s11;
    green += sourceData[i00 + 1] * s00 + sourceData[i10 + 1] * s10 + sourceData[i01 + 1] * s01 + sourceData[i11 + 1] * s11;
    blue += sourceData[i00 + 2] * s00 + sourceData[i10 + 2] * s10 + sourceData[i01 + 2] * s01 + sourceData[i11 + 2] * s11;
    coverageSum += s00 + s10 + s01 + s11;
  }
  // Colour sums carry byte * byte alpha; coverage sums carry byte alpha.
  const alpha = coverageSum / 255 / weightTotal, coverage = Math.max(coverageSum, 1e-6 * 255 * weightTotal);
  return [red / 255 / coverage, green / 255 / coverage, blue / 255 / coverage, alpha];
}

type FisheyeAdjustment = NonNullable<
  WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['fisheyeAdjustments']
>[number];

type Rgba = readonly [number, number, number, number];

function fisheyeProjectionModel(projection: FisheyeAdjustment['projection']): number {
  return projection === 'equisolid' ? 1 : projection === 'stereographic' ? 2 : projection === 'orthographic' ? 3 : 0;
}

function fisheyeProjectionRadius(
  theta: number,
  maxTheta: number,
  projection: FisheyeAdjustment['projection'],
): number {
  return projectImageRadius(theta, maxTheta, fisheyeProjectionModel(projection));
}

function fisheyeInverseProjectionRadius(
  radius: number,
  maxTheta: number,
  projection: FisheyeAdjustment['projection'],
): number {
  return unprojectImageRadius(radius, maxTheta, fisheyeProjectionModel(projection));
}

function fisheyeMappedRadius(radius: number, adjustment: FisheyeAdjustment): number {
  const maxTheta = Math.max(0.01, Math.min(Math.PI * 0.4861, adjustment.fieldOfView * Math.PI / 360));
  const rectilinearScale = Math.max(Math.tan(maxTheta), 0.0001);
  let targetRadius: number;
  if (adjustment.strength >= 0) {
    const theta = fisheyeInverseProjectionRadius(radius, maxTheta, adjustment.projection);
    targetRadius = Math.tan(theta) / rectilinearScale;
  } else {
    const theta = Math.atan(radius * rectilinearScale);
    targetRadius = fisheyeProjectionRadius(theta, maxTheta, adjustment.projection);
  }
  const direction = adjustment.strength >= 0 ? 1 : -1;
  const curveDelta = (radius ** 3 - radius) * 0.35;
  const tunedRadius = Math.max(0, targetRadius + adjustment.curveBias * direction * curveDelta);
  return (radius + (tunedRadius - radius) * Math.abs(adjustment.strength)) / adjustment.zoom;
}

function rotatePoint(x: number, y: number, angle: number): readonly [number, number] {
  return rotateImageCoordinate([x, y], angle);
}

function fisheyeUvToLens(
  uvX: number,
  uvY: number,
  width: number,
  height: number,
  adjustment: FisheyeAdjustment,
): readonly [number, number] {
  let deltaX = uvX - adjustment.centerX;
  let deltaY = uvY - adjustment.centerY;
  if (adjustment.preserveAspect) deltaX *= width / Math.max(1, height);
  [deltaX, deltaY] = rotatePoint(deltaX, deltaY, -adjustment.rotation * Math.PI / 180);
  deltaX *= adjustment.squeeze;
  const scale = Math.max(adjustment.radius * 0.5, 0.0001);
  return [deltaX / scale, deltaY / scale];
}

function fisheyeLensToUv(
  lensX: number,
  lensY: number,
  width: number,
  height: number,
  adjustment: FisheyeAdjustment,
): readonly [number, number] {
  let deltaX = lensX * Math.max(adjustment.radius * 0.5, 0.0001) / adjustment.squeeze;
  let deltaY = lensY * Math.max(adjustment.radius * 0.5, 0.0001);
  [deltaX, deltaY] = rotatePoint(deltaX, deltaY, adjustment.rotation * Math.PI / 180);
  if (adjustment.preserveAspect) deltaX /= width / Math.max(1, height);
  return [adjustment.centerX + deltaX, adjustment.centerY + deltaY];
}

function fisheyeEdgeSample(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: FisheyeAdjustment,
): Rgba {
  let sampleX = uvX;
  let sampleY = uvY;
  if (adjustment.edgeMode === 'mirror') {
    sampleX = mirrorEdgeUv(sampleX);
    sampleY = mirrorEdgeUv(sampleY);
  } else if (adjustment.edgeMode === 'repeat') {
    sampleX -= Math.floor(sampleX);
    sampleY -= Math.floor(sampleY);
  } else {
    sampleX = clamp01(sampleX);
    sampleY = clamp01(sampleY);
  }
  const color = premultipliedRgba(sampleRgba(sourceData, width, height, sampleX, sampleY));
  if (adjustment.edgeMode !== 'transparent') return color;

  const insideDistance = Math.min(uvX, uvY, 1 - uvX, 1 - uvY);
  const coverage = adjustment.edgeFeather <= 0.00001
    ? (insideDistance >= 0 ? 1 : 0)
    : smoothstep(0, adjustment.edgeFeather, insideDistance);
  return [color[0] * coverage, color[1] * coverage, color[2] * coverage, color[3] * coverage];
}

/** Fisheye works on premultiplied colour (as its graph does), so coverage and averages never darken edges. */
const premultipliedRgba = (color: Rgba): Rgba => [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]];
const straightRgba = (color: Rgba): Rgba => {
  const alpha = Math.max(color[3], 1e-6);
  return [color[0] / alpha, color[1] / alpha, color[2] / alpha, color[3]];
};

function mixRgba(from: Rgba, to: Rgba, amount: number): Rgba {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
    from[3] + (to[3] - from[3]) * amount,
  ];
}

function renderFisheyeSample(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: FisheyeAdjustment,
): Rgba {
  const [lensX, lensY] = fisheyeUvToLens(uvX, uvY, width, height, adjustment);
  const radius = Math.hypot(lensX, lensY);
  const safeRadius = Math.max(radius, 0.000001);
  const directionX = lensX / safeRadius;
  const directionY = lensY / safeRadius;
  const mappedRadius = fisheyeMappedRadius(radius, adjustment);
  const chromaShift = adjustment.chromaticAberration * radius * radius;

  const sampleChannel = (radiusScale: number): Rgba => {
    const [sampleX, sampleY] = fisheyeLensToUv(
      directionX * mappedRadius * radiusScale,
      directionY * mappedRadius * radiusScale,
      width,
      height,
      adjustment,
    );
    return fisheyeEdgeSample(sourceData, width, height, sampleX, sampleY, adjustment);
  };

  let lensColor: Rgba;
  if (adjustment.chromaticAberration <= 0.000001) {
    lensColor = sampleChannel(1);
  } else {
    const red = sampleChannel(1 + chromaShift);
    const green = sampleChannel(1);
    const blue = sampleChannel(1 - chromaShift);
    // Each sample is premultiplied by its own alpha: straight colour per channel, then the shared alpha.
    const alpha = (red[3] + green[3] + blue[3]) / 3;
    lensColor = [red[0] / Math.max(red[3], 1e-6) * alpha, green[1] / Math.max(green[3], 1e-6) * alpha,
      blue[2] / Math.max(blue[3], 1e-6) * alpha, alpha];
  }

  const vignetteMask = smoothstep(Math.max(0, 1 - adjustment.vignetteSoftness), 1, radius);
  const vignetteGain = 1 - adjustment.vignette * vignetteMask;
  lensColor = [
    lensColor[0] * vignetteGain,
    lensColor[1] * vignetteGain,
    lensColor[2] * vignetteGain,
    lensColor[3],
  ];

  const original = premultipliedRgba(sampleRgba(sourceData, width, height, uvX, uvY));
  const outside: Rgba = adjustment.outside === 'transparent' ? [0, 0, 0, 0] : original;
  const coverage = adjustment.feather <= 0.00001
    ? (radius <= 1 ? 1 : 0)
    : 1 - smoothstep(Math.max(0, 1 - adjustment.feather), 1, radius);
  return mixRgba(outside, lensColor, coverage);
}

const FISHEYE_JITTER: readonly (readonly [number, number])[] = [
  [-0.375, -0.125], [0.125, -0.375], [0.375, 0.125], [-0.125, 0.375],
  [-0.4375, 0.3125], [-0.3125, -0.4375], [0.4375, -0.3125], [0.3125, 0.4375],
];

function applyFisheyeAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: FisheyeAdjustment,
): Rgba {
  if (adjustment.samples <= 1) {
    return straightRgba(renderFisheyeSample(sourceData, width, height, uvX, uvY, adjustment));
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let index = 0; index < adjustment.samples; index += 1) {
    const jitter = FISHEYE_JITTER[index];
    const sample = renderFisheyeSample(
      sourceData,
      width,
      height,
      uvX + jitter[0] / width,
      uvY + jitter[1] / height,
      adjustment,
    );
    red += sample[0];
    green += sample[1];
    blue += sample[2];
    alpha += sample[3];
  }
  return straightRgba([red / adjustment.samples, green / adjustment.samples, blue / adjustment.samples, alpha / adjustment.samples]);
}

export function hasWorkerSoftwareSourceResamplingEffects(
  pixelEffects: WorkerRenderSoftwarePixelEffects | undefined,
): boolean {
  return (pixelEffects?.uvDistortAdjustments?.length ?? 0) > 0
    || (pixelEffects?.fisheyeAdjustments?.length ?? 0) > 0
    || (pixelEffects?.motionBlurAdjustments?.length ?? 0) > 0
    || (pixelEffects?.radialBlurAdjustments?.length ?? 0) > 0
    || (pixelEffects?.zoomBlurAdjustments?.length ?? 0) > 0;
}

export function applyWorkerSoftwareSourceResamplingEffects(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  pixelEffects: WorkerRenderSoftwarePixelEffects,
  timelineTime = 0,
): readonly [number, number, number, number] | null {
  const uvX = (x + 0.5) / width;
  const uvY = (y + 0.5) / height;
  let output: readonly [number, number, number, number] | null = null;
  for (const adjustment of pixelEffects.uvDistortAdjustments ?? []) {
    output = applyWorkerSoftwareUvDistort(sourceData, width, height, uvX, uvY, adjustment, timelineTime);
  }
  for (const adjustment of pixelEffects.fisheyeAdjustments ?? []) {
    output = applyFisheyeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.motionBlurAdjustments ?? []) {
    output = applyDirectionalBlurAdjustment('motion-blur', sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.radialBlurAdjustments ?? []) {
    output = applyDirectionalBlurAdjustment('radial-blur', sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.zoomBlurAdjustments ?? []) {
    output = applyDirectionalBlurAdjustment('zoom-blur', sourceData, width, height, uvX, uvY, adjustment);
  }
  return output;
}
