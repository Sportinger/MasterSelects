export interface GlyphAtlasOptions {
  fontFamily: string;
  charset: string;
  cellSize: number;
  fontWeight?: number;
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
  ]);
}
