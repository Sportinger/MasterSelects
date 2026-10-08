import { describe, it, expect } from 'vitest';
import { authoredCurveLabelGlyphs } from '../../src/engine/native3d/labels/curveLabelTypography';

describe('authored word typography', () => {
  const rows = ['SCAN / 001', 'DIE QUALLE SCHWIMMT!', 'NOCH MEHR KUNST?', 'WERT: 100'];
  it('preserves characters and colors and fits emphasized words within the line', () => {
    const glyphs = authoredCurveLabelGlyphs(rows, 1, .9);
    rows.forEach((row, r) => [...row].forEach((char, c) => {
      const glyph = glyphs[r*20+c];
      expect(glyph % 1024).toBe(char.charCodeAt(0));
      expect(glyph & 1024).toBe(0);
      if (glyph & 0x80000000) {
        const center = ((glyph>>>14)&2047)/64, size=.75+((glyph>>>25)&63)/64;
        expect(center-size/2).toBeGreaterThanOrEqual(-1/64);
        expect(center+size/2).toBeLessThanOrEqual(20.1);
      }
    }));
    expect([...glyphs].some(glyph => (glyph & 8192) !== 0)).toBe(true);
    expect([...glyphs.slice(20,60)].some(glyph => (glyph & 2048) !== 0)).toBe(true);
  });
  it('does not alter numeric rows or add word layout when variation is off', () => {
    expect([...authoredCurveLabelGlyphs(rows, 1, 0)].some(glyph => (glyph & 0x80000000) !== 0)).toBe(false);
    expect([...authoredCurveLabelGlyphs(rows, 1, 1).slice(60)].some(glyph => (glyph & 0x80000000) !== 0)).toBe(false);
  });
});
