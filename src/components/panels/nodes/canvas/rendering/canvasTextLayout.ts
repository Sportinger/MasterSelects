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

/** A port label's default room: about half a card, so labels on both sides of a row never meet. */
export const PORT_LABEL_WIDTH = 65;
type PortText = { y: number; input: boolean; label: string; type: string };
/** Room for a port's label or type line on a card. Half a card by default; when the port on the
 * other side of the row is short (or missing), the long one takes what it leaves free, so a name
 * such as "Brightness Only" is not cut while the card has room. Two long names keep half each. */
export function portTextRoom(ctx: TextContext, font: string, cardWidth: number, ports: readonly PortText[], port: PortText, field: 'label' | 'type'): number {
  ctx.font = font;
  if (ctx.measureText(port[field]).width <= PORT_LABEL_WIDTH) return PORT_LABEL_WIDTH;
  const opposite = ports.find(other => other.input !== port.input && Math.abs(other.y - port.y) < 4 && other[field]);
  const used = opposite ? ctx.measureText(opposite[field]).width : 0;
  if (used > PORT_LABEL_WIDTH) return PORT_LABEL_WIDTH;
  // Both labels sit 9 px inside their dot at the card edges; keep a gap of 10 between them.
  return Math.max(PORT_LABEL_WIDTH, cardWidth - 18 - 10 - used);
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
