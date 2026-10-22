import { describe, expect, it } from 'vitest';
import { buildCellGridFromPixels } from '../../src/effects/_shared/cellGrid';
import { planGlyphAtlas } from '../../src/effects/_shared/glyphAtlas';
import { ASCII_RAMP_MAX_CHARACTERS, ASCII_RAMP_PRESETS, asciiRampWarnings, resolveAsciiRamp } from '../../src/effects/_shared/asciiRamps';

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
    expect(resolveAsciiRamp('missing')).toBe(ASCII_RAMP_PRESETS.standard);
    expect(asciiRampWarnings('missing', '')).toEqual(['Ramp "missing" is unknown; the Standard ramp is drawn.']);
  });

  it('draws a one-character Custom Ramp instead of ignoring it, and ignores only trailing spaces', () => {
    expect(resolveAsciiRamp('standard', '●')).toBe('●');
    expect(resolveAsciiRamp('binary', '#  ')).toBe('#');
    expect(resolveAsciiRamp('binary', '   ')).toBe(' 01');
    expect(asciiRampWarnings('standard', '●')).toEqual([]);
  });

  it('keeps at most 256 characters of a long Custom Ramp, spread from its first to its last, and says so', () => {
    const long = Array.from({ length: 1000 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
    const ramp = Array.from(resolveAsciiRamp('standard', long));
    expect(ramp).toHaveLength(ASCII_RAMP_MAX_CHARACTERS);
    expect(ramp[0]).toBe(long[0]);
    expect(ramp.at(-1)).toBe(Array.from(long).at(-1));
    expect(new Set(ramp).size).toBe(ASCII_RAMP_MAX_CHARACTERS);
    expect(Array.from(resolveAsciiRamp('standard', long.slice(0, 256)))).toHaveLength(256);
    expect(asciiRampWarnings('standard', long)).toEqual(['Custom Ramp has 1000 characters; 256 of them are drawn, spread evenly from the first to the last.']);
    expect(asciiRampWarnings('standard', long.slice(0, 256))).toEqual([]);
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
