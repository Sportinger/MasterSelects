import type { NodeGraph, NodeGraphEdge } from '../../../../types/nodeGraph';
import type { NodeBounds } from './canvasGeometry';
import type { Rect } from './rendering/nodeCanvasTypes';

/** Endpoint groups own their wires; only unrelated frames cover a passing wire. */
export function edgeGroupOcclusion(edge: NodeGraphEdge, graph: NodeGraph, bounds: Map<string, NodeBounds>): Rect[] {
  return (graph.groups ?? []).filter(group => !group.nodeIds.includes(edge.fromNodeId) && !group.nodeIds.includes(edge.toNodeId))
    .flatMap(group => { const box = bounds.get(group.id); return box ? [{ x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }] : []; });
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
