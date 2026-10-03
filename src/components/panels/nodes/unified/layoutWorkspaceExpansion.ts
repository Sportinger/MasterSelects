import { startNodeMeasure, endNodeMeasure } from '../../../../services/nodeGraph/unified/nodeGraphPerformance';
import type { NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import { expansionDisplacements, type WorkspaceLayoutBlock } from '../../../../services/nodeGraph/unified/expansionDisplacement';
import { workspaceClipGroup, workspaceClipOwner } from '../../../../services/nodeGraph/unified/workspaceIds';
import { getNodeHeight, getNodeWidth } from '../canvas/canvasGeometry';
import { nodeGroupBounds } from '../canvas/groupBounds';

/** Measure the actual cards, previews, seam ports and nested frames used by the
 * shared canvas. Only presentation coordinates change; local clip graphs stay put. */
export function layoutWorkspaceExpansion(graph: NodeGraph, composition: NodeGraph): NodeGraph {
  const measurement = import.meta.env.DEV ? startNodeMeasure('expansion-layout') : undefined;
  try {
  if (!graph.workspace || !Object.keys(graph.workspace.clips).length) return graph;
  const groups = nodeGroupBounds(graph, graph.nodes);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const blocks: WorkspaceLayoutBlock[] = composition.nodes.flatMap(reference => {
    const clipId = reference.binding?.kind === 'composition-clip' ? reference.binding.clipId : undefined;
    const expanded = !!clipId && !!graph.workspace!.clips[clipId];
    const node = nodes.get(reference.id);
    const bounds = expanded ? groups.get(workspaceClipGroup(clipId!)) : node && {
      left: node.layout.x, top: node.layout.y, right: node.layout.x + getNodeWidth(node), bottom: node.layout.y + getNodeHeight(node),
    };
    return bounds ? [{ id: reference.id, anchor: reference.layout, bounds, expanded,
      cardWidth: getNodeWidth(reference), cardHeight: getNodeHeight(reference) }] : [];
  });
  const offsets = expansionDisplacements(blocks);
  // Composition strips share x even after expansion. A vertical collision sweep
  // reserves complete body bounds, keeping later strips and their cards below them.
  if (composition.workspace) {
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const block of blocks.toSorted((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x)) {
      const shift = offsets[block.id];
      if (nodes.get(block.id)?.summary?.timeAxis) shift.x = 0;
      const box = { left: block.bounds.left + shift.x, right: block.bounds.right + shift.x,
        top: block.bounds.top + shift.y, bottom: block.bounds.bottom + shift.y };
      for (;;) {
        const collision = placed.find(other => box.left < other.right + 32 && box.right + 32 > other.left
          && box.top < other.bottom + 32 && box.bottom + 32 > other.top);
        if (!collision) break;
        const dy = collision.bottom + 32 - box.top;
        shift.y += dy; box.top += dy; box.bottom += dy;
      }
      placed.push(box);
    }
  }
  const clipOffsets = new Map(composition.nodes.flatMap(node => node.binding?.kind === 'composition-clip'
    ? [[node.binding.clipId, offsets[node.id]] as const] : []));
  const translate = (point: NodeGraphLayout, offset?: NodeGraphLayout) => ({ x: point.x + (offset?.x ?? 0), y: point.y + (offset?.y ?? 0) });
  const move = (node: NodeGraphNode) => {
    const offset = node.workspaceOwner ? clipOffsets.get(node.workspaceOwner.clipId) : offsets[node.id];
    return { ...node, layout: translate(node.layout, offset),
      ...(node.groupOffset ? { groupOffset: translate(node.groupOffset, offset) } : {}) };
  };
  return { ...graph, nodes: graph.nodes.map(move), expandedNodes: graph.expandedNodes?.map(move),
    groups: graph.groups?.map(group => {
      const owner = workspaceClipOwner(group.id), offset = owner && clipOffsets.get(owner.clipId);
      return group.composition && offset ? { ...group, composition: {
        ...group.composition, position: translate(group.composition.position, offset),
      } } : group;
    }),
    workspace: { ...graph.workspace, compositionOffsets: Object.fromEntries([...new Set([...Object.keys(graph.workspace.compositionOffsets ?? {}), ...Object.keys(offsets)])].map(id => [id,
      translate(offsets[id] ?? { x: 0, y: 0 }, graph.workspace!.compositionOffsets?.[id])])),
      clips: Object.fromEntries(Object.entries(graph.workspace.clips).map(([id, entry]) => [id,
        { ...entry, origin: translate(entry.origin, clipOffsets.get(id)) }])) } };
  } finally { if (import.meta.env.DEV) endNodeMeasure('expansion-layout', measurement); }
}
