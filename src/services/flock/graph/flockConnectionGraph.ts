import type { FlockDefinition, FlockEdge, FlockNode } from '../../../types/flock';
import type { NodeGraphPort } from '../../../types/nodeGraph';
import type { ConnectionGraph } from '../../nodeGraph/graphConnections';
import type { FlockPortDescriptor } from '../operators/flockOperatorTypes';
import { FLOCK_PORT_SIGNAL_KIND, resolveFlockNodePorts } from '../operators/flockOperatorRegistry';

/** Saved Flock v1 definitions are adapted to the workspace editing contract.
 * The compiler and presets keep their source-time simulation representation. */
export function projectFlockPort(port: FlockPortDescriptor, direction: 'input' | 'output'): NodeGraphPort {
  return { id: port.id, label: port.label, type: FLOCK_PORT_SIGNAL_KIND[port.type], direction,
    metadata: { semanticKind: `flock:${port.type}`, required: port.required, repeated: port.repeated } };
}

export function flockConnectionEdge(edge: FlockEdge) {
  return { id: edge.id, fromNodeId: edge.from.nodeId, fromPortId: edge.from.port,
    toNodeId: edge.to.nodeId, toPortId: edge.to.port };
}

export function flockConnectionGraph(definition: FlockDefinition, nodes: FlockNode[] = definition.nodes, edges: FlockEdge[] = definition.edges): ConnectionGraph {
  return { nodes: nodes.map(node => {
    const ports = resolveFlockNodePorts(node, definition);
    return { id: node.id, inputs: (ports?.inputs ?? []).map(port => projectFlockPort(port, 'input')),
      outputs: (ports?.outputs ?? []).map(port => projectFlockPort(port, 'output')) };
  }), edges: edges.map(flockConnectionEdge) };
}
