import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockElementRects } from '../../src/effects/_shared/blockElementGlyphs';
import { rasterizeGlyphAtlas } from '../../src/effects/_shared/glyphAtlasRaster';

const context = () => ({
  clearRect: vi.fn(), measureText: vi.fn(() => ({ width: 10 })), save: vi.fn(), translate: vi.fn(), scale: vi.fn(), fillText: vi.fn(), restore: vi.fn(),
  fillRect: vi.fn(),
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

  it('draws Block Elements as shapes that fill the whole tile, every other character from the font', () => {
    const drawing = context(), canvas = { width: 0, height: 0, getContext: vi.fn(() => drawing) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    // Two columns of 16 px tiles: ' ' and '█' in the first row, '▄' and '░' in the second.
    rasterizeGlyphAtlas({ fontFamily: 'mono', charset: ' █▄░', cellSize: 16 });
    expect(drawing.fillText).toHaveBeenCalledTimes(1);
    expect(drawing.fillRect).toHaveBeenCalledWith(16, 0, 16, 16);
    expect(drawing.fillRect).toHaveBeenCalledWith(0, 24, 16, 8);
    const shadeRects = drawing.fillRect.mock.calls.filter(([x, y]) => x >= 16 && y >= 16);
    expect(shadeRects).toHaveLength(4);
    for (const [, , width, height] of shadeRects) expect([width, height]).toEqual([4, 4]);
  });
});

describe('block element shapes', () => {
  const coverage = (glyph: string) => (blockElementRects(glyph) ?? []).reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);

  it('covers every character of the Unicode Block Elements range and nothing else', () => {
    for (let code = 0x2580; code <= 0x259f; code += 1) expect(blockElementRects(String.fromCodePoint(code)), code.toString(16)).toBeDefined();
    for (const glyph of ['A', '#', ' ', '●', '■']) expect(blockElementRects(glyph)).toBeUndefined();
  });

  it('fills the share of the tile its name says: shades a quarter, half and three quarters, eighth bars in eighths', () => {
    expect([coverage('░'), coverage('▒'), coverage('▓'), coverage('█')]).toEqual([0.25, 0.5, 0.75, 1]);
    expect(['▁', '▂', '▃', '▄', '▅', '▆', '▇'].map(coverage)).toEqual([1, 2, 3, 4, 5, 6, 7].map(eighths => eighths / 8));
    expect(blockElementRects('▄')).toEqual([[0, 0.5, 1, 1]]);
    expect(coverage('▚')).toBe(0.5);
    for (let code = 0x2580; code <= 0x259f; code += 1) {
      for (const [x0, y0, x1, y1] of blockElementRects(String.fromCodePoint(code))!) {
        expect(x0).toBeGreaterThanOrEqual(0); expect(y0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(1); expect(y1).toBeLessThanOrEqual(1);
        expect(x1).toBeGreaterThan(x0); expect(y1).toBeGreaterThan(y0);
      }
    }
  });
});
