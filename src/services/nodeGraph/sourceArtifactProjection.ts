import type { NodeGraph, NodeGraphNode } from '../../types/nodeGraph';
import { sourceArtifactKind } from '../operators/sourceArtifactOperators';
import { sourceArtifactPortId } from './sourceArtifactPorts';

/** Graph-owned references remain durable; on the canvas their wires originate at Video Source. */
export function projectSourceArtifactLinks(graph: NodeGraph): NodeGraph {
  const references = new Map(graph.nodes.filter(n => sourceArtifactKind(n.operatorId ?? '')).map(n => [n.id, n]));
  const edges = graph.edges.map(e => {
    const reference = references.get(e.fromNodeId), kind = sourceArtifactKind(reference?.operatorId ?? '');
    if (!reference || !kind || reference.binding?.kind !== 'effect-operator') return e;
    return { ...e, fromNodeId: 'source', fromPortId: sourceArtifactPortId(kind, reference.binding.effectId) };
  });
  return { ...graph, edges, nodes: graph.nodes.filter(n => !references.has(n.id)),
    groups: graph.groups?.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !references.has(id)) })) };
}

/** Collapsing an effect retains its external artifact inputs and their exact writable endpoints. */
export function collapsedArtifactLinks(inner: NodeGraph, proxy: NodeGraphNode, effectId: string) {
  const edges: NodeGraph['edges'] = [];
  for (const edge of inner.edges) {
    const from = inner.nodes.find(n => n.id === edge.fromNodeId), kind = sourceArtifactKind(from?.operatorId ?? '');
    const target = inner.nodes.find(n => n.id === edge.toNodeId), port = target?.inputs.find(p => p.id === edge.toPortId);
    if (!kind || !target || !port) continue;
    const id = `artifact-${target.id}-${port.id}`;
    proxy.inputs = [...proxy.inputs, { ...port, id, label: `${target.label}: ${port.label}`, metadata: { ...port.metadata,
      artifactTarget: { effectId, nodeId: target.id, portId: port.id } } }];
    edges.push({ ...edge, id: `${inner.id}/${edge.id}`, fromNodeId: 'source', fromPortId: sourceArtifactPortId(kind, effectId), toNodeId: proxy.id, toPortId: id });
  }
  return edges;
}
