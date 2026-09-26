import type { NodeGraphPort } from '../../types/nodeGraph';
import type { ConnectionGraph } from './graphConnections';
import { resolveAdaptiveGraphConnection } from './adaptiveGraphConnections';

export interface ConnectionEndpoint { nodeId: string; portId: string; direction: 'input' | 'output' }
export type ConnectableNode = ConnectionGraph['nodes'][number];
export interface ConnectionNodeCandidate {
  id: string;
  label: string;
  category: string;
  /** Catalog position of the category; unordered categories follow alphabetically. */
  order?: number;
  description?: string;
  node: ConnectableNode;
}
export interface ConnectedNodeOption {
  id: string;
  candidateId: string;
  label: string;
  category: string;
  order?: number;
  description?: string;
  port: NodeGraphPort;
  operatorId?: string;
}

export function connectionToNewNode(origin: ConnectionEndpoint, nodeId: string, portId: string) {
  return origin.direction === 'output'
    ? { fromNodeId: origin.nodeId, fromPortId: origin.portId, toNodeId: nodeId, toPortId: portId }
    : { fromNodeId: nodeId, fromPortId: portId, toNodeId: origin.nodeId, toPortId: origin.portId };
}

/** The menu and direct wiring share type inference, format, cycle and read-only checks. */
export function connectedNodeOptions(graph: ConnectionGraph, origin: ConnectionEndpoint, candidates: readonly ConnectionNodeCandidate[]): ConnectedNodeOption[] {
  return candidates.flatMap(candidate => {
    const projected = { nodes: [...graph.nodes, candidate.node], edges: graph.edges };
    const ports = origin.direction === 'output' ? candidate.node.inputs : candidate.node.outputs;
    return ports.flatMap(port => {
      const resolved = resolveAdaptiveGraphConnection(projected, connectionToNewNode(origin, candidate.node.id, port.id));
      if (!resolved.ok) return [];
      const node = resolved.graph.nodes.find(node => node.id === candidate.node.id)!;
      const portId = origin.direction === 'output' ? resolved.connection.toPortId : resolved.connection.fromPortId;
      const selected = (origin.direction === 'output' ? node.inputs : node.outputs).find(port => port.id === portId)!;
      return [{ id: `${candidate.id}:${port.id}`, candidateId: candidate.id, label: candidate.label, category: candidate.category, order: candidate.order,
        description: candidate.description, port: selected, operatorId: node.operatorId }];
    });
  }).toSorted((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}
