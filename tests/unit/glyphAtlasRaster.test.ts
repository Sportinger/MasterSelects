import { afterEach, describe, expect, it, vi } from 'vitest';
import { rasterizeGlyphAtlas } from '../../src/effects/_shared/glyphAtlasRaster';

const context = () => ({
  clearRect: vi.fn(), measureText: vi.fn(() => ({ width: 10 })), save: vi.fn(), translate: vi.fn(), scale: vi.fn(), fillText: vi.fn(), restore: vi.fn(),
  fillStyle: '', font: '', textAlign: '', textBaseline: '',
});

afterEach(() => vi.unstubAllGlobals());

describe('glyph atlas raster portability', () => {
  it('prefers the main-thread document canvas and preserves the canonical plan', () => {
    const drawing = context(), canvas = { width: 0, height: 0, getContext: vi.fn(() => drawing) };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal('document', { createElement });
    const result = rasterizeGlyphAtlas({ fontFamily: 'mono', fontWeight: 700, charset: 'ab', cellSize: 16 });
    expect(result.canvas).toBe(canvas);
    expect(result.plan.glyphs).toEqual(['a', 'b']);
    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(drawing.font).toBe('700 12px mono');
    expect(drawing.fillText).toHaveBeenCalledTimes(2);
  });

  it('uses OffscreenCanvas when no document exists', () => {
    const drawing = context(), instances: unknown[] = [];
    class MockOffscreenCanvas {
      width: number; height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; instances.push(this); }
      getContext() { return drawing; }
    }
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    const result = rasterizeGlyphAtlas({ fontFamily: 'mono', charset: '#', cellSize: 20 });
    expect(result.canvas).toBe(instances[0]);
    expect(drawing.translate).toHaveBeenCalledWith(10, 10);
    expect(drawing.fillText).toHaveBeenCalledWith('#', 0, 0);
  });

  it('fails explicitly without a canvas or a 2D context', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(() => rasterizeGlyphAtlas({ fontFamily: 'mono', charset: '#', cellSize: 20 })).toThrow(/HTMLCanvasElement or OffscreenCanvas/);
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    expect(() => rasterizeGlyphAtlas({ fontFamily: 'mono', charset: '#', cellSize: 20 })).toThrow(/2D canvas is unavailable/);
  });
});
