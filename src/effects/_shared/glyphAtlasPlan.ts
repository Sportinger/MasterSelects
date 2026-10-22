export interface GlyphAtlasOptions {
  fontFamily: string;
  charset: string;
  cellSize: number;
  fontWeight?: number;
  /**
   * Draw the characters to fill the cell: one font size for the whole ramp, so its tallest character
   * spans GLYPH_ATLAS_FILL of the tile height. Without it (glyph graphs saved before 2026-10-22) the
   * font is 0.76 × the tile and most characters cover only about half of it.
   */
  fill?: boolean;
}

export interface GlyphAtlasPlan {
  glyphs: string[];
  columns: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
}

export function planGlyphAtlas(options: GlyphAtlasOptions): GlyphAtlasPlan {
  const glyphs = Array.from(options.charset || ' ');
  const cellSize = Math.max(8, Math.min(128, Math.round(options.cellSize)));
  const columns = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
  const rows = Math.max(1, Math.ceil(glyphs.length / columns));
  return { glyphs, columns, rows, cellSize, width: columns * cellSize, height: rows * cellSize };
}

export function glyphAtlasCacheKey(options: GlyphAtlasOptions): string {
  return JSON.stringify([
    options.fontFamily,
    options.fontWeight ?? 600,
    options.charset,
    Math.max(8, Math.min(128, Math.round(options.cellSize))),
    ...(options.fill ? ['fill'] : []),
  ]);
}
