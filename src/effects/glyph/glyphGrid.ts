// The glyph engine's cell grid and clock, shared by the effect definitions (glyphEffectFactory.ts) and
// the runtime graph (src/services/operators/asciiEffectGraph.ts). Cell Size counts pixels of a 1080p
// frame (shorter side), so preview qualities, thumbnails and exports show the same characters
// relative to the picture.

/** Frame height Cell Size is measured on: a 4K or 720p frame shows the same characters as 1080p. */
export const GLYPH_REFERENCE_HEIGHT = 1080;
/** Smallest cell the engine renders, in output pixels (Cell Size is clamped to it as well). */
export const GLYPH_MIN_CELL_PIXELS = 2;
/** Runtime-only param: Speed × seconds travelled under a keyframed Speed curve (EffectParam.integratedAs). */
export const GLYPH_SPEED_TRAVEL = 'speedTravel';
/**
 * What the graph reads for Speed Travel while Speed has no keyframes: then it moves by timeline time × Speed.
 * Below 1e21 in magnitude, so the WGSL emitter writes it as a plain decimal literal.
 */
export const GLYPH_NO_TRAVEL = -1e20;

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Rendered cell in output pixels: Cell Size (at least 2) × shorter side / 1080, at least 2 pixels. */
export function glyphCellPixels(cellSize: number, width: number, height: number): number {
  const shortSide = Math.min(width, height);
  const scale = shortSide > 0 ? shortSide / GLYPH_REFERENCE_HEIGHT : 1;
  return Math.max(Math.max(cellSize, GLYPH_MIN_CELL_PIXELS) * scale, GLYPH_MIN_CELL_PIXELS);
}

/** Cells smaller than two output pixels cannot show a character: they render 2 pixels wide (small frames only). */
export function glyphCellWarnings(params: Record<string, number | boolean | string>, width = 1920, height = 1080, fallbackCell = 14): string[] {
  const cellSize = Math.max(finite(params.cellSize, fallbackCell), GLYPH_MIN_CELL_PIXELS);
  const shortSide = Math.min(width, height);
  if (!(shortSide > 0) || cellSize * shortSide / GLYPH_REFERENCE_HEIGHT >= GLYPH_MIN_CELL_PIXELS) return [];
  return [`Cell Size ${Number(cellSize.toPrecision(4))} px is smaller than ${GLYPH_MIN_CELL_PIXELS} pixels on this ${width}×${height} frame; the characters render ${GLYPH_MIN_CELL_PIXELS} pixels wide.`];
}
