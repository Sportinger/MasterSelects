import type { TimelineClip } from '../../types/timeline';
import type { NodeGraphNode } from '../../types/nodeGraph';
import { createColorNode, type ColorNodeType } from '../../types/colorCorrection';
import { colorNodePorts } from './colorGraphPorts';
import { buildClipColorNodeGraph } from './clipGraphDocument';
import { listFlockOperators } from '../flock/operators/flockOperatorRegistry';
import { flockConnectionGraph, projectFlockPort } from '../flock/graph/flockConnectionGraph';
import { connectedNodeOptions, type ConnectionEndpoint, type ConnectionNodeCandidate } from './connectedNodeOptions';

export function domainConnectionCatalog(clip: TimelineClip, binding: NodeGraphNode['binding'], origin: ConnectionEndpoint) {
  if (binding?.kind === 'color-node') {
    const graph = buildClipColorNodeGraph(clip);
    const types: ColorNodeType[] = ['primary', 'wheels', 'parallel-mixer', 'layer-mixer', 'key-mixer', 'splitter', 'combiner', 'source', 'alpha-output'];
    const candidates = types.map(type => { const node = createColorNode(type); return { id: type, label: node.name,
      category: 'Color', node: { id: '__new_connection_node__', ...colorNodePorts(node) } }; });
    return { kind: 'color' as const, options: graph ? connectedNodeOptions(graph, origin, candidates) : [] };
  }
  if (binding?.kind === 'flock-node' && clip.flock) {
    const candidates: ConnectionNodeCandidate[] = listFlockOperators().map(operator => ({ id: operator.id, label: operator.label,
      category: operator.category, description: operator.description,
      node: { id: '__new_connection_node__', inputs: operator.inputs.map(port => projectFlockPort(port, 'input')),
        outputs: operator.outputs.map(port => projectFlockPort(port, 'output')) } }));
    for (const group of clip.flock.groups) candidates.push({ id: `group:${group.id}`, label: group.label, category: 'Groups',
      node: { id: '__new_connection_node__', inputs: group.inputs.map(port => projectFlockPort(port, 'input')),
        outputs: group.outputs.map(port => projectFlockPort(port, 'output')) } });
    return { kind: 'flock' as const, options: connectedNodeOptions(flockConnectionGraph(clip.flock), origin, candidates) };
  }
  return undefined;
}
