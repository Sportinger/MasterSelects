import type { WorkerRenderSoftwareFrame, WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';
import { projectImageRadius, rotateImageCoordinate, unprojectImageRadius } from '../operators/imageOpticsSemantics';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

function applyWaveAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['waveAdjustments']
  >[number],
): readonly [number, number, number, number] {
  let sampleUvY = uvY + Math.sin(uvX * finiteNumber(adjustment.frequencyX, 5) * Math.PI * 2)
    * finiteNumber(adjustment.amplitudeX, 0.02);
  const sampleUvX = uvX + Math.sin(sampleUvY * finiteNumber(adjustment.frequencyY, 5) * Math.PI * 2)
    * finiteNumber(adjustment.amplitudeY, 0.02);
  sampleUvY = clamp01(sampleUvY);
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), sampleUvY);
}

function applyKaleidoscopeAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['kaleidoscopeAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const deltaX = uvX - 0.5;
  const deltaY = uvY - 0.5;
  const angle = Math.atan2(deltaY, deltaX) + finiteNumber(adjustment.rotation, 0);
  const radius = Math.hypot(deltaX, deltaY);
  const segmentAngle = (Math.PI * 2) / Math.max(2, finiteNumber(adjustment.segments, 6));
  let foldedAngle = (angle / segmentAngle - Math.floor(angle / segmentAngle)) * segmentAngle;
  if (foldedAngle > segmentAngle * 0.5) {
    foldedAngle = segmentAngle - foldedAngle;
  }
  return sampleRgba(
    sourceData,
    width,
    height,
    clamp01(Math.cos(foldedAngle) * radius + 0.5),
    clamp01(Math.sin(foldedAngle) * radius + 0.5),
  );
}

function applyTwirlAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['twirlAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const radius = Math.max(finiteNumber(adjustment.radius, 0.5), 0.0001);
  if (distance >= radius) return sampleRgba(sourceData, width, height, uvX, uvY);

  const factor = 1 - Math.min(distance / radius, 1);
  const angle = finiteNumber(adjustment.amount, 1) * factor * factor;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const sampleUvX = centerX + deltaX * cosine - deltaY * sine;
  const sampleUvY = centerY + deltaX * sine + deltaY * cosine;
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), clamp01(sampleUvY));
}

function applyMotionBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['motionBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.05));
  if (amount < 0.001) return sampleRgba(sourceData, width, height, uvX, uvY);

  const samples = Math.max(4, Math.min(128, Math.round(finiteNumber(adjustment.samples, 24))));
  const angle = finiteNumber(adjustment.angle, 0);
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let weightTotal = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = (sampleIndex / (samples - 1) - 0.5) * 2;
    const weight = Math.exp(-t * t * 2);
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      mirrorEdgeUv(uvX + directionX * t * amount),
      mirrorEdgeUv(uvY + directionY * t * amount),
    );
    r += sample[0] * weight;
    g += sample[1] * weight;
    b += sample[2] * weight;
    alpha += sample[3] * weight;
    weightTotal += weight;
  }

  return [
    r / weightTotal,
    g / weightTotal,
    b / weightTotal,
    alpha / weightTotal,
  ];
}

function applyRadialBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['radialBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.5));
  if (amount < 0.01) return sampleRgba(sourceData, width, height, uvX, uvY);

  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const samples = Math.max(4, Math.min(256, Math.round(finiteNumber(adjustment.samples, 32))));
  const scaledAmount = amount * 0.2;
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let weightTotal = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = sampleIndex / (samples - 1);
    const scale = 1 - scaledAmount * t * distance;
    const weight = 1 - t * 0.5;
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      clamp01(centerX + deltaX * scale),
      clamp01(centerY + deltaY * scale),
    );
    r += sample[0] * weight;
    g += sample[1] * weight;
    b += sample[2] * weight;
    alpha += sample[3] * weight;
    weightTotal += weight;
  }

  return [
    r / weightTotal,
    g / weightTotal,
    b / weightTotal,
    alpha / weightTotal,
  ];
}

function applyZoomBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['zoomBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const samples = Math.max(4, Math.min(256, Math.round(finiteNumber(adjustment.samples, 16))));
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.3)) * 0.5;
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = sampleIndex / (samples - 1);
    const scale = 1 + amount * t;
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      clamp01(centerX + deltaX * scale),
      clamp01(centerY + deltaY * scale),
    );
    r += sample[0];
    g += sample[1];
    b += sample[2];
    alpha += sample[3];
  }

  return [
    r / samples,
    g / samples,
    b / samples,
    alpha / samples,
  ];
}

function applyBulgeAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['bulgeAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const radius = Math.max(finiteNumber(adjustment.radius, 0.5), 0.0001);
  if (distance >= radius || distance <= 0) return sampleRgba(sourceData, width, height, uvX, uvY);

  const safeDistance = Math.max(distance, 0.0001);
  const normalizedDistance = safeDistance / radius;
  const factor = normalizedDistance ** finiteNumber(adjustment.amount, 0.5);
  const newDistance = factor * radius;
  const sampleUvX = centerX + (deltaX / safeDistance) * newDistance;
  const sampleUvY = centerY + (deltaY / safeDistance) * newDistance;
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), clamp01(sampleUvY));
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
  const color = sampleRgba(sourceData, width, height, sampleX, sampleY);
  if (adjustment.edgeMode !== 'transparent') return color;

  const insideDistance = Math.min(uvX, uvY, 1 - uvX, 1 - uvY);
  const coverage = adjustment.edgeFeather <= 0.00001
    ? (insideDistance >= 0 ? 1 : 0)
    : smoothstep(0, adjustment.edgeFeather, insideDistance);
  return [color[0] * coverage, color[1] * coverage, color[2] * coverage, color[3] * coverage];
}

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
    lensColor = [red[0], green[1], blue[2], (red[3] + green[3] + blue[3]) / 3];
  }

  const vignetteMask = smoothstep(Math.max(0, 1 - adjustment.vignetteSoftness), 1, radius);
  const vignetteGain = 1 - adjustment.vignette * vignetteMask;
  lensColor = [
    lensColor[0] * vignetteGain,
    lensColor[1] * vignetteGain,
    lensColor[2] * vignetteGain,
    lensColor[3],
  ];

  const original = sampleRgba(sourceData, width, height, uvX, uvY);
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
    return renderFisheyeSample(sourceData, width, height, uvX, uvY, adjustment);
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
  return [red / adjustment.samples, green / adjustment.samples, blue / adjustment.samples, alpha / adjustment.samples];
}

export function hasWorkerSoftwareSourceResamplingEffects(
  pixelEffects: WorkerRenderSoftwarePixelEffects | undefined,
): boolean {
  return (pixelEffects?.waveAdjustments?.length ?? 0) > 0
    || (pixelEffects?.kaleidoscopeAdjustments?.length ?? 0) > 0
    || (pixelEffects?.twirlAdjustments?.length ?? 0) > 0
    || (pixelEffects?.bulgeAdjustments?.length ?? 0) > 0
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
): readonly [number, number, number, number] | null {
  const uvX = (x + 0.5) / width;
  const uvY = (y + 0.5) / height;
  let output: readonly [number, number, number, number] | null = null;
  for (const adjustment of pixelEffects.waveAdjustments ?? []) {
    output = applyWaveAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.kaleidoscopeAdjustments ?? []) {
    output = applyKaleidoscopeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.twirlAdjustments ?? []) {
    output = applyTwirlAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.bulgeAdjustments ?? []) {
    output = applyBulgeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.fisheyeAdjustments ?? []) {
    output = applyFisheyeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.motionBlurAdjustments ?? []) {
    output = applyMotionBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.radialBlurAdjustments ?? []) {
    output = applyRadialBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.zoomBlurAdjustments ?? []) {
    output = applyZoomBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  return output;
}
