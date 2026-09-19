/** Cull only outside the viewport; never merge or discard overlapping keys. */
export function visibleKeyframeMarkers<T>(items: readonly T[], xOf: (item: T) => number, left: number, width: number): T[] {
  return items.filter(item => { const x = xOf(item); return x >= left - 16 && x <= left + width + 16; });
}
export function nearestKeyframeMarker<T extends { x: number }>(items: readonly T[], x: number, radius = 7): T | undefined {
  let nearest: T | undefined, distance = radius;
  for (const item of items) {
    const delta = Math.abs(item.x - x);
    if (delta <= distance) { nearest = item; distance = delta; }
  }
  return nearest;
}
