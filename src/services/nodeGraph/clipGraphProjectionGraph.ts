import type {
  NodeGraph,
  NodeGraphConnectionRequest,
  NodeGraphEdge,
  NodeGraphLayout,
  NodeGraphNode,
  NodeGraphPort,
  NodeGraphPortMetadata,
  NodeGraphSignalType,
} from './types';

export function outputPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  metadata?: NodeGraphPortMetadata,
): NodeGraphPort {
  return { id, label, type, direction: 'output', ...(metadata ? { metadata } : {}) };
}

export function inputPort(
  id: string,
  label: string,
  type: NodeGraphSignalType,
  metadata?: NodeGraphPortMetadata,
): NodeGraphPort {
  return { id, label, type, direction: 'input', ...(metadata ? { metadata } : {}) };
}

export function clonePort(port: NodeGraphPort): NodeGraphPort {
  return { ...port, ...(port.metadata ? { metadata: { ...port.metadata } } : {}) };
}

export function edge(
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
  type: NodeGraphSignalType,
): NodeGraphEdge {
  return {
    id: `${fromNodeId}:${fromPortId}->${toNodeId}:${toPortId}`,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
    type,
  };
}

export function cloneEdge(candidate: NodeGraphEdge): NodeGraphEdge {
  return { ...candidate };
}

export function cloneManualEdges(edges?: NodeGraphEdge[]): NodeGraphEdge[] | undefined {
  if (edges === undefined) {
    return undefined;
  }
  return edges.map(cloneEdge);
}

function getNodePort(
  node: NodeGraphNode | undefined,
  portId: string,
  direction: 'input' | 'output',
): NodeGraphPort | undefined {
  if (!node) return undefined;
  const ports = direction === 'input' ? node.inputs : node.outputs;
  return ports.find((port) => port.id === portId);
}

export function createValidatedManualEdge(
  graph: Pick<NodeGraph, 'nodes'>,
  connection: NodeGraphConnectionRequest,
): NodeGraphEdge | null {
  if (connection.fromNodeId === connection.toNodeId) {
    return null;
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const fromNode = nodesById.get(connection.fromNodeId);
  const toNode = nodesById.get(connection.toNodeId);
  const fromPort = getNodePort(fromNode, connection.fromPortId, 'output');
  const toPort = getNodePort(toNode, connection.toPortId, 'input');

  if (!fromPort || !toPort || fromPort.type !== toPort.type) {
    return null;
  }

  return edge(connection.fromNodeId, connection.fromPortId, connection.toNodeId, connection.toPortId, fromPort.type);
}

export function validateManualEdges(graph: Pick<NodeGraph, 'nodes'>, manualEdges: NodeGraphEdge[]): NodeGraphEdge[] {
  const nextEdges: NodeGraphEdge[] = [];
  const connectedInputs = new Set<string>();
  const edgeIds = new Set<string>();

  for (const candidate of manualEdges) {
    const nextEdge = createValidatedManualEdge(graph, candidate);
    if (!nextEdge || edgeIds.has(nextEdge.id)) {
      continue;
    }

    const inputKey = `${nextEdge.toNodeId}:${nextEdge.toPortId}`;
    if (connectedInputs.has(inputKey)) {
      continue;
    }

    connectedInputs.add(inputKey);
    edgeIds.add(nextEdge.id);
    nextEdges.push(nextEdge);
  }

  return nextEdges;
}

export function cloneLayout(layout: NodeGraphLayout): NodeGraphLayout {
  return { x: layout.x, y: layout.y };
}
