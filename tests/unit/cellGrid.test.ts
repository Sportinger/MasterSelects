import { describe, expect, it } from 'vitest';
import { buildCellGridFromPixels } from '../../src/effects/_shared/cellGrid';
import { planGlyphAtlas } from '../../src/effects/_shared/glyphAtlas';
import { resolveAsciiRamp } from '../../src/effects/_shared/asciiRamps';

describe('glyph and cell grid foundation', () => {
  it('plans a compact square atlas without losing unicode glyphs', () => {
    const plan = planGlyphAtlas({ fontFamily: 'monospace', charset: ' A█🙂', cellSize: 32 });
    expect(plan.glyphs).toEqual([' ', 'A', '█', '🙂']);
    expect(plan.columns).toBe(2);
    expect(plan.width).toBe(64);
  });

  it('prefers a valid custom ramp and falls back to named ramps', () => {
    expect(resolveAsciiRamp('binary')).toBe(' 01');
    expect(resolveAsciiRamp('missing', ' .#')).toBe(' .#');
  });

  it('builds text and per-cell color data from an RGBA readback buffer', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 0, 0, 255, 0, 255, 0, 128,
    ]);
    const grid = buildCellGridFromPixels(pixels, 2, 2, { columns: 2, cellAspectRatio: 1, customRamp: ' .#' });
    expect(grid.columns).toBe(2);
    expect(grid.cells[0][0]).toMatchObject({ char: ' ', color: '#000000', alpha: 1 });
    expect(grid.text).toContain('#');
  });
});
