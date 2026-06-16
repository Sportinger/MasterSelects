import type { FrameFingerprint, FrameFingerprintOptions, RgbaPixelBuffer } from './frameFingerprint';

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function round(value: number): number {
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

export function fingerprintRgbaPixels(
  pixels: RgbaPixelBuffer,
  options: FrameFingerprintOptions = {},
): FrameFingerprint {
  const width = clampInteger(pixels.width, 1, 1, Number.MAX_SAFE_INTEGER);
  const height = clampInteger(pixels.height, 1, 1, Number.MAX_SAFE_INTEGER);
  const sampleWidth = clampInteger(options.sampleWidth, Math.min(16, width), 1, Math.max(1, width));
  const sampleHeight = clampInteger(options.sampleHeight, Math.min(16, height), 1, Math.max(1, height));
  const blankLumaThreshold = typeof options.blankLumaThreshold === 'number' ? options.blankLumaThreshold : 4;
  const blankAlphaThreshold = typeof options.blankAlphaThreshold === 'number' ? options.blankAlphaThreshold : 8;
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

      hash = updateFnv(hash, r >> 3);
      hash = updateFnv(hash, g >> 3);
      hash = updateFnv(hash, b >> 3);
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
