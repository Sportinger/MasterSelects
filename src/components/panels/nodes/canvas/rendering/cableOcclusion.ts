import type { NodeGraph, NodeGraphEdge } from '../../../../../types/nodeGraph';
import type { NodeBounds } from '../canvasGeometry';
import { createOcclusionRectIndex } from '../occlusionRectIndex';
import { canvasCableRoute } from './cableGeometry';
import type { CanvasCable, Rect } from './nodeCanvasTypes';

/** One rectangle pool per scene, with small per-wire endpoint exclusions.
 * Structured clone preserves the shared pool instead of sending E x G covers. */
export function createCanvasCableOcclusion(graph: NodeGraph, bounds: ReadonlyMap<string, NodeBounds>) {
  const rects: Rect[] = [], membership = new Map<string, number[]>();
  for (const group of graph.groups ?? []) {
    const box = bounds.get(group.id);
    if (!box) continue;
    const index = rects.length;
    rects.push({ x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
    for (const id of group.nodeIds) {
      const list = membership.get(id) ?? [];
      list.push(index); membership.set(id, list);
    }
  }
  return (edge: NodeGraphEdge): NonNullable<CanvasCable['occlusionPool']> => ({ rects,
    excluded: [...new Set([...(membership.get(edge.fromNodeId) ?? []), ...(membership.get(edge.toNodeId) ?? [])])] });
}

const indices = new WeakMap<Rect[], { query: ReturnType<typeof createOcclusionRectIndex<number>>; covers: Map<string, Rect[]> }>();
const cached = new WeakMap<CanvasCable, { margin: number; covers: Rect[] }>();
const EMPTY: Rect[] = [];

/** Query at the painted geometry, including during drag/glide, never at stale
 * committed endpoints. The conservative curve hull keeps clipping exact. */
export function canvasCableOcclusions(cable: CanvasCable, margin: number): Rect[] {
  const pool = cable.occlusionPool;
  if (!pool) return cable.occlusions ?? EMPTY;
  const previous = cached.get(cable);
  if (previous?.margin === margin) return previous.covers;
  let index = indices.get(pool.rects);
  if (!index) {
    index = { query: createOcclusionRectIndex(pool.rects.map((rect, value) => ({ rect, value }))), covers: new Map() };
    indices.set(pool.rects, index);
  }
  const bounds = canvasCableRoute(cable).bounds;
  const excluded = new Set(pool.excluded);
  const matches = index.query({ x: bounds.x - margin, y: bounds.y - margin,
    width: bounds.width + margin * 2, height: bounds.height + margin * 2 })
    .filter(id => !excluded.has(id)).toSorted((a, b) => a - b);
  const key = matches.join(',');
  let covers = index.covers.get(key);
  if (!covers) {
    covers = matches.map(id => pool.rects[id]);
    // A long drag can visit many cover combinations; don't retain its history.
    if (index.covers.size >= 2048) index.covers.clear();
    index.covers.set(key, covers);
  }
  cached.set(cable, { margin, covers });
  return covers;
}

/** Spatial queries for a single painted segment or signal dot. Never expand a
 * long cable's complete hull into all the groups between its endpoints. */
export function queryCanvasCableCovers(cable: CanvasCable, bounds: Rect, counters?: { visits: number }): Rect[] {
  const rects = cable.occlusionPool?.rects ?? cable.occlusions;
  if (!rects?.length) return EMPTY;
  let index = indices.get(rects);
  if (!index) {
    index = { query: createOcclusionRectIndex(rects.map((rect, value) => ({ rect, value }))), covers: new Map() };
    indices.set(rects, index);
  }
  const excluded = cable.occlusionPool?.excluded;
  return index.query(bounds, counters).filter(id => !excluded?.includes(id)).map(id => rects[id]);
}
