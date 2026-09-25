import type {
  NodeGraph,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPort,
} from '../../../../services/nodeGraph';
import { getNodeGraphPortCompatibilityKey, formatsOverlap } from '../../../../services/nodeGraph/graphConnections';
import { describePortText } from '../../../../services/nodeGraph/nodePortPresentation';
import { inlineNumericPorts, previewExtraHeight } from '../previews/previewGeometry';
import type { NodeCableStyle } from '../../../../types/nodeGraph';
import { cableRoute, cableRouteMidpoint, cableRouteSvg } from './cableRoute';

export const DEFAULT_VIEWPORT = { zoom: 0.88, panX: 36, panY: 28 };
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2.4;
export const NODE_WIDTH = 184;
/** Matches the worker-painted `Byp` label while providing a forgiving pointer target. */
export const NODE_BYPASS_HITBOX = { left: NODE_WIDTH - 92, top: 3, width: 42, height: 24 } as const;
export const NODE_MIN_HEIGHT = 126;
export const PORT_ROW_HEIGHT = 32;
export const nodePortRowHeight = (node: NodeGraphNode) => inlineNumericPorts(node) ? 84 : PORT_ROW_HEIGHT;
export const PORT_START_Y = 100;
export const BADGED_PORT_START_Y = 130;
export const PORT_DOT_CENTER_X = 12.5;
export const PORT_DOT_CENTER_Y = 9.5;
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
  readOnly?: boolean;
  nodeId: string;
  portId: string;
  direction: NodeGraphPort['direction'];
  type: NodeGraphPort['type'];
  /** Ports connect only when these keys match (flock ports use their semantic type). */
  compatibilityKey: string;
  formats?: string[];
}

export function createPortReference(nodeId: string, port: NodeGraphPort): PortReference {
  return {
    readOnly: port.metadata?.readOnly,
    nodeId,
    portId: port.id,
    direction: port.direction,
    type: port.type,
    compatibilityKey: getNodeGraphPortCompatibilityKey(port),
    formats: port.metadata?.contract?.formats,
  };
}

export function canConnectPortReferences(a: PortReference, b: PortReference): boolean {
  return !a.readOnly && !b.readOnly && a.nodeId !== b.nodeId && a.direction !== b.direction && a.compatibilityKey === b.compatibilityKey && formatsOverlap(a.formats, b.formats);
}

export interface NodeBadge {
  label: string;
  tone: 'ready' | 'partial' | 'empty' | 'processed' | 'stale';
  title?: string;
}

export interface ConnectionDraft extends PortReference {
  createOnDrop?: boolean;
  pointerId: number;
  start: NodeGraphPoint;
  end: NodeGraphPoint;
  originClient?: NodeGraphPoint;
  moved?: boolean;
  reconnectEdgeId?: string;
  target?: PortReference;
  /** A new cable dragged out of this branch point; `start` is the point. */
  branchId?: string;
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

export function getFlockNodeBadges(node: NodeGraphNode): NodeBadge[] {
  if (node.binding?.kind !== 'flock-node') return [];
  const errors = getNodeParamNumber(node, 'flockErrors');
  const warnings = getNodeParamNumber(node, 'flockWarnings');
  const badges: NodeBadge[] = [];
  if (errors > 0) {
    badges.push({ label: `${errors} error${errors === 1 ? '' : 's'}`, tone: 'empty', title: 'See the inspector for details' });
  }
  if (warnings > 0) {
    badges.push({ label: `${warnings} warning${warnings === 1 ? '' : 's'}`, tone: 'partial', title: 'See the inspector for details' });
  }
  return badges;
}

export function getNodeBadges(node: NodeGraphNode): NodeBadge[] {
  if (node.binding?.kind === 'clip-stabilization') {
    const status = String(node.params?.status ?? 'Baked');
    return [{ label: status === 'Baked · settings not recorded' ? 'Legacy bake' : status,
      title: status, tone: status === 'Rebake needed' ? 'stale' : status === 'Baked' ? 'ready' : 'partial' }];
  }
  return [...getAudioAnalysisBadges(node), ...getFlockNodeBadges(node)];
}

export function getNodePortStartY(node: NodeGraphNode): number {
  if (inlineNumericPorts(node)) return 72 + (node.animation?.channels.length ? 64 : 0);
  if (node.binding?.kind === 'keyframe-node') return 175;
  return (getNodeBadges(node).length > 0 ? BADGED_PORT_START_Y : PORT_START_Y) + (node.animation?.channels.length ? 64 : 0);
}

export function getNodeHeight(node: NodeGraphNode): number {
  const portRows = Math.max(node.inputs.length, node.outputs.length, 1);
  if (inlineNumericPorts(node)) return Math.max(NODE_MIN_HEIGHT, getNodePortStartY(node) + (portRows - 1) * nodePortRowHeight(node) + (node.inputs.length === 1 ? 86 : 65));
  return Math.max(NODE_MIN_HEIGHT, getNodePortStartY(node) + (portRows * nodePortRowHeight(node)) + 16) + previewExtraHeight(node);
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
    y: node.layout.y + getNodePortStartY(node) + (portIndex * nodePortRowHeight(node)) + PORT_DOT_CENTER_Y
      + (inlineNumericPorts(node) && direction === 'output' && node.inputs.length > 1 ? 42 : 0),
  };
}

export function getConnectionPath(from: NodeGraphPoint, to: NodeGraphPoint, style: NodeCableStyle = 'curved'): string {
  return cableRouteSvg(cableRoute(from, to, style));
}

/** Position and travel direction halfway along getConnectionPath's route. */
export function getConnectionArrowTransform(from: NodeGraphPoint, to: NodeGraphPoint, style: NodeCableStyle = 'curved'): string {
  const { point, angle } = cableRouteMidpoint(cableRoute(from, to, style));
  return `translate(${point.x} ${point.y}) rotate(${angle * 180 / Math.PI})`;
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
  return describePortText(port);
}

export function isNodeBypassable(node: NodeGraphNode): boolean {
  if (node.binding?.kind === 'clip-stabilization') return node.params?.bypassable === true;
  if (node.binding?.kind === 'scene-operator') return node.params?.bypassable === true;
  if (node.binding?.kind === 'operator-group') return node.params?.bypassable === true;
  if (node.binding?.kind === 'scene-node') return false;
  if (node.binding?.kind === 'effect-operator') return node.params?.bypassable === true;
  if (node.binding?.kind === 'flock-node') {
    return node.params?.bypassable === true;
  }
  return node.kind === 'effect' ||
    node.kind === 'custom' ||
    (node.binding?.kind === 'color-node' &&
      node.binding.nodeType !== 'input' &&
      node.binding.nodeType !== 'output');
}

export function isNodeBypassed(node: NodeGraphNode): boolean {
  if (node.binding?.kind === 'effect-operator' || node.binding?.kind === 'operator-group') return node.params?.enabled === false;
  if (node.binding?.kind === 'scene-operator') return node.params?.enabled === false;
  if (node.binding?.kind === 'clip-stabilization') return node.params?.enabled === false;
  if (node.binding?.kind === 'flock-node') {
    return node.params?.bypassed === true;
  }

  if (node.kind === 'effect') {
    return node.params?.enabled === false;
  }

  if (node.kind === 'custom') {
    return node.params?.bypassed === true;
  }

  if (node.binding?.kind === 'color-node') {
    return node.params?.enabled === false;
  }

  return false;
}
