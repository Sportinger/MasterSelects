import type { Md1GoldenCrop } from './md1GoldenFixture';

export interface Md1PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface Md1PixelComparisonThresholds {
  readonly channelTolerance: number;
  readonly maxChangedPixelRatio: number;
  readonly maxMeanAbsoluteChannelDelta: number;
  readonly maxP99ChannelDelta: number;
  readonly maxChannelDelta: number;
  readonly maxAlphaCoverageDelta: number;
}

export const MD1_STRICT_PIXEL_THRESHOLDS: Md1PixelComparisonThresholds = {
  channelTolerance: 2,
  maxChangedPixelRatio: 0.01,
  maxMeanAbsoluteChannelDelta: 0.5,
  maxP99ChannelDelta: 4,
  maxChannelDelta: 32,
  maxAlphaCoverageDelta: 0.005,
};

export const MD1_GOLDEN_PIXEL_THRESHOLDS: Md1PixelComparisonThresholds = {
  channelTolerance: 6,
  maxChangedPixelRatio: 0.04,
  maxMeanAbsoluteChannelDelta: 2,
  maxP99ChannelDelta: 12,
  // Preview/export rasterizers can disagree on a sparse antialiased edge pixel
  // while the aggregate and P99 error remain effectively zero.
  maxChannelDelta: 96,
  maxAlphaCoverageDelta: 0.015,
};

export interface Md1PixelComparison {
  readonly passed: boolean;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly changedPixelCount: number;
  readonly changedPixelRatio: number;
  readonly meanAbsoluteChannelDelta: number;
  readonly p99ChannelDelta: number;
  readonly maxChannelDelta: number;
  readonly referenceAlphaCoverage: number;
  readonly candidateAlphaCoverage: number;
  readonly alphaCoverageDelta: number;
  readonly failures: string[];
}

function assertPixelBuffer(buffer: Md1PixelBuffer, label: string): void {
  if (!Number.isInteger(buffer.width) || buffer.width <= 0) {
    throw new Error(`${label} width must be a positive integer`);
  }
  if (!Number.isInteger(buffer.height) || buffer.height <= 0) {
    throw new Error(`${label} height must be a positive integer`);
  }
  const requiredLength = buffer.width * buffer.height * 4;
  if (buffer.data.length !== requiredLength) {
    throw new Error(`${label} RGBA length ${buffer.data.length} does not match ${requiredLength}`);
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? Math.round(value) : 0));
}

/**
 * Flatten a premultiplied RGBA render target onto opaque black.
 *
 * WebGPU preview readback already stores RGB premultiplied by alpha, while a
 * standard video export represents the same transparent area as opaque black.
 * Making only the alpha channel opaque puts both representations in the same
 * comparison space without altering their rendered RGB content.
 */
export function flattenPremultipliedMd1PixelBufferOnBlack(source: Md1PixelBuffer): Md1PixelBuffer {
  assertPixelBuffer(source, 'source');
  const data = new Uint8ClampedArray(source.data.length);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    data[offset] = clampByte(source.data[offset]);
    data[offset + 1] = clampByte(source.data[offset + 1]);
    data[offset + 2] = clampByte(source.data[offset + 2]);
    data[offset + 3] = 255;
  }
  return { width: source.width, height: source.height, data };
}

function percentile(values: Uint8Array, percentileValue: number): number {
  if (values.length === 0) return 0;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < values.length; index += 1) {
    histogram[values[index]] += 1;
  }
  const target = Math.ceil(values.length * percentileValue);
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return 255;
}

export function compareMd1PixelBuffers(
  reference: Md1PixelBuffer,
  candidate: Md1PixelBuffer,
  thresholds: Md1PixelComparisonThresholds = MD1_STRICT_PIXEL_THRESHOLDS,
): Md1PixelComparison {
  assertPixelBuffer(reference, 'reference');
  assertPixelBuffer(candidate, 'candidate');
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Pixel dimensions differ: ${reference.width}x${reference.height} versus ${candidate.width}x${candidate.height}`,
    );
  }

  const pixelCount = reference.width * reference.height;
  const channelDeltas = new Uint8Array(reference.data.length);
  let changedPixelCount = 0;
  let absoluteDeltaSum = 0;
  let maxChannelDelta = 0;
  let referenceOpaquePixels = 0;
  let candidateOpaquePixels = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        clampByte(reference.data[offset + channel]) - clampByte(candidate.data[offset + channel]),
      );
      channelDeltas[offset + channel] = delta;
      absoluteDeltaSum += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > thresholds.channelTolerance) pixelChanged = true;
    }
    if (pixelChanged) changedPixelCount += 1;
    if (clampByte(reference.data[offset + 3]) > 0) referenceOpaquePixels += 1;
    if (clampByte(candidate.data[offset + 3]) > 0) candidateOpaquePixels += 1;
  }

  const changedPixelRatio = changedPixelCount / pixelCount;
  const meanAbsoluteChannelDelta = absoluteDeltaSum / channelDeltas.length;
  const p99ChannelDelta = percentile(channelDeltas, 0.99);
  const referenceAlphaCoverage = referenceOpaquePixels / pixelCount;
  const candidateAlphaCoverage = candidateOpaquePixels / pixelCount;
  const alphaCoverageDelta = Math.abs(referenceAlphaCoverage - candidateAlphaCoverage);
  const failures: string[] = [];

  if (changedPixelRatio > thresholds.maxChangedPixelRatio) {
    failures.push(`changedPixelRatio ${changedPixelRatio} exceeds ${thresholds.maxChangedPixelRatio}`);
  }
  if (meanAbsoluteChannelDelta > thresholds.maxMeanAbsoluteChannelDelta) {
    failures.push(`meanAbsoluteChannelDelta ${meanAbsoluteChannelDelta} exceeds ${thresholds.maxMeanAbsoluteChannelDelta}`);
  }
  if (p99ChannelDelta > thresholds.maxP99ChannelDelta) {
    failures.push(`p99ChannelDelta ${p99ChannelDelta} exceeds ${thresholds.maxP99ChannelDelta}`);
  }
  if (maxChannelDelta > thresholds.maxChannelDelta) {
    failures.push(`maxChannelDelta ${maxChannelDelta} exceeds ${thresholds.maxChannelDelta}`);
  }
  if (alphaCoverageDelta > thresholds.maxAlphaCoverageDelta) {
    failures.push(`alphaCoverageDelta ${alphaCoverageDelta} exceeds ${thresholds.maxAlphaCoverageDelta}`);
  }

  return {
    passed: failures.length === 0,
    width: reference.width,
    height: reference.height,
    pixelCount,
    changedPixelCount,
    changedPixelRatio,
    meanAbsoluteChannelDelta,
    p99ChannelDelta,
    maxChannelDelta,
    referenceAlphaCoverage,
    candidateAlphaCoverage,
    alphaCoverageDelta,
    failures,
  };
}

export function cropMd1PixelBuffer(
  source: Md1PixelBuffer,
  crop: Pick<Md1GoldenCrop, 'x' | 'y' | 'width' | 'height'>,
): Md1PixelBuffer {
  assertPixelBuffer(source, 'source');
  const x = Math.round(crop.x);
  const y = Math.round(crop.y);
  const width = Math.round(crop.width);
  const height = Math.round(crop.height);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > source.width || y + height > source.height) {
    throw new Error(`Crop ${x},${y},${width},${height} falls outside ${source.width}x${source.height}`);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((y + row) * source.width + x) * 4;
    const targetOffset = row * width * 4;
    for (let index = 0; index < width * 4; index += 1) {
      data[targetOffset + index] = clampByte(source.data[sourceOffset + index]);
    }
  }
  return { width, height, data };
}

export interface Md1PixelCoverage {
  readonly alphaCoverage: number;
  readonly nonBlackCoverage: number;
  readonly lumaRange: number;
}

export function measureMd1PixelCoverage(buffer: Md1PixelBuffer): Md1PixelCoverage {
  assertPixelBuffer(buffer, 'buffer');
  const pixelCount = buffer.width * buffer.height;
  let alphaPixels = 0;
  let nonBlackPixels = 0;
  let minLuma = 255;
  let maxLuma = 0;

  for (let offset = 0; offset < buffer.data.length; offset += 4) {
    const r = clampByte(buffer.data[offset]);
    const g = clampByte(buffer.data[offset + 1]);
    const b = clampByte(buffer.data[offset + 2]);
    const a = clampByte(buffer.data[offset + 3]);
    const luma = Math.round((r * 0.2126) + (g * 0.7152) + (b * 0.0722));
    if (a > 0) alphaPixels += 1;
    if (a > 0 && (r > 4 || g > 4 || b > 4)) nonBlackPixels += 1;
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
  }

  return {
    alphaCoverage: alphaPixels / pixelCount,
    nonBlackCoverage: nonBlackPixels / pixelCount,
    lumaRange: maxLuma - minLuma,
  };
}
