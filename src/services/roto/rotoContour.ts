import type { MaskVertex } from '../../types/masks';
import type { RotoMask } from './rotoTypes';
import { refineRotoEdges, type RotoEdges } from './rotoEdges';

/** Pixel-boundary loops with their original winding, including holes and islands. */
export function rotoContours(mask: RotoMask, edges: RotoEdges): { x: number; y: number }[][] {
  const { width: w, height: h } = mask;
  const alpha = refineRotoEdges(mask, { offset: edges.offset, softness: 0 });
  const links = new Map<number, number[]>(), stride = w + 1;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= 128;
  const edge = (x: number, y: number, dx: number, dy: number) => {
    const a = y * stride + x, b = (y + dy) * stride + x + dx;
    const list = links.get(a) ?? []; list.push(b); links.set(a, list);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) edge(x, y, 1, 0);
    if (!filled(x + 1, y)) edge(x + 1, y, 0, 1);
    if (!filled(x, y + 1)) edge(x + 1, y + 1, -1, 0);
    if (!filled(x - 1, y)) edge(x, y + 1, 0, -1);
  }
  const point = (id: number) => ({ x: id % stride, y: Math.floor(id / stride) });
  const loops: { x: number; y: number }[][] = [];
  while (links.size) {
    const start = links.keys().next().value!;
    const loop: { x: number; y: number }[] = []; let current = start;
    do {
      loop.push(point(current));
      const next = links.get(current)!;
      // Any pairing at a diagonal junction preserves nonzero fill coverage.
      const target = next.pop()!; if (!next.length) links.delete(current);
      current = target;
    } while (current !== start);
    const corners = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
      return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x);
    });
    if (corners.length >= 3) loops.push(corners.map(p => ({ x: p.x / w, y: p.y / h })));
  }
  return loops;
}

/** Retraced bridges join loops without adding area to the renderer's nonzero fill. */
export function rotoMaskVertices(mask: RotoMask, edges: RotoEdges, id: string): MaskVertex[] {
  const loops = rotoContours(mask, edges), root = loops[0]?.[0];
  const points = root ? loops.flatMap(loop => [root, ...loop, loop[0], root]) : Array.from({ length: 3 }, () => ({ x: -1, y: -1 }));
  return points.map((p, i) => ({ ...p, id: `${id}:${i}`, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' }));
}
