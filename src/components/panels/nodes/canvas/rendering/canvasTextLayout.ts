type TextContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;
const layouts = new WeakMap<TextContext, Map<string, string>>();
const MAX_LAYOUTS = 4096;

/** Graph labels use a fixed system font. Pan/zoom and color changes do not alter
 * their graph-space widths; retain the fitted label instead of measuring every
 * shrinking prefix again on every view frame. Context ownership bounds lifetime. */
export function fitCanvasLabel(ctx: TextContext, value: string, width: number): string {
  let cache = layouts.get(ctx);
  if (!cache) { cache = new Map(); layouts.set(ctx, cache); }
  const key = JSON.stringify([ctx.font, width, value]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let label = value;
  if (ctx.measureText(label).width > width) {
    while (label.length && ctx.measureText(label + '…').width > width) label = label.slice(0, -1);
    label += '…';
  }
  if (cache.size >= MAX_LAYOUTS) cache.delete(cache.keys().next().value!);
  cache.set(key, label);
  return label;
}
