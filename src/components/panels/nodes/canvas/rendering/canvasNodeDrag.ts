import type { CanvasScene, Point } from './nodeCanvasTypes';

/** Graph-space offset of cards and branch points under a pointer drag, applied by the canvas painter. */
export interface CanvasNodeDrag { nodeIds: string[]; branchIds?: string[]; dx: number; dy: number }
/** Sends a drag to the painter; false while React still moves the cards. `hold` keeps a released
 * drag painted until the committed scene has moved its items, so the old position never flashes. */
export type NodeCanvasDragChannel = (drag: CanvasNodeDrag | null, hold?: boolean) => boolean;

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
      ...full.cables.filter(cable => cable.id && cables.has(cable.id)).map(cable => {
        const fromShift = movesFrom(cable), toShift = movesTo(cable);
        const from = fromShift ? shift(cable.from) : cable.from;
        const to = toShift ? shift(cable.to) : cable.to;
        const centered = cable.via?.length === 2 && cable.via[0].x === cable.via[1].x;
        const via = centered
          // Keep adjacent angular lanes together while either card moves.
          ? [{ x: cable.via![0].x + ((fromShift ? drag.dx : 0) + (toShift ? drag.dx : 0)) / 2, y: from.y },
            { x: cable.via![0].x + ((fromShift ? drag.dx : 0) + (toShift ? drag.dx : 0)) / 2, y: to.y }]
          : cable.via?.map((point, index) => {
            const weight = (index + 1) / (cable.via!.length + 1);
            return { x: point.x + drag.dx * ((fromShift ? 1 - weight : 0) + (toShift ? weight : 0)),
              y: point.y + drag.dy * ((fromShift ? 1 - weight : 0) + (toShift ? weight : 0)) };
          });
        return { ...cable, from, to, via };
      })],
    plugs: [...visible.plugs.filter(plug => !movedPlug(plug)),
      ...full.plugs.filter(movedPlug).map(plug => ({ ...plug, center: shift(plug.center), tip: shift(plug.tip) }))],
    ...(full.branches ? { branches: full.branches.map(branch => branches.has(branch.id) ? { ...branch, ...shift(branch) } : branch) } : {}),
  };
}

/** Scene positions of the dragged items; a released drag is held until a committed scene changes them. */
export function draggedPositions(scene: CanvasScene, drag: CanvasNodeDrag): string {
  const ids = new Set(drag.nodeIds), branches = new Set(drag.branchIds);
  return JSON.stringify([scene.nodes.filter(node => ids.has(node.id)).map(node => [node.id, node.x, node.y]),
    (scene.branches ?? []).filter(branch => branches.has(branch.id)).map(branch => [branch.id, branch.x, branch.y])]);
}

/** A drag release is applied before a scene of the same batch, so the hold compares against the pre-drop positions. */
export const dragUpdatesFirst = <T extends { type: string }>(messages: Iterable<T>): T[] =>
  [...messages].toSorted((a, b) => Number(b.type === 'drag') - Number(a.type === 'drag'));
