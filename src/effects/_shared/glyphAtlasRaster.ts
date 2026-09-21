import { planGlyphAtlas, type GlyphAtlasOptions, type GlyphAtlasPlan } from './glyphAtlasPlan';

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
  context.font = `${options.fontWeight ?? 600} ${Math.floor(plan.cellSize * 0.76)}px ${options.fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < plan.glyphs.length; index++) {
    const glyph = plan.glyphs[index];
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const centerX = column * plan.cellSize + plan.cellSize / 2;
    const centerY = row * plan.cellSize + plan.cellSize / 2;
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
