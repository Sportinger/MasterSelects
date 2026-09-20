import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph, NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';
import { isStabilizationKey, isStabilizationProperty, stabilizationStatus, STABILIZATION_PROPERTIES } from '../landmarkTracking/stabilizationProvenance';
import { parameterNode } from './keyframeNodeParameters';

export const STABILIZATION_GROUP = 'stabilization';
export const STABILIZATION_SOLVE_NODE = 'stabilization/solve';
export const STABILIZATION_CURVES_NODE = 'stabilization/keyframes';

/** Shows recorded bake dependencies; opening the graph never bakes or edits a clip. */
export function projectStabilizationGraph(graph: NodeGraph, clip: TimelineClip, keys: readonly Keyframe[], trackingCreatedAt?: number): NodeGraph {
  const bake = clip.nodeGraph?.stabilization?.bake;
  const properties = STABILIZATION_PROPERTIES.filter(property => keys.some(key => key.property === property
    && (bake || isStabilizationKey(key))));
  if (!bake && !properties.length) return graph;
  const source = graph.nodes.find(node => node.binding?.kind === 'clip-source' && node.outputs.some(port => port.id === 'face-landmarks'));
  const owner = parameterNode(clip, 'position.x', graph.nodes);
  if (!source || !owner || owner === source) return graph;
  const status = stabilizationStatus(clip, keys, trackingCreatedAt);
  const playback = { bypassable: keys.some(isStabilizationKey), enabled: clip.videoInspectorSections?.stabilization !== false };
  const nodes = graph.nodes.map(node => ({ ...node, inputs: [...node.inputs], outputs: [...node.outputs] }));
  const target = nodes.find(node => node.id === owner.id)!;
  const facePort = source.outputs.find(port => port.id === 'face-landmarks')!;
  const port = (id: string, label: string, type: NodeGraphPort['type'], direction: NodeGraphPort['direction'], property?: string): NodeGraphPort => ({
    id, label, type, direction,
    metadata: { readOnly: true, ...(property ? { animationProperty: property, semanticKind: 'animation:number' } : {}) },
  });
  const refs = graph.nodes.flatMap(node => node.animation?.channels ?? [])
    .filter(ref => properties.some(property => property === ref.property));
  const channels = refs.filter((ref, index) => refs.findIndex(candidate => candidate.property === ref.property) === index);
  // Keep the actual curves accessible on their bake stage, rather than hiding
  // stabilization among unrelated animation on the source/transform card.
  for (const node of nodes) if (node.animation) {
    const remaining = node.animation.channels.filter(ref => !isStabilizationProperty(ref.property));
    node.animation = remaining.length ? { ...node.animation, channels: remaining } : undefined;
  }
  const top = Math.min(0, ...graph.nodes.map(node => node.layout.y)) - 390;
  const groupState = clip.nodeGraph?.groups?.[STABILIZATION_GROUP];
  const origin = groupState?.position ?? { x: source.layout.x + 260, y: top };
  const position = (stage: 'solve' | 'keyframes') => {
    const local = clip.nodeGraph?.stabilization?.layouts?.[stage] ?? { x: stage === 'solve' ? 0 : 300, y: 0 };
    return { x: origin.x + local.x, y: origin.y + local.y };
  };
  const label = bake ? `${bake.target === 'lips' ? 'Lip' : 'Face'} stabilization` : 'Face / lip stabilization';
  const solver: NodeGraphNode = {
    id: STABILIZATION_SOLVE_NODE, kind: 'analysis', runtime: 'builtin', domain: 'motion', label,
    description: 'Landmarks → position X/Y and Z rotation. Calculated when baking.',
    binding: { kind: 'clip-stabilization', stage: 'solve' },
    groupId: STABILIZATION_GROUP, groupOffset: origin, layout: position('solve'),
    inputs: [{ ...facePort, id: 'landmarks', label: 'Tracked landmarks', direction: 'input',
      metadata: { ...facePort.metadata, sourceArtifact: undefined, readOnly: true } }],
    outputs: [port('pose', 'Stabilized pose', 'vector', 'output')],
    params: { ...playback, status, targetClipId: clip.id, target: bake?.target ?? 'Not recorded' },
  };
  const curves: NodeGraphNode = {
    id: STABILIZATION_CURVES_NODE, kind: 'motion', runtime: 'builtin', domain: 'motion', label: 'Transform keyframes',
    description: `${status}. Saved on ${clip.name}; playback uses these curves.`,
    binding: { kind: 'clip-stabilization', stage: 'keyframes' },
    groupId: STABILIZATION_GROUP, groupOffset: origin, layout: position('keyframes'),
    inputs: [port('pose', 'Bake to keyframes', 'vector', 'input')],
    outputs: properties.map(property => port(property, property === 'rotation.z' ? 'Rotation Z' : `Position ${property.endsWith('x') ? 'X' : 'Y'}`, 'number', 'output', property)),
    animation: channels.length ? { clipId: clip.id, channels } : undefined,
    params: { ...playback, status, targetClipId: clip.id, baked: true },
  };
  const edge = (from: string, output: string, to: string, input: string, type: NodeGraphEdge['type']): NodeGraphEdge => ({
    id: `stabilization:${from}:${output}:${to}:${input}`, fromNodeId: from, fromPortId: output,
    toNodeId: to, toPortId: input, type, readOnly: true,
  });
  const edges = [...graph.edges, edge(source.id, facePort.id, solver.id, 'landmarks', facePort.type), edge(solver.id, 'pose', curves.id, 'pose', 'vector')];
  for (const output of curves.outputs) {
    const id = `stabilization:${output.id}`;
    target.inputs.push(port(id, output.label, 'number', 'input', output.id));
    edges.push(edge(curves.id, output.id, target.id, id, 'number'));
  }
  const collapsed = groupState?.collapsed === true;
  const proxy: NodeGraphNode = { ...solver, id: STABILIZATION_GROUP, label: 'Stabilization', runtime: 'subgraph',
    description: `${status}. Expand to inspect landmark conversion and saved curves.`,
    layout: origin, outputs: curves.outputs, animation: curves.animation };
  const visibleEdges = collapsed ? edges.filter(link => link.fromNodeId !== solver.id).map(link => ({ ...link,
    fromNodeId: link.fromNodeId === curves.id ? proxy.id : link.fromNodeId,
    toNodeId: link.toNodeId === solver.id ? proxy.id : link.toNodeId,
  })) : edges;
  return { ...graph, nodes: [...nodes, ...(collapsed ? [proxy] : [solver, curves])], edges: visibleEdges,
    groups: [...(graph.groups ?? []), { id: STABILIZATION_GROUP, label: 'Stabilization', color: '#af95e5', collapsed,
      proxyId: proxy.id, nodeIds: collapsed ? [proxy.id] : [solver.id, curves.id],
      bypassNodeId: playback.bypassable ? (collapsed ? proxy.id : solver.id) : undefined }],
  };
}
