import type { NodeGraph, NodeGraphEdge } from '../../../../types/nodeGraph';
import type { NodeBounds } from './canvasGeometry';
import type { Rect } from './rendering/nodeCanvasTypes';

/** Endpoint groups own their wires; only unrelated frames cover a passing wire. */
export function edgeGroupOcclusion(edge: NodeGraphEdge, graph: NodeGraph, bounds: Map<string, NodeBounds>): Rect[] {
  return createEdgeGroupOcclusion(graph, bounds)(edge);
}

/** Share covers between wires and across the structured-clone worker message. */
export function createEdgeGroupOcclusion(graph: NodeGraph, bounds: ReadonlyMap<string, NodeBounds>) {
  const groups = (graph.groups ?? []).flatMap(group => {
    const box = bounds.get(group.id);
    return box ? [{ members: new Set(group.nodeIds), rect: { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top } }] : [];
  });
  const covers = new Map<string, Rect[]>();
  return (edge: NodeGraphEdge): Rect[] => {
    const indices: number[] = [];
    groups.forEach((group, i) => { if (!group.members.has(edge.fromNodeId) && !group.members.has(edge.toNodeId)) indices.push(i); });
    const key = indices.join(',');
    let result = covers.get(key);
    if (!result) { result = indices.map(i => groups[i].rect); covers.set(key, result); }
    return result;
  };
}

/** Disjoint rectangles also work for SVG hit testing; masks alone do not disable pointer events. */
export function subtractOccludedRects(bounds: Rect, occlusions: Rect[]): Rect[] {
  let visible = [bounds];
  for (const cover of occlusions) visible = visible.flatMap(rect => {
    const left = Math.max(rect.x, cover.x), top = Math.max(rect.y, cover.y);
    const right = Math.min(rect.x + rect.width, cover.x + cover.width), bottom = Math.min(rect.y + rect.height, cover.y + cover.height);
    if (right <= left || bottom <= top) return [rect];
    return [
      { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
      { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
      { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
      { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
    ].filter(piece => piece.width > 0 && piece.height > 0);
  });
  return visible;
}

/** One SVG path preserves the rectangle union without thousands of DOM nodes.
 * Use nonzero winding: overlapping covers must stay covered, not become holes. */
export const rectangleClipPath = (rects: readonly Rect[]) => rects.map(rect =>
  `M${rect.x},${rect.y}h${rect.width}v${rect.height}h${-rect.width}Z`).join('');

export const pointBehindGroup = (point: { x: number; y: number }, occlusions: readonly Rect[]) => occlusions.some(rect =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);

/** Preserve the first covered layer's opacity, then halve it for each extra frame. */
export const coveredCableOpacity = (depth: number) => 0.3 * 0.5 ** (depth - 1);

export function groupDepthAt(point: { x: number; y: number }, covers: readonly Rect[]): number {
  return covers.reduce((depth, rect) => depth + Number(point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height), 0);
}

/** Disjoint clips ensure an overlap is painted once, at its actual cover depth. */
export function groupDepthClips(bounds: Rect, covers: readonly Rect[]): Map<number, Rect[]> {
  let pieces = [{ rect: bounds, depth: 0 }];
  for (const cover of covers) pieces = pieces.flatMap(({ rect, depth }) => {
    const x = Math.max(rect.x, cover.x), y = Math.max(rect.y, cover.y);
    const right = Math.min(rect.x + rect.width, cover.x + cover.width);
    const bottom = Math.min(rect.y + rect.height, cover.y + cover.height);
    if (right <= x || bottom <= y) return [{ rect, depth }];
    return [...subtractOccludedRects(rect, [cover]).map(rest => ({ rect: rest, depth })),
      { rect: { x, y, width: right - x, height: bottom - y }, depth: depth + 1 }];
  });
  const layers = new Map<number, Rect[]>();
  for (const { rect, depth } of pieces) {
    const layer = layers.get(depth);
    if (layer) layer.push(rect); else layers.set(depth, [rect]);
  }
  return layers;
}

// Covers are immutable within a scene. Their covered regions do not depend on
// the viewport, so panning and zooming must not repartition them on every paint.
const coveredLayers = new WeakMap<readonly Rect[], Map<number, Rect[]>>();
export function coveredGroupDepthClips(covers: readonly Rect[]): Map<number, Rect[]> {
  const cached = coveredLayers.get(covers);
  if (cached) return cached;
  if (!covers.length) return new Map();
  const x = Math.min(...covers.map(rect => rect.x)), y = Math.min(...covers.map(rect => rect.y));
  const right = Math.max(...covers.map(rect => rect.x + rect.width));
  const bottom = Math.max(...covers.map(rect => rect.y + rect.height));
  const layers = groupDepthClips({ x, y, width: right - x, height: bottom - y }, covers);
  layers.delete(0);
  coveredLayers.set(covers, layers);
  return layers;
}
