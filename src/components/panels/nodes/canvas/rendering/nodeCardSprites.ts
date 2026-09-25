import type { CanvasNode, CanvasTheme } from './nodeCanvasTypes';

type SpriteContext = OffscreenCanvasRenderingContext2D;
export type CardPainter = (ctx: SpriteContext, node: CanvasNode, theme: CanvasTheme) => void;

/** World units around a card for its outside stroke. */
export const CARD_SPRITE_PAD = 2;
const MAX_SPRITE_EDGE = 512;
const SPRITE_BUDGET_BYTES = 48 * 1024 * 1024;

/** Everything a card draws, excluding position and entrance motion. */
export function cardSignature(node: CanvasNode): string {
  const { x: _x, y: _y, appearance: _appearance, disappearing: _disappearing, preview: _preview, ...content } = node;
  return JSON.stringify(content);
}

/**
 * Node cards are static while a large graph pans, folds or builds up. Each card
 * is rasterized once at or above the current pixel scale (quantized upwards in
 * half-octaves, so it is never magnified; overview levels keep zoom-in
 * headroom) and then only blitted. Cards that
 * would be large on screen are drawn directly instead of cached.
 */
export class NodeCardSprites {
  private readonly sprites = new Map<string, { signature: string; level: number; canvas: OffscreenCanvas; bytes: number }>();
  private bytes = 0;
  private themeKey = '';

  sprite(node: CanvasNode, signature: string | undefined, pixelScale: number, theme: CanvasTheme, paint: CardPainter): OffscreenCanvas | undefined {
    if (!signature || typeof OffscreenCanvas === 'undefined' || !(pixelScale > 0)) return undefined;
    // Every view message carries a fresh theme object; only its values matter.
    const themeKey = `${theme.background}|${theme.card}|${theme.text}|${theme.muted}|${theme.border}|${theme.accent}`;
    if (themeKey !== this.themeKey) { this.clear(); this.themeKey = themeKey; }
    const needed = 2 ** (Math.ceil(Math.log2(pixelScale) * 2) / 2);
    // Overview sprites are tiny; rasterize them with zoom-in headroom so a fast
    // wheel zoom does not re-rasterize every card at each half-octave.
    const level = needed * (needed <= 0.125 ? 4 : needed < 0.5 ? 2 : 1);
    const width = Math.ceil((node.width + CARD_SPRITE_PAD * 2) * level), height = Math.ceil((node.height + CARD_SPRITE_PAD * 2) * level);
    if (Math.max(width, height) > MAX_SPRITE_EDGE) return undefined;
    const cached = this.sprites.get(node.id);
    // Zooming out reuses a sharper sprite for up to one octave (or its headroom).
    if (cached?.signature === signature && cached.level >= needed && cached.level <= Math.max(needed * 2, level)) {
      this.sprites.delete(node.id); this.sprites.set(node.id, cached);
      return cached.canvas;
    }
    let canvas = cached?.canvas;
    if (cached) { this.bytes -= cached.bytes; this.sprites.delete(node.id); }
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    // CPU-backed like the worker layers: blitting GPU surfaces into them stalls.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.setTransform(level, 0, 0, level, CARD_SPRITE_PAD * level, CARD_SPRITE_PAD * level);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.textBaseline = 'alphabetic';
    paint(ctx, node, theme);
    const bytes = width * height * 4;
    this.sprites.set(node.id, { signature, level, canvas, bytes }); this.bytes += bytes;
    while (this.bytes > SPRITE_BUDGET_BYTES && this.sprites.size > 1) {
      const [id, oldest] = this.sprites.entries().next().value!;
      this.sprites.delete(id); this.bytes -= oldest.bytes;
    }
    return canvas;
  }

  /**
   * Shared small shapes (plugs): one sprite per visual variant, many placements.
   * bounds are in world units relative to the shape's local origin.
   */
  shape(key: string, bounds: { x: number; y: number; width: number; height: number }, pixelScale: number,
    paint: (ctx: SpriteContext) => void): { canvas: OffscreenCanvas; level: number } | undefined {
    if (typeof OffscreenCanvas === 'undefined' || !(pixelScale > 0)) return undefined;
    const level = 2 ** (Math.ceil(Math.log2(pixelScale) * 2) / 2);
    const width = Math.ceil(bounds.width * level), height = Math.ceil(bounds.height * level);
    if (Math.max(width, height) > MAX_SPRITE_EDGE || width < 1 || height < 1) return undefined;
    const id = `shape:${level}|${key}`;
    const cached = this.sprites.get(id);
    if (cached) return { canvas: cached.canvas, level };
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.setTransform(level, 0, 0, level, -bounds.x * level, -bounds.y * level);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    paint(ctx);
    const bytes = width * height * 4;
    this.sprites.set(id, { signature: key, level, canvas, bytes }); this.bytes += bytes;
    return { canvas, level };
  }

  retain(ids: ReadonlySet<string>) {
    for (const [id, sprite] of this.sprites) if (!ids.has(id) && !id.startsWith('shape:')) { this.sprites.delete(id); this.bytes -= sprite.bytes; }
  }

  clear() { this.sprites.clear(); this.bytes = 0; }
}
