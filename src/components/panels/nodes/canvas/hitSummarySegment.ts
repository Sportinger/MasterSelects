import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeSummarySegments, getNodeWidth } from './canvasGeometry';

/** Screen-space padding wins over card dragging; nearest segment resolves overlapping hit areas. */
export function hitSummarySegment(nodes: readonly NodeGraphNode[], x: number, y: number, zoom: number) {
  const padding = 10 / Math.max(0.05, zoom);
  let best: { nodeId: string; segmentId: string; distance: number } | undefined;
  for (const node of nodes) {
    if (!node.summary?.segments || x < node.layout.x - padding || x > node.layout.x + getNodeWidth(node) + padding) continue;
    const summary = getNodeSummarySegments(node); if (!summary) continue;
    for (const segment of summary.segments) {
      const left = node.layout.x + segment.x, top = node.layout.y + segment.y;
      const dx = Math.max(left - x, 0, x - left - segment.width), dy = Math.max(top - y, 0, y - top - segment.height);
      if (dx > padding || dy > padding) continue;
      const distance = Math.hypot(dx, dy) * 1000 + Math.hypot(x - left - segment.width / 2, y - top - segment.height / 2);
      if (!best || distance < best.distance) best = { nodeId: node.id, segmentId: segment.id, distance };
    }
  }
  return best;
}
