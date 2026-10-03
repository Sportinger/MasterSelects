import { startNodeMeasure, endNodeMeasure } from './nodeGraphPerformance';
import type { NodeGraph, NodeGraphLayout, NodeGraphNode, NodeGraphPort, NodeCanvasPlacement } from '../../../types/nodeGraph';
import { namespaceClipGraph } from './namespaceClipGraph';
import { workspaceClipGroup, workspaceClipId } from './workspaceIds';
import { compositionEdge, compositionPort } from '../composition/compositionGraphPrimitives';

export interface WorkspaceClipProjection {
  graph: NodeGraph;
  placement: NodeCanvasPlacement;
  bounds: { left: number; top: number; right: number; bottom: number };
}

/** A lane reads 'source ▸ Slice ▸ effects ▸ Target' (plan 3.1e); the clip graph itself keeps its names. */
function laneSeams(nodes: NodeGraphNode[]): NodeGraphNode[] {
  return nodes.map(node => {
    if (node.binding?.kind === 'clip-source' && node.groupId !== 'flock') {
      const range = `${(Number(node.params?.inPoint) || 0).toFixed(2)}–${(Number(node.params?.outPoint) || 0).toFixed(2)} s`;
      return { ...node, label: `Slice · ${node.label}`, description: `Uses ${range} of the source. In, out and speed in the inspector.` };
    }
    if (node.binding?.kind === 'clip-output') return { ...node, label: 'Target', description: 'Places the processed clip on its track at its start time.' };
    return node;
  });
}

/** The caller supplies only open clips. Collapsed cards never invoke a clip builder. */
export function embedWorkspaceGraph(composition: NodeGraph, opened: ReadonlyMap<string, WorkspaceClipProjection>): NodeGraph {
  const measurement = import.meta.env.DEV ? startNodeMeasure('embedding') : undefined;
  try {
  const graph: NodeGraph = { ...composition, nodes: [], edges: [...composition.edges], groups: [], expandedNodes: [...composition.expandedNodes ?? []],
    workspace: { clips: {}, defaultNodes: composition.workspace?.defaultNodes ?? Object.fromEntries(composition.nodes.map(node => [node.id, node.defaultLayout ?? node.layout])), compositionOffsets: composition.workspace?.compositionOffsets } };
  const replaced = new Map<string, { source: NodeGraphNode; image: NodeGraphNode; audio?: NodeGraphNode }>();
  const port = (node: NodeGraphNode, value: NodeGraphPort) => { if (!node[value.direction === 'input' ? 'inputs' : 'outputs'].some(p => p.id === value.id)) node[value.direction === 'input' ? 'inputs' : 'outputs'].push(value); };
  for (const reference of composition.nodes) {
    const binding = reference.binding;
    if (binding?.kind !== 'composition-clip') {
      const node = { ...reference, inputs: [...reference.inputs], outputs: [...reference.outputs] };
      if (binding?.kind === 'composition-track' && opened.size) {
        const audio = node.params?.trackType === 'audio', type = audio ? 'audio' : 'texture';
        port(node, compositionPort(`workspace-${type}`, audio ? 'Audio clips' : 'Video clips', type, 'input', { readOnly: false, repeated: true }));
      }
      graph.nodes.push(node); continue;
    }
    const groupId = workspaceClipGroup(binding.clipId), projection = opened.get(binding.clipId);
    if (!projection) {
      graph.nodes.push({ ...reference, groupId });
      graph.groups!.push({ id: groupId, proxyId: reference.id, nodeIds: [reference.id], label: reference.label,
        color: '#55a6c4', collapsed: true, collapsedByDefault: true });
      continue;
    }
    const origin: NodeGraphLayout = { x: reference.layout.x, y: reference.layout.y + 48 };
    const namespaced = namespaceClipGraph(projection.graph, binding.clipId, origin);
    const embedded = { ...namespaced, nodes: laneSeams(namespaced.nodes),
      ...(namespaced.expandedNodes ? { expandedNodes: laneSeams(namespaced.expandedNodes) } : {}) };
    const source = embedded.nodes.find(node => node.binding?.kind === 'clip-source') ?? embedded.nodes[0];
    const image = embedded.nodes.find(node => node.binding?.kind === 'clip-output') ?? embedded.nodes.at(-1);
    const audio = embedded.nodes.find(node => node.binding?.kind === 'clip-audio-output')
      ?? (image?.inputs.some(port => port.type === 'audio') ? image : undefined);
    if (!source || !image) { graph.nodes.push({ ...reference, inputs: [...reference.inputs], outputs: [...reference.outputs] }); continue; }
    port(source, compositionPort('workspace-media', 'Media piece', 'clip', 'input'));
    port(source, compositionPort('workspace-place', 'Place', 'time', 'input'));
    port(source, compositionPort('workspace-reference', 'Timeline clip', 'clip', 'output'));
    port(image, compositionPort('workspace-video-track', 'Video track', 'texture', 'output', { readOnly: false, targetClipId: binding.clipId }));
    if (audio) port(audio, compositionPort('workspace-audio-track', 'Audio track', 'audio', 'output', { readOnly: false, targetClipId: binding.linkedClipId ?? binding.clipId }));
    graph.workspace!.clips[binding.clipId] = { graph: projection.graph, origin, placement: projection.placement };
    graph.nodes.push(...embedded.nodes.map(node => ({ ...node, groupId: node.groupId ?? groupId })));
    graph.expandedNodes!.push(...embedded.expandedNodes ?? embedded.nodes);
    graph.edges.push(...embedded.edges);
    graph.groups!.push({ id: groupId, label: reference.label, proxyId: reference.id, nodeIds: embedded.nodes.map(node => node.id),
      color: '#55a6c4', collapsed: false, collapsedByDefault: true },
      ...(embedded.groups ?? []).map(group => ({ ...group, parentId: group.parentId ?? groupId })));
    replaced.set(reference.id, { source, image, audio });
  }
  // Time-chain proxies are replaced by processing groups. Timing stays in the composition inspector.
  const clipReferences = new Set(composition.nodes.filter(node => node.binding?.kind === 'composition-clip').map(node => node.id));
  graph.groups!.push(...(composition.groups ?? []).filter(group => !clipReferences.has(group.proxyId)));
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  graph.edges = graph.edges.map(edge => {
    const from = replaced.get(edge.fromNodeId), to = replaced.get(edge.toNodeId);
    if (!from && !to) return edge;
    const target = nodesById.get(edge.toNodeId);
    if (from && target?.binding?.kind === 'composition-track') {
      const output = edge.fromPortId === 'audio' ? from.audio : from.image;
      // Audio-only graphs expose the audio output rather than an image output.
      const actual = target.params?.trackType === 'audio' ? from.audio ?? output : output;
      if (!actual) return { ...edge, fromNodeId: from.source.id, fromPortId: 'workspace-reference' };
      const type = target.params?.trackType === 'audio' ? 'audio' : 'texture';
      const inputId = `workspace-${type}`;
      port(target, compositionPort(inputId, type === 'audio' ? 'Audio clips' : 'Video clips', type, 'input', { readOnly: false, repeated: true }));
      return compositionEdge(actual.id, type === 'audio' ? 'workspace-audio-track' : 'workspace-video-track', target.id, inputId, type, false);
    }
    return { ...edge, id: `workspace:${edge.id}`,
      ...(from ? { fromNodeId: from.source.id, fromPortId: 'workspace-reference' } : {}),
      ...(to ? { toNodeId: to.source.id, toPortId: edge.type === 'time' ? 'workspace-place' : 'workspace-media' } : {}) };
  });
  graph.expandedNodes = [...new Map([...graph.expandedNodes!.filter(node => !replaced.has(node.id)), ...graph.nodes].map(node => [node.id, node])).values()];
  return graph;
  } finally { if (import.meta.env.DEV) endNodeMeasure('embedding', measurement); }
}

export function workspaceClipRoot(clipId: string, projection: WorkspaceClipProjection): NodeGraph {
  const origin = { x: 0, y: 0 };
  const namespaced = namespaceClipGraph(projection.graph, clipId, origin);
  const graph = { ...namespaced, nodes: laneSeams(namespaced.nodes),
    ...(namespaced.expandedNodes ? { expandedNodes: laneSeams(namespaced.expandedNodes) } : {}) };
  return { ...graph, id: `workspace:${projection.graph.id}`, workspace: {
    clips: { [clipId]: { graph: projection.graph, placement: projection.placement, origin } }, defaultNodes: {},
  } };
}

export function localWorkspacePoint(point: NodeGraphLayout, origin: NodeGraphLayout): NodeGraphLayout {
  return { x: point.x - origin.x, y: point.y - origin.y };
}
export { workspaceClipId };

/** Laziness boundary shared by the workspace and regression tests. */
export function collectOpenClipProjections(ids: readonly string[], project: (id: string) => WorkspaceClipProjection | undefined) {
  const result = new Map<string, WorkspaceClipProjection>();
  for (const id of ids) { const projection = project(id); if (projection) result.set(id, projection); }
  return result;
}
