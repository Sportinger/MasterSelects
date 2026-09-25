import type { NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { getPortCenter, type NodeGraphPoint } from './canvasGeometry';

export interface ConnectionPlug {
  edge: NodeGraphEdge;
  node: NodeGraphNode;
  port: NodeGraphPort;
  center: NodeGraphPoint;
  tip: NodeGraphPoint;
}

/** Separate grips for fan-out/fan-in links, all seated around the same socket.
 * Connections leaving through one branch point share its single output grip. */
export function getConnectionPlugs(edges: NodeGraphEdge[], nodes: Map<string, NodeGraphNode>, edgeRoot?: ReadonlyMap<string, string>): ConnectionPlug[] {
  const slots = new Map<string, number>(), branchSlots = new Map<string, number>();
  return edges.flatMap(edge => (['output', 'input'] as const).flatMap(direction => {
    const nodeId = direction === 'output' ? edge.fromNodeId : edge.toNodeId;
    const portId = direction === 'output' ? edge.fromPortId : edge.toPortId;
    const node = nodes.get(nodeId);
    const port = (direction === 'output' ? node?.outputs : node?.inputs)?.find(p => p.id === portId);
    if (!node || !port) return [];
    const key = JSON.stringify([nodeId, portId, direction]), root = direction === 'output' ? edgeRoot?.get(edge.id) : undefined;
    const shared = root === undefined ? undefined : branchSlots.get(root);
    const slot = shared ?? slots.get(key) ?? 0;
    if (shared === undefined) { slots.set(key, slot + 1); if (root !== undefined) branchSlots.set(root, slot); }
    const center = getPortCenter(node, portId, direction);
    return [{ edge, node, port, center, tip: {
      x: center.x + (direction === 'input' ? -1 : 1) * (24 + slot * 18), y: center.y,
    } }];
  }));
}
