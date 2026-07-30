import { describe, expect, it } from 'vitest';
import {
  calculateFitToFrameScale,
  calculateSourcePixelScale,
} from '../../src/utils/sourcePixelScale';

describe('source pixel scale', () => {
  it('makes 100 percent equal native pixels for larger sources', () => {
    expect(calculateSourcePixelScale(3840, 2160, 1920, 1080)).toBe(2);
    expect(calculateFitToFrameScale(3840, 2160, 1920, 1080)).toBe(0.5);
  });

  it('lets Fit enlarge a smaller source without changing its aspect ratio', () => {
    expect(calculateSourcePixelScale(1280, 720, 1920, 1080)).toBeCloseTo(2 / 3);
    expect(calculateFitToFrameScale(1280, 720, 1920, 1080)).toBeCloseTo(1.5);
  });

  it('uses the limiting axis for sources with a different aspect ratio', () => {
    expect(calculateSourcePixelScale(3840, 1080, 1920, 1080)).toBe(2);
    expect(calculateFitToFrameScale(3840, 1080, 1920, 1080)).toBe(0.5);

    expect(calculateSourcePixelScale(1080, 1920, 1920, 1080)).toBeCloseTo(1920 / 1080);
    expect(calculateFitToFrameScale(1080, 1920, 1920, 1080)).toBeCloseTo(1080 / 1920);
  });

  it('falls back to identity when dimensions are unavailable', () => {
    expect(calculateSourcePixelScale(0, 1080, 1920, 1080)).toBe(1);
    expect(calculateFitToFrameScale(Number.NaN, 1080, 1920, 1080)).toBe(1);
  });
});
