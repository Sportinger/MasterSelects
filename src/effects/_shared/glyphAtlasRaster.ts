import { blockElementRects } from './blockElementGlyphs';
import { planGlyphAtlas, type GlyphAtlasOptions, type GlyphAtlasPlan } from './glyphAtlasPlan';

/** Share of the tile height the tallest character of a `fill` atlas spans (top and bottom keep a thin gap). */
export const GLYPH_ATLAS_FILL = 0.88;
/** Font size of atlases drawn before `fill` (share of the tile). */
const LEGACY_FONT_SCALE = 0.76;

type AtlasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * One font size and baseline for the whole ramp, so its tallest character spans GLYPH_ATLAS_FILL of the tile
 * and the characters keep their relative sizes (a '.' stays small next to a '#'). Falls back to the
 * centred legacy size where the canvas reports no glyph bounds.
 */
function fillLayout(context: AtlasContext, glyphs: readonly string[], cellSize: number, font: (size: number) => string) {
  const probe = 100;
  context.font = font(probe);
  context.textBaseline = 'alphabetic';
  let ascent = 0, descent = 0;
  for (const glyph of glyphs) {
    if (!glyph.trim() || blockElementRects(glyph)) continue;
    const metrics = context.measureText(glyph);
    const up = metrics.actualBoundingBoxAscent, down = metrics.actualBoundingBoxDescent;
    if (!Number.isFinite(up) || !Number.isFinite(down)) return undefined;
    ascent = Math.max(ascent, up); descent = Math.max(descent, down);
  }
  const ink = ascent + descent;
  if (!(ink > 0)) return undefined;
  const size = probe * cellSize * GLYPH_ATLAS_FILL / ink;
  // The ink box of the ramp sits in the middle of the tile.
  return { size, baseline: (cellSize - (ascent + descent) * size / probe) / 2 + ascent * size / probe };
}

export interface RasterizedGlyphAtlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly plan: GlyphAtlasPlan;
}

/** Rasterizes an atlas without retaining environment-specific canvas handles. */
export function rasterizeGlyphAtlas(options: GlyphAtlasOptions): RasterizedGlyphAtlas {
  const plan = planGlyphAtlas(options);
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') canvas = document.createElement('canvas');
  else if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(plan.width, plan.height);
  else throw new Error('Glyph atlas rasterization requires an HTMLCanvasElement or OffscreenCanvas.');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('2D canvas is unavailable for glyph atlas generation');
  context.clearRect(0, 0, plan.width, plan.height);
  context.fillStyle = '#ffffff';
  const font = (size: number) => `${options.fontWeight ?? 600} ${size}px ${options.fontFamily}`;
  const filled = options.fill ? fillLayout(context, plan.glyphs, plan.cellSize, font) : undefined;
  context.font = font(filled ? filled.size : Math.floor(plan.cellSize * LEGACY_FONT_SCALE));
  context.textAlign = 'center';
  context.textBaseline = filled ? 'alphabetic' : 'middle';

  for (let index = 0; index < plan.glyphs.length; index++) {
    const glyph = plan.glyphs[index];
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    // Block Elements fill the whole tile as shapes, so a ramp of blocks joins into a solid mosaic.
    const block = blockElementRects(glyph);
    if (block) {
      for (const [x0, y0, x1, y1] of block) {
        context.fillRect(column * plan.cellSize + x0 * plan.cellSize, row * plan.cellSize + y0 * plan.cellSize,
          (x1 - x0) * plan.cellSize, (y1 - y0) * plan.cellSize);
      }
      continue;
    }
    const centerX = column * plan.cellSize + plan.cellSize / 2;
    const centerY = row * plan.cellSize + (filled ? filled.baseline : plan.cellSize / 2);
    const measured = Math.max(1, context.measureText(glyph).width);
    const scaleX = Math.min(1, plan.cellSize * 0.82 / measured);
    context.save();
    context.translate(centerX, centerY);
    context.scale(scaleX, 1);
    context.fillText(glyph, 0, 0);
    context.restore();
  }
  return { canvas, plan };
}
