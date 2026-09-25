import type { CanvasScene, Point } from './nodeCanvasTypes';

/** Graph-space offset of cards under a pointer drag, applied by the canvas painter. */
export interface CanvasNodeDrag { nodeIds: string[]; dx: number; dy: number }

/**
 * Offsets dragged cards together with their cables and plugs. Everything else
 * keeps the visible scene. Dragged items come from the full scene, so a card
 * that leaves its original on-screen area stays painted.
 */
export function applyNodeDrag(visible: CanvasScene, full: CanvasScene, drag: CanvasNodeDrag): CanvasScene {
  const ids = new Set(drag.nodeIds);
  if (!ids.size || (!drag.dx && !drag.dy)) return visible;
  const shift = (point: Point) => ({ x: point.x + drag.dx, y: point.y + drag.dy });
  const plugNode = new Map<string, string | undefined>();
  const cables = new Set<string>();
  for (const cable of full.cables) if (cable.id) {
    plugNode.set(`${cable.id}:output`, cable.fromNode);
    plugNode.set(`${cable.id}:input`, cable.toNode);
    if (ids.has(cable.fromNode ?? '') || ids.has(cable.toNode ?? '')) cables.add(cable.id);
  }
  const movedPlug = (id?: string) => !!id && ids.has(plugNode.get(id) ?? '');
  return {
    ...visible,
    // Dragged cards paint last, above the cards they pass over.
    nodes: [...visible.nodes.filter(node => !ids.has(node.id)),
      ...full.nodes.filter(node => ids.has(node.id)).map(node => ({ ...node, x: node.x + drag.dx, y: node.y + drag.dy }))],
    cables: [...visible.cables.filter(cable => !cable.id || !cables.has(cable.id)),
      ...full.cables.filter(cable => cable.id && cables.has(cable.id)).map(cable => ({ ...cable,
        from: ids.has(cable.fromNode ?? '') ? shift(cable.from) : cable.from,
        to: ids.has(cable.toNode ?? '') ? shift(cable.to) : cable.to }))],
    plugs: [...visible.plugs.filter(plug => !movedPlug(plug.id)),
      ...full.plugs.filter(plug => movedPlug(plug.id)).map(plug => ({ ...plug, center: shift(plug.center), tip: shift(plug.tip) }))],
  };
}
