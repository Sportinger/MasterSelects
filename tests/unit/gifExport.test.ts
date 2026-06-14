import { describe, expect, it } from 'vitest';
import {
  checkBrowserGifExportSize,
  encodeBrowserGif,
  encodeBrowserGifBytes,
  isBrowserGifPaletteMode,
} from '../../src/engine/export/BrowserGifExporter';
import {
  CONTAINER_FORMATS,
  getCodecInfo,
  getCodecsForContainer,
} from '../../src/engine/ffmpeg';
import { buildEncodeArgs } from '../../src/engine/ffmpeg/bridge/ffmpegEncodeArgs';
import {
  clampGifAlphaThreshold,
  clampGifBayerScale,
  clampGifColors,
  clampGifLoopCount,
  estimateGifSize,
  formatByteSize,
  getGifRepeatCount,
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
    gifLoopCount: 3,
    gifPaletteMode: 'global' as const,
    gifOptimize: true,
    gifTransparency: true,
    gifAlphaThreshold: 128,
    gifBayerScale: 3,
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
    expect(clampGifLoopCount(1)).toBe(2);
    expect(clampGifLoopCount(120)).toBe(99);
    expect(clampGifBayerScale(-1)).toBe(0);
    expect(clampGifBayerScale(8)).toBe(5);
  });

  it('maps GIF loop controls to encoder repeat counts', () => {
    expect(getGifRepeatCount('forever', 3)).toBe(0);
    expect(getGifRepeatCount('once', 3)).toBe(-1);
    expect(getGifRepeatCount('count', 7)).toBe(7);
  });

  it('builds FFmpeg GIF arguments for loop count, opaque output, and Bayer scale', () => {
    const args = buildEncodeArgs({
      codec: 'gif',
      container: 'gif',
      width: 320,
      height: 180,
      fps: 12,
      startTime: 0,
      endTime: 2,
      gifColors: 32,
      gifDither: 'bayer',
      gifLoop: 'count',
      gifLoopCount: 4,
      gifPaletteMode: 'per-frame',
      gifOptimize: true,
      gifTransparency: false,
      gifAlphaThreshold: 100,
      gifBayerScale: 5,
    }, 24, null);

    expect(args).toContain('-loop');
    expect(args[args.indexOf('-loop') + 1]).toBe('4');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('format=rgb24');
    expect(filter).toContain('max_colors=32');
    expect(filter).toContain('stats_mode=single');
    expect(filter).toContain('dither=bayer');
    expect(filter).toContain('bayer_scale=5');
    expect(filter).not.toContain('alpha_threshold=');
  });
});

describe('Browser GIF encoder', () => {
  const settings = {
    width: 2,
    height: 2,
    fps: 10,
    gifColors: 256,
    gifDither: 'none' as const,
    gifLoop: 'forever' as const,
    gifLoopCount: 3,
    gifPaletteMode: 'global' as const,
    gifOptimize: true,
    gifTransparency: true,
    gifAlphaThreshold: 128,
    gifBayerScale: 3,
  };

  it('encodes a small transparent browser GIF blob', () => {
    const frame = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      0, 0, 0, 0,
    ]);

    const bytes = encodeBrowserGifBytes([frame], settings);
    const blob = encodeBrowserGif([frame], settings);
    const header = new TextDecoder('ascii').decode(bytes.slice(0, 6));

    expect(blob.type).toBe('image/gif');
    expect(blob.size).toBe(bytes.byteLength);
    expect(header).toBe('GIF89a');
  });

  it('rejects browser GIF settings that would require oversized browser buffers', () => {
    const preflight = checkBrowserGifExportSize({
      ...settings,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 20,
    });

    expect(preflight.ok).toBe(false);
    expect(preflight.message).toContain('Browser GIF is too large');
    expect(preflight.message).toContain('Use FFmpeg GIF');
  });

  it('accepts short browser GIF preview settings', () => {
    const preflight = checkBrowserGifExportSize({
      ...settings,
      width: 640,
      height: 360,
      fps: 15,
      durationSeconds: 4,
    });

    expect(preflight.ok).toBe(true);
    expect(preflight.frameCount).toBe(60);
  });

  it('recognizes only supported browser GIF palette modes', () => {
    expect(isBrowserGifPaletteMode('global')).toBe(true);
    expect(isBrowserGifPaletteMode('per-frame')).toBe(true);
    expect(isBrowserGifPaletteMode('scene')).toBe(false);
  });
});
