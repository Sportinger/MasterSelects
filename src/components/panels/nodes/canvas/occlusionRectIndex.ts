import type { Rect } from './rendering/nodeCanvasTypes';

interface Entry<T> { rect: Rect; value: T }
interface Branch<T> { rect: Rect; entries?: Entry<T>[]; left?: Branch<T>; right?: Branch<T> }
const intersects = (a: Rect, b: Rect) => a.x <= b.x + b.width && a.x + a.width >= b.x
  && a.y <= b.y + b.height && a.y + a.height >= b.y;

/** Static spatial index shared by every wire in a scene. Large rectangles are
 * stored once, unlike a uniform grid spanning thousands of empty cells. */
export function createOcclusionRectIndex<T>(entries: Entry<T>[]) {
  const build = (items: Entry<T>[]): Branch<T> | undefined => {
    if (!items.length) return;
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { rect } of items) {
      x = Math.min(x, rect.x); y = Math.min(y, rect.y);
      right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
    }
    const rect = { x, y, width: right - x, height: bottom - y };
    if (items.length <= 8) return { rect, entries: items };
    const horizontal = rect.width >= rect.height;
    const ordered = items.toSorted((a, b) => horizontal
      ? a.rect.x + a.rect.width / 2 - b.rect.x - b.rect.width / 2
      : a.rect.y + a.rect.height / 2 - b.rect.y - b.rect.height / 2);
    const middle = Math.floor(ordered.length / 2);
    return { rect, left: build(ordered.slice(0, middle)), right: build(ordered.slice(middle)) };
  };
  const root = build(entries);
  return (query: Rect, counters?: { visits: number }): T[] => {
    const found: T[] = [];
    const visit = (branch?: Branch<T>) => {
      if (!branch) return;
      if (counters) counters.visits++;
      if (!intersects(query, branch.rect)) return;
      if (branch.entries) for (const entry of branch.entries) {
        if (counters) counters.visits++;
        if (intersects(query, entry.rect)) found.push(entry.value);
      }
      else { visit(branch.left); visit(branch.right); }
    };
    visit(root);
    return found;
  };
}
