export interface FrameFingerprintOptions {
  sampleWidth?: number;
  sampleHeight?: number;
  blankLumaThreshold?: number;
  blankAlphaThreshold?: number;
}

export interface FrameFingerprint {
  sourceWidth: number;
  sourceHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  pixelCount: number;
  hash: string;
  nonBlankRatio: number;
  alphaCoverage: number;
  avgRgb: {
    r: number;
    g: number;
    b: number;
  };
  meanLuma: number;
  colorRange: {
    r: number;
    g: number;
    b: number;
    luma: number;
  };
}

export interface FrameFingerprintComparisonThresholds {
  maxAvgRgbDelta?: number;
  maxMeanLumaDelta?: number;
  maxNonBlankRatioDelta?: number;
  minReferenceNonBlankRatio?: number;
  minCandidateNonBlankRatio?: number;
  maxColorRangeDelta?: number;
}

export interface FrameFingerprintComparison {
  passed: boolean;
  failures: string[];
  avgRgbDelta: number;
  meanLumaDelta: number;
  nonBlankRatioDelta: number;
  colorRangeDelta: number;
  thresholds: Required<FrameFingerprintComparisonThresholds>;
}

export interface RgbaPixelBuffer {
  data: Uint8ClampedArray | Uint8Array | readonly number[];
  width: number;
  height: number;
}

const DEFAULT_SAMPLE_SIZE = 16;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function lumaFor(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function updateFnv(hash: number, value: number): number {
  let next = hash ^ (value & 0xff);
  next = Math.imul(next, 16777619);
  return next >>> 0;
}

function resolveSampleDimensions(
  width: number,
  height: number,
  options: FrameFingerprintOptions,
): { sampleWidth: number; sampleHeight: number } {
  return {
    sampleWidth: clampInteger(options.sampleWidth, Math.min(DEFAULT_SAMPLE_SIZE, width), 1, Math.max(1, width)),
    sampleHeight: clampInteger(options.sampleHeight, Math.min(DEFAULT_SAMPLE_SIZE, height), 1, Math.max(1, height)),
  };
}

export function fingerprintRgbaPixels(
  pixels: RgbaPixelBuffer,
  options: FrameFingerprintOptions = {},
): FrameFingerprint {
  const width = clampInteger(pixels.width, 1, 1, Number.MAX_SAFE_INTEGER);
  const height = clampInteger(pixels.height, 1, 1, Number.MAX_SAFE_INTEGER);
  const expectedLength = width * height * 4;
  if (pixels.data.length < expectedLength) {
    throw new Error(`RGBA pixel buffer too small: ${pixels.data.length}/${expectedLength}`);
  }

  const { sampleWidth, sampleHeight } = resolveSampleDimensions(width, height, options);
  const blankLumaThreshold = typeof options.blankLumaThreshold === 'number'
    ? options.blankLumaThreshold
    : 4;
  const blankAlphaThreshold = typeof options.blankAlphaThreshold === 'number'
    ? options.blankAlphaThreshold
    : 8;
  const pixelCount = sampleWidth * sampleHeight;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let sumLuma = 0;
  let nonBlankCount = 0;
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let minLuma = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let maxLuma = 0;
  let hash = 2166136261;

  for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
    const sourceY = Math.min(height - 1, Math.floor((sampleY + 0.5) * height / sampleHeight));
    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      const sourceX = Math.min(width - 1, Math.floor((sampleX + 0.5) * width / sampleWidth));
      const offset = (sourceY * width + sourceX) * 4;
      const r = pixels.data[offset] ?? 0;
      const g = pixels.data[offset + 1] ?? 0;
      const b = pixels.data[offset + 2] ?? 0;
      const a = pixels.data[offset + 3] ?? 255;
      const luma = lumaFor(r, g, b);
      const quantizedR = r >> 3;
      const quantizedG = g >> 3;
      const quantizedB = b >> 3;

      sumR += r;
      sumG += g;
      sumB += b;
      sumA += a;
      sumLuma += luma;
      if (a > blankAlphaThreshold && luma > blankLumaThreshold) {
        nonBlankCount += 1;
      }
      minR = Math.min(minR, r);
      minG = Math.min(minG, g);
      minB = Math.min(minB, b);
      minLuma = Math.min(minLuma, luma);
      maxR = Math.max(maxR, r);
      maxG = Math.max(maxG, g);
      maxB = Math.max(maxB, b);
      maxLuma = Math.max(maxLuma, luma);

      hash = updateFnv(hash, quantizedR);
      hash = updateFnv(hash, quantizedG);
      hash = updateFnv(hash, quantizedB);
      hash = updateFnv(hash, a >> 4);
    }
  }

  return {
    sourceWidth: width,
    sourceHeight: height,
    sampleWidth,
    sampleHeight,
    pixelCount,
    hash: hash.toString(16).padStart(8, '0'),
    nonBlankRatio: round(nonBlankCount / pixelCount),
    alphaCoverage: round(sumA / (pixelCount * 255)),
    avgRgb: {
      r: round(sumR / pixelCount),
      g: round(sumG / pixelCount),
      b: round(sumB / pixelCount),
    },
    meanLuma: round(sumLuma / pixelCount),
    colorRange: {
      r: round(maxR - minR),
      g: round(maxG - minG),
      b: round(maxB - minB),
      luma: round(maxLuma - minLuma),
    },
  };
}

export function compareFrameFingerprints(
  reference: FrameFingerprint,
  candidate: FrameFingerprint,
  thresholds: FrameFingerprintComparisonThresholds = {},
): FrameFingerprintComparison {
  const resolved: Required<FrameFingerprintComparisonThresholds> = {
    maxAvgRgbDelta: thresholds.maxAvgRgbDelta ?? 42,
    maxMeanLumaDelta: thresholds.maxMeanLumaDelta ?? 32,
    maxNonBlankRatioDelta: thresholds.maxNonBlankRatioDelta ?? 0.45,
    minReferenceNonBlankRatio: thresholds.minReferenceNonBlankRatio ?? 0.05,
    minCandidateNonBlankRatio: thresholds.minCandidateNonBlankRatio ?? 0.05,
    maxColorRangeDelta: thresholds.maxColorRangeDelta ?? 120,
  };
  const avgRgbDelta = round((
    Math.abs(reference.avgRgb.r - candidate.avgRgb.r) +
    Math.abs(reference.avgRgb.g - candidate.avgRgb.g) +
    Math.abs(reference.avgRgb.b - candidate.avgRgb.b)
  ) / 3);
  const meanLumaDelta = round(Math.abs(reference.meanLuma - candidate.meanLuma));
  const nonBlankRatioDelta = round(Math.abs(reference.nonBlankRatio - candidate.nonBlankRatio));
  const colorRangeDelta = round((
    Math.abs(reference.colorRange.r - candidate.colorRange.r) +
    Math.abs(reference.colorRange.g - candidate.colorRange.g) +
    Math.abs(reference.colorRange.b - candidate.colorRange.b) +
    Math.abs(reference.colorRange.luma - candidate.colorRange.luma)
  ) / 4);
  const failures: string[] = [];

  if (reference.nonBlankRatio < resolved.minReferenceNonBlankRatio) {
    failures.push(`reference nonBlankRatio ${reference.nonBlankRatio}/${resolved.minReferenceNonBlankRatio}`);
  }
  if (candidate.nonBlankRatio < resolved.minCandidateNonBlankRatio) {
    failures.push(`candidate nonBlankRatio ${candidate.nonBlankRatio}/${resolved.minCandidateNonBlankRatio}`);
  }
  if (avgRgbDelta > resolved.maxAvgRgbDelta) {
    failures.push(`avgRgbDelta ${avgRgbDelta}/${resolved.maxAvgRgbDelta}`);
  }
  if (meanLumaDelta > resolved.maxMeanLumaDelta) {
    failures.push(`meanLumaDelta ${meanLumaDelta}/${resolved.maxMeanLumaDelta}`);
  }
  if (nonBlankRatioDelta > resolved.maxNonBlankRatioDelta) {
    failures.push(`nonBlankRatioDelta ${nonBlankRatioDelta}/${resolved.maxNonBlankRatioDelta}`);
  }
  if (colorRangeDelta > resolved.maxColorRangeDelta) {
    failures.push(`colorRangeDelta ${colorRangeDelta}/${resolved.maxColorRangeDelta}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    avgRgbDelta,
    meanLumaDelta,
    nonBlankRatioDelta,
    colorRangeDelta,
    thresholds: resolved,
  };
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Could not create 2D canvas context for frame fingerprint');
  }
  return context;
}

function fingerprintDrawable(
  drawable: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: FrameFingerprintOptions = {},
): FrameFingerprint {
  const { sampleWidth, sampleHeight } = resolveSampleDimensions(sourceWidth, sourceHeight, options);
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = getCanvasContext(canvas);
  context.drawImage(drawable, 0, 0, sourceWidth, sourceHeight, 0, 0, sampleWidth, sampleHeight);
  const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight);
  return fingerprintRgbaPixels({
    data: imageData.data,
    width: sampleWidth,
    height: sampleHeight,
  }, {
    ...options,
    sampleWidth,
    sampleHeight,
  });
}

export function fingerprintCanvas(
  canvas: HTMLCanvasElement,
  options: FrameFingerprintOptions = {},
): FrameFingerprint {
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('Cannot fingerprint an empty canvas');
  }
  return fingerprintDrawable(canvas, canvas.width, canvas.height, options);
}

export function fingerprintImageBitmap(
  bitmap: ImageBitmap,
  options: FrameFingerprintOptions = {},
): FrameFingerprint {
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('Cannot fingerprint an empty ImageBitmap');
  }
  return fingerprintDrawable(bitmap, bitmap.width, bitmap.height, options);
}

export async function fingerprintDataUrl(
  dataUrl: string,
  options: FrameFingerprintOptions = {},
): Promise<FrameFingerprint> {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('Expected a data URL for frame fingerprint');
  }

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not decode frame data URL'));
    image.src = dataUrl;
  });

  if (typeof image.decode === 'function') {
    await image.decode().catch(() => undefined);
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) {
    throw new Error('Decoded frame data URL has no dimensions');
  }
  return fingerprintDrawable(image, width, height, options);
}
