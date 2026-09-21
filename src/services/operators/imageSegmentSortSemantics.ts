import { roundImageScalarEven } from './imageRoundingSemantics';

export type ImageSegmentRgba = readonly [number, number, number, number];
export type ImageSegmentPixel = readonly [number, number];

export interface ImageSegmentSortResult {
  readonly color: ImageSegmentRgba;
  readonly records: readonly ImageSegmentRgba[];
  readonly segmentSize: number;
  readonly segmentStart: number;
  readonly outputIndex: number;
}

/** WGSL round uses nearest-even ties, unlike JavaScript Math.round.
 * https://www.w3.org/TR/WGSL/#round-builtin */
export function roundImageSegmentScale(value: number): number {
  return roundImageScalarEven(value);
}

export function imageSegmentSize(scale: number): number {
  return Math.max(4, Math.min(16, roundImageSegmentScale(scale)));
}

export function imageSegmentLuminance(color: ImageSegmentRgba): number {
  return color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
}

/** Mirrors the bounded legacy compute loop: sixteen stable records are always sorted,
 * with the last real segment sample duplicated when the selected segment is shorter. */
export function sortImageSegment(options: {
  pixel: ImageSegmentPixel;
  resolution: ImageSegmentPixel;
  scale: number;
  loadPixel: (pixel: ImageSegmentPixel) => ImageSegmentRgba;
}): ImageSegmentSortResult {
  const [width, height] = options.resolution, [x, y] = options.pixel;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Pixel-sort resolution must contain positive integers.');
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error('Pixel-sort pixel must be an in-bounds integer coordinate.');
  }
  const segmentSize = imageSegmentSize(options.scale);
  const segmentStart = x - x % segmentSize;
  const loadClamped = (sampleX: number): ImageSegmentRgba => options.loadPixel([
    Math.max(0, Math.min(width - 1, sampleX)),
    Math.max(0, Math.min(height - 1, y)),
  ]);
  const records: ImageSegmentRgba[] = Array.from({ length: 16 }, (_, index) =>
    loadClamped(segmentStart + Math.min(index, segmentSize - 1)));
  for (let outer = 0; outer < 16; outer++) for (let inner = 0; inner < 15 - outer; inner++) {
    if (imageSegmentLuminance(records[inner]) > imageSegmentLuminance(records[inner + 1])) {
      const swap = records[inner]; records[inner] = records[inner + 1]; records[inner + 1] = swap;
    }
  }
  const outputIndex = Math.min(15, x - segmentStart);
  return { color: records[outputIndex], records, segmentSize, segmentStart, outputIndex };
}
