import type {
  NodeGraph,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPort,
} from '../../../../services/nodeGraph';

export const DEFAULT_VIEWPORT = { zoom: 0.88, panX: 36, panY: 28 };
export const MIN_ZOOM = 0.18;
export const MAX_ZOOM = 2.4;
export const NODE_WIDTH = 184;
export const NODE_MIN_HEIGHT = 126;
export const PORT_ROW_HEIGHT = 18;
export const PORT_START_Y = 86;
export const BADGED_PORT_START_Y = 116;
export const PORT_DOT_CENTER_X = 12;
export const PORT_DOT_CENTER_Y = 7;
export const FIT_MARGIN = 42;

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NodeGraphPoint {
  x: number;
  y: number;
}

export interface PortReference {
  nodeId: string;
  portId: string;
  direction: NodeGraphPort['direction'];
  type: NodeGraphPort['type'];
}

export interface NodeBadge {
  label: string;
  tone: 'ready' | 'partial' | 'empty' | 'processed' | 'stale';
  title?: string;
}

export interface ConnectionDraft extends PortReference {
  pointerId: number;
  start: NodeGraphPoint;
  end: NodeGraphPoint;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getNodeParamNumber(node: NodeGraphNode, key: string): number {
  const value = node.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getNodeParamString(node: NodeGraphNode, key: string): string {
  const value = node.params?.[key];
  return typeof value === 'string' ? value : '';
}

export function getAudioAnalysisBadges(node: NodeGraphNode): NodeBadge[] {
  if (!node.params || typeof node.params.status !== 'string' || typeof node.params.artifactPorts !== 'number') {
    return [];
  }

  const status = getNodeParamString(node, 'status');
  const total = getNodeParamNumber(node, 'artifactPorts');
  const available = getNodeParamNumber(node, 'availableArtifacts');
  const missing = getNodeParamNumber(node, 'missingArtifacts');
  const stale = getNodeParamNumber(node, 'staleArtifacts');
  const processed = getNodeParamNumber(node, 'processedArtifacts');
  const statusTone: NodeBadge['tone'] = status === 'ready' ? 'ready' : status === 'partial' ? 'partial' : 'empty';
  const statusLabel = status === 'ready' ? 'Ready' : status === 'partial' ? 'Partial' : 'Missing';
  const badges: NodeBadge[] = [
    {
      label: statusLabel,
      tone: stale > 0 ? 'stale' : statusTone,
      title: `${available}/${total} analysis artifacts available${missing > 0 ? `, ${missing} missing` : ''}${stale > 0 ? `, ${stale} stale` : ''}`,
    },
    {
      label: `${available}/${total}`,
      tone: missing > 0 || stale > 0 ? 'partial' : 'ready',
      title: 'Available analysis artifacts',
    },
  ];

  if (processed > 0) {
    badges.push({
      label: `${processed} processed`,
      tone: 'processed',
      title: 'Processed audio analysis artifacts are active',
    });
  }

  return badges;
}

export function getNodePortStartY(node: NodeGraphNode): number {
  return getAudioAnalysisBadges(node).length > 0 ? BADGED_PORT_START_Y : PORT_START_Y;
}

export function getNodeHeight(node: NodeGraphNode): number {
  const portRows = Math.max(node.inputs.length, node.outputs.length, 1);
  return Math.max(NODE_MIN_HEIGHT, getNodePortStartY(node) + (portRows * PORT_ROW_HEIGHT) + 16);
}

export function getGraphBounds(graph: NodeGraph): NodeBounds {
  if (graph.nodes.length === 0) {
    return { left: 0, top: 0, right: 400, bottom: 260 };
  }

  return graph.nodes.reduce<NodeBounds>((bounds, node) => {
    const nodeHeight = getNodeHeight(node);
    return {
      left: Math.min(bounds.left, node.layout.x),
      top: Math.min(bounds.top, node.layout.y),
      right: Math.max(bounds.right, node.layout.x + NODE_WIDTH),
      bottom: Math.max(bounds.bottom, node.layout.y + nodeHeight),
    };
  }, {
    left: graph.nodes[0].layout.x,
    top: graph.nodes[0].layout.y,
    right: graph.nodes[0].layout.x + NODE_WIDTH,
    bottom: graph.nodes[0].layout.y + getNodeHeight(graph.nodes[0]),
  });
}

export function getPortCenter(node: NodeGraphNode, portId: string, direction: 'input' | 'output'): NodeGraphPoint {
  const ports = direction === 'input' ? node.inputs : node.outputs;
  const portIndex = Math.max(0, ports.findIndex((port) => port.id === portId));
  return {
    x: node.layout.x + (direction === 'input' ? PORT_DOT_CENTER_X : NODE_WIDTH - PORT_DOT_CENTER_X),
    y: node.layout.y + getNodePortStartY(node) + (portIndex * PORT_ROW_HEIGHT) + PORT_DOT_CENTER_Y,
  };
}

export function getConnectionPath(from: NodeGraphPoint, to: NodeGraphPoint): string {
  const handle = Math.max(72, Math.abs(to.x - from.x) * 0.42);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}

export function getEdgePath(edge: NodeGraphEdge, nodesById: Map<string, NodeGraphNode>): string | null {
  const fromNode = nodesById.get(edge.fromNodeId);
  const toNode = nodesById.get(edge.toNodeId);
  if (!fromNode || !toNode) return null;

  const from = getPortCenter(fromNode, edge.fromPortId, 'output');
  const to = getPortCenter(toNode, edge.toPortId, 'input');
  return getConnectionPath(from, to);
}

export function getPortTitle(port: NodeGraphPort): string {
  return `${port.label} (${port.type})`;
}

export function isNodeBypassable(node: NodeGraphNode): boolean {
  return node.kind === 'effect' || node.kind === 'custom';
}

export function isNodeBypassed(node: NodeGraphNode): boolean {
  if (node.kind === 'effect') {
    return node.params?.enabled === false;
  }

  if (node.kind === 'custom') {
    return node.params?.bypassed === true;
  }

  return false;
}
