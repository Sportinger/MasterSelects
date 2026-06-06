import { describe, expect, it } from 'vitest';
import {
  compareFrameFingerprints,
  fingerprintRgbaPixels,
} from '../../src/services/aiTools/frameFingerprint';

function solidPixels(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = rgba[0];
    pixels[offset + 1] = rgba[1];
    pixels[offset + 2] = rgba[2];
    pixels[offset + 3] = rgba[3];
  }
  return pixels;
}

describe('frameFingerprint', () => {
  it('builds a stable compact fingerprint from RGBA pixels', () => {
    const fingerprint = fingerprintRgbaPixels({
      data: solidPixels(4, 4, [80, 120, 160, 255]),
      width: 4,
      height: 4,
    }, {
      sampleWidth: 2,
      sampleHeight: 2,
    });

    expect(fingerprint).toMatchObject({
      sourceWidth: 4,
      sourceHeight: 4,
      sampleWidth: 2,
      sampleHeight: 2,
      pixelCount: 4,
      nonBlankRatio: 1,
      alphaCoverage: 1,
      avgRgb: { r: 80, g: 120, b: 160 },
      colorRange: { r: 0, g: 0, b: 0, luma: 0 },
    });
    expect(fingerprint.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('detects blank frames separately from alpha coverage', () => {
    const fingerprint = fingerprintRgbaPixels({
      data: solidPixels(8, 8, [0, 0, 0, 255]),
      width: 8,
      height: 8,
    });

    expect(fingerprint.alphaCoverage).toBe(1);
    expect(fingerprint.nonBlankRatio).toBe(0);
    expect(fingerprint.meanLuma).toBe(0);
  });

  it('compares similar fingerprints within thresholds', () => {
    const reference = fingerprintRgbaPixels({
      data: solidPixels(4, 4, [80, 120, 160, 255]),
      width: 4,
      height: 4,
    });
    const candidate = fingerprintRgbaPixels({
      data: solidPixels(4, 4, [82, 118, 158, 255]),
      width: 4,
      height: 4,
    });

    const comparison = compareFrameFingerprints(reference, candidate, {
      maxAvgRgbDelta: 4,
      maxMeanLumaDelta: 4,
    });

    expect(comparison.passed).toBe(true);
    expect(comparison.failures).toEqual([]);
    expect(comparison.avgRgbDelta).toBeLessThanOrEqual(4);
    expect(comparison.meanLumaDelta).toBeLessThanOrEqual(4);
  });

  it('reports concrete failures for mismatched or blank candidates', () => {
    const reference = fingerprintRgbaPixels({
      data: solidPixels(4, 4, [210, 120, 80, 255]),
      width: 4,
      height: 4,
    });
    const candidate = fingerprintRgbaPixels({
      data: solidPixels(4, 4, [0, 0, 0, 255]),
      width: 4,
      height: 4,
    });

    const comparison = compareFrameFingerprints(reference, candidate, {
      maxAvgRgbDelta: 10,
      maxMeanLumaDelta: 10,
      minCandidateNonBlankRatio: 0.25,
    });

    expect(comparison.passed).toBe(false);
    expect(comparison.failures).toEqual(expect.arrayContaining([
      'candidate nonBlankRatio 0/0.25',
      expect.stringMatching(/^avgRgbDelta /),
      expect.stringMatching(/^meanLumaDelta /),
    ]));
  });
});
