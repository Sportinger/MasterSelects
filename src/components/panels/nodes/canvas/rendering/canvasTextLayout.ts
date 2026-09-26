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

const wraps = new WeakMap<TextContext, Map<string, string[] | null>>();

/** Greedy word wrap at separators (space, dash, underscore). Returns undefined
 * when the label needs more than `maxLines` or a single word overflows. */
export function wrapCanvasLabel(ctx: TextContext, value: string, width: number, maxLines: number): string[] | undefined {
  let cache = wraps.get(ctx);
  if (!cache) { cache = new Map(); wraps.set(ctx, cache); }
  const key = JSON.stringify([ctx.font, width, maxLines, value]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const lines: string[] = [];
  let result: string[] | undefined = lines;
  for (const word of value.match(/[^\s_-]+[\s_-]*|[\s_-]+/g) ?? []) {
    const joined = (lines.at(-1) ?? '') + word;
    if (lines.length && ctx.measureText(joined.trimEnd()).width <= width) { lines[lines.length - 1] = joined; continue; }
    if (ctx.measureText(word.trimEnd()).width > width || lines.length >= maxLines) { result = undefined; break; }
    lines.push(word);
  }
  result = result?.map(line => line.trimEnd());
  if (cache.size >= MAX_LAYOUTS) cache.delete(cache.keys().next().value!);
  cache.set(key, result ?? null);
  return result;
}
