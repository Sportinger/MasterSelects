import { describe, expect, it } from 'vitest';
import {
  mapOverlayCropToSource,
  normalizeCaptureCrop,
  resolveCaptureOutputSize,
} from '../recording/frameTransform';

describe('capture frame transform math', () => {
  it('normalizes odd crop rectangles to clamped chroma-aligned values', () => {
    expect(normalizeCaptureCrop({ x: 11, y: 7, width: 999, height: 999 }, { width: 640, height: 480 })).toEqual({
      x: 10,
      y: 6,
      width: 630,
      height: 474,
    });
  });

  it('maps a crop through object-contain letterboxing', () => {
    expect(mapOverlayCropToSource(
      { x: 100, y: 100, width: 200, height: 100 },
      { width: 400, height: 400 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 480, y: 60, width: 960, height: 480 });
  });

  it('scales to an even 1080p-bounded output', () => {
    expect(resolveCaptureOutputSize({ width: 3840, height: 2160 }, '1080p')).toEqual({ width: 1920, height: 1080 });
  });
});
