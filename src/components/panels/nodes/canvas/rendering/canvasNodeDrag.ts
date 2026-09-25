import type { CanvasScene, Point } from './nodeCanvasTypes';

/** Graph-space offset of cards and branch points under a pointer drag, applied by the canvas painter. */
export interface CanvasNodeDrag { nodeIds: string[]; branchIds?: string[]; dx: number; dy: number }

/**
 * Offsets dragged cards and branch points together with their cable ends and
 * plugs. Everything else keeps the visible scene. Dragged items come from the
 * full scene, so a card that leaves its original on-screen area stays painted.
 */
export function applyNodeDrag(visible: CanvasScene, full: CanvasScene, drag: CanvasNodeDrag): CanvasScene {
  const ids = new Set(drag.nodeIds), branches = new Set(drag.branchIds);
  if ((!ids.size && !branches.size) || (!drag.dx && !drag.dy)) return visible;
  const shift = (point: Point) => ({ x: point.x + drag.dx, y: point.y + drag.dy });
  const movesFrom = (cable: CanvasScene['cables'][number]) => ids.has(cable.fromNode ?? '') || branches.has(cable.fromBranch ?? '');
  const movesTo = (cable: CanvasScene['cables'][number]) => ids.has(cable.toNode ?? '') || branches.has(cable.toBranch ?? '');
  const cables = new Set(full.cables.filter(cable => cable.id && (movesFrom(cable) || movesTo(cable))).map(cable => cable.id!));
  const movedPlug = (plug: CanvasScene['plugs'][number]) => ids.has(plug.nodeId ?? '');
  return {
    ...visible,
    // Dragged cards paint last, above the cards they pass over.
    nodes: [...visible.nodes.filter(node => !ids.has(node.id)),
      ...full.nodes.filter(node => ids.has(node.id)).map(node => ({ ...node, x: node.x + drag.dx, y: node.y + drag.dy }))],
    cables: [...visible.cables.filter(cable => !cable.id || !cables.has(cable.id)),
      // Moving cables run direct until the drop reroutes them.
      ...full.cables.filter(cable => cable.id && cables.has(cable.id)).map(cable => ({ ...cable, via: undefined,
        from: movesFrom(cable) ? shift(cable.from) : cable.from,
        to: movesTo(cable) ? shift(cable.to) : cable.to }))],
    plugs: [...visible.plugs.filter(plug => !movedPlug(plug)),
      ...full.plugs.filter(movedPlug).map(plug => ({ ...plug, center: shift(plug.center), tip: shift(plug.tip) }))],
    ...(full.branches ? { branches: full.branches.map(branch => branches.has(branch.id) ? { ...branch, ...shift(branch) } : branch) } : {}),
  };
}
