import type { NodeCanvasPlacement, NodeGraph } from '../../../../types/nodeGraph';
import type { CompositionGraphLayout } from '../../../../types/compositionGraph';
import { compositionNodeId } from '../../../../services/nodeGraph/composition/compositionGraphProjection';

/** The projection owns default layout; the canvas only remembers explicit card moves. */
export function compositionCanvasPlacement(graph: NodeGraph, saved?: CompositionGraphLayout): NodeCanvasPlacement {
  return {
    nodes: { ...saved?.nodes, ...Object.fromEntries(graph.nodes.map(node => [node.id, saved?.nodes[node.id] ?? node.layout])) },
    groups: Object.fromEntries((graph.groups ?? []).map(group => {
      const binding = graph.nodes.find(node => node.id === group.proxyId)?.binding;
      const members = binding?.kind === 'composition-clip'
        ? (['slice', 'speed', 'place'] as const).map(stage => compositionNodeId.timeChain(binding.clipId, stage)) : [];
      return [group.id, {
        nodeIds: [...new Set([...group.nodeIds, ...members, ...(graph.expandedNodes ?? []).filter(node => node.groupId === group.id).map(node => node.id)])],
        proxyId: group.proxyId, parentId: group.parentId, collapsed: group.collapsed, locked: true, offset: { x: 0, y: 0 },
      }];
    })),
  };
}
