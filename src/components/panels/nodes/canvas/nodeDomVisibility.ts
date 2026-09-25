import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH, type NodeBounds, type NodeGraphPoint, type Viewport } from './canvasGeometry';
import type { NodeCableStyle } from '../../../../types/nodeGraph';
import { cableRoute, cableRouteBounds } from './cableRoute';

// CSS pixels: interaction surfaces arrive before they enter the visible canvas.
export const NODE_DOM_OVERSCAN = 256;
export function nodeDomViewport(view: Viewport, width: number, height: number): NodeBounds | null {
  if (width <= 0 || height <= 0) return null;
  return { left: (-view.panX - NODE_DOM_OVERSCAN) / view.zoom,
    top: (-view.panY - NODE_DOM_OVERSCAN) / view.zoom,
    right: (width - view.panX + NODE_DOM_OVERSCAN) / view.zoom,
    bottom: (height - view.panY + NODE_DOM_OVERSCAN) / view.zoom };
}
export function retainNodeDomViewport(previous: NodeBounds | null, view: Viewport, width: number, height: number): NodeBounds | null {
  if (width <= 0 || height <= 0) return null;
  // Refill only after half the overscan is consumed, not at every node boundary.
  const margin = NODE_DOM_OVERSCAN / 2;
  if (previous && Math.abs(previous.right - previous.left - (width + NODE_DOM_OVERSCAN * 2) / view.zoom) < 0.01
    && Math.abs(previous.bottom - previous.top - (height + NODE_DOM_OVERSCAN * 2) / view.zoom) < 0.01
    && previous.left <= (-view.panX - margin) / view.zoom
    && previous.top <= (-view.panY - margin) / view.zoom
    && previous.right >= (width - view.panX + margin) / view.zoom
    && previous.bottom >= (height - view.panY + margin) / view.zoom) return previous;
  return nodeDomViewport(view, width, height);
}
export function intersectsNodeDomView(view: NodeBounds | null | undefined, box: NodeBounds): boolean {
  return !view || (box.right >= view.left && box.left <= view.right && box.bottom >= view.top && box.top <= view.bottom);
}
export function nodeDomVisible(node: NodeGraphNode, view: NodeBounds | null | undefined): boolean {
  return intersectsNodeDomView(view, { left: node.layout.x - 40, right: node.layout.x + NODE_WIDTH + 40,
    top: node.layout.y, bottom: node.layout.y + getNodeHeight(node) });
}
export function cableDomVisible(from: NodeGraphPoint, to: NodeGraphPoint, view: NodeBounds | null | undefined, style: NodeCableStyle = 'curved'): boolean {
  // Route bounds include backward loops and cables crossing the viewport even
  // when both endpoint nodes are offscreen.
  const box = cableRouteBounds(cableRoute(from, to, style));
  return intersectsNodeDomView(view, { left: box.x - 12, right: box.x + box.width + 12, top: box.y - 12, bottom: box.y + box.height + 12 });
}
