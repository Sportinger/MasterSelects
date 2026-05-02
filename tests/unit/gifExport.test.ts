import { describe, expect, it } from 'vitest';
import {
  CONTAINER_FORMATS,
  getCodecInfo,
  getCodecsForContainer,
} from '../../src/engine/ffmpeg';
import {
  clampGifAlphaThreshold,
  clampGifColors,
  estimateGifSize,
  formatByteSize,
} from '../../src/engine/gif/gifOptions';

describe('GIF export metadata', () => {
  it('exposes GIF as an FFmpeg container with the GIF codec', () => {
    expect(CONTAINER_FORMATS.some((format) => format.id === 'gif')).toBe(true);
    expect(getCodecsForContainer('gif').map((codec) => codec.id)).toEqual(['gif']);
  });

  it('marks animated GIF as palette delivery with alpha support and no 10-bit support', () => {
    const codec = getCodecInfo('gif');
    expect(codec?.category).toBe('delivery');
    expect(codec?.supportsAlpha).toBe(true);
    expect(codec?.supports10bit).toBe(false);
    expect(codec?.defaultPixelFormat).toBe('pal8');
  });
});

describe('GIF size estimation', () => {
  const base = {
    width: 640,
    height: 360,
    fps: 15,
    durationSeconds: 4,
    gifColors: 256,
    gifDither: 'sierra2_4a' as const,
    gifLoop: 'forever' as const,
    gifPaletteMode: 'global' as const,
    gifOptimize: true,
    gifAlphaThreshold: 128,
  };

  it('scales with frame count and resolution', () => {
    const small = estimateGifSize(base);
    const large = estimateGifSize({ ...base, width: 1280, height: 720 });
    const longer = estimateGifSize({ ...base, durationSeconds: 8 });

    expect(large.bytes).toBeGreaterThan(small.bytes * 3);
    expect(longer.bytes).toBeGreaterThan(small.bytes * 1.9);
  });

  it('accounts for color count, dither, palette mode, and optimization', () => {
    const optimized = estimateGifSize(base);
    const fewerColors = estimateGifSize({ ...base, gifColors: 64 });
    const noDither = estimateGifSize({ ...base, gifDither: 'none' });
    const perFrame = estimateGifSize({ ...base, gifPaletteMode: 'per-frame' });
    const unoptimized = estimateGifSize({ ...base, gifOptimize: false });

    expect(fewerColors.bytes).toBeLessThan(optimized.bytes);
    expect(noDither.bytes).toBeLessThan(optimized.bytes);
    expect(perFrame.bytes).toBeGreaterThan(optimized.bytes);
    expect(unoptimized.bytes).toBeGreaterThan(optimized.bytes);
  });

  it('returns a bounded content-dependent range around the estimate', () => {
    const estimate = estimateGifSize(base);

    expect(estimate.minBytes).toBeLessThan(estimate.bytes);
    expect(estimate.maxBytes).toBeGreaterThan(estimate.bytes);
    expect(formatByteSize(estimate.bytes)).toMatch(/MB|KB/);
  });

  it('clamps professional GIF controls to valid GIF ranges', () => {
    expect(clampGifColors(999)).toBe(256);
    expect(clampGifColors(-20)).toBe(2);
    expect(clampGifAlphaThreshold(999)).toBe(255);
    expect(clampGifAlphaThreshold(-5)).toBe(0);
  });
});
