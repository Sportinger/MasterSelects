import type { NodeGraph, NodeGraphConnectionRequest } from '../../../../types/nodeGraph';

export function sameConnection(a: NodeGraphConnectionRequest, b: NodeGraphConnectionRequest): boolean {
  return a.fromNodeId === b.fromNodeId && a.fromPortId === b.fromPortId && a.toNodeId === b.toNodeId && a.toPortId === b.toPortId;
}

/** Domain adapters report rejected edits in their own UI. Only unplug the old
 * cable after a successful canonical mutation (or an already connected target). */
export function reconnectNodePorts<T>(graph: NodeGraph, edgeId: string, connection: NodeGraphConnectionRequest,
  readRevision: () => T, connect: (connection: NodeGraphConnectionRequest) => void, disconnect: (id: string) => void): void {
  const original = graph.edges.find(edge => edge.id === edgeId);
  if (!original || sameConnection(original, connection)) return;
  if (graph.edges.some(edge => sameConnection(edge, connection))) { disconnect(edgeId); return; }
  const before = readRevision();
  connect(connection);
  if (readRevision() !== before) disconnect(edgeId);
}
