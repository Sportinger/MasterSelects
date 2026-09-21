import type { TimelineClip } from '../../types/timeline';
import type { NodeGraph, NodeGraphDocument, NodeGraphNode, NodeGraphPort, NodeGraphSignalType, SceneNodeRole } from '../../types/nodeGraph';
import { edge } from './clipGraphProjectionGraph';
import { sceneOperatorProjection } from './sceneOperatorProjection';
import { sceneGraphSupportsSource } from '../operators/sceneGraph';

export function clipHasSceneGraph(clip: TimelineClip): boolean {
  return Boolean(clip.is3D || ['model', 'gaussian-splat', 'gaussian-avatar', 'flock', 'camera', 'light', 'splat-effector'].includes(clip.source?.type ?? '')
    || clip.effects.some(e => e.enabled && e.type === 'face-cables' && e.params.scene3D));
}
const port = (id: string, type: NodeGraphSignalType, direction: NodeGraphPort['direction'], label = id): NodeGraphPort => ({ id, type, direction, label });

/** Scene dependencies are projections of their existing clip fields, including camera/light references. */
export function withClipSceneGraph(document: NodeGraphDocument, clip: TimelineClip, clips: TimelineClip[] = []): NodeGraphDocument {
  if (!clipHasSceneGraph(clip)) return document;
  const root = document.graphs.find(g => g.id === document.rootGraphId)!;
  const cable = clip.effects.find(e => e.enabled && e.type === 'face-cables' && e.params.scene3D);
  const voxel = !cable && clip.effects.find(e => e.enabled && e.type === 'voxel-relief');
  const sourceType = clip.source?.type;
  const nonVisual = sourceType === 'camera' || sourceType === 'light' || sourceType === 'splat-effector';
  const graph: NodeGraph = { id: `${root.id}:scene3d`, owner: root.owner, nodes: [], edges: [] };
  const make = (id: string, role: SceneNodeRole, label: string, x: number, y: number, inputs: NodeGraphPort[], outputs: NodeGraphPort[], owner = clip): NodeGraphNode => ({
    id, kind: role === 'render' ? 'output' : role === 'transform' ? 'transform' : role === 'geometry' ? 'source' : 'effect',
    runtime: 'builtin', label, description: owner.id !== clip.id ? `Scene dependency: ${owner.name}` : label,
    layout: clip.nodeGraph?.groups?.scene3d?.nodeLayouts?.[id] ?? { x, y }, inputs, outputs,
    binding: { kind: 'scene-node', clipId: owner.id, nodeId: id, role, ...(role === 'depth' && cable ? { effectId: cable.id } : {}) },
  });
  const inputType = cable || voxel || ['model', 'gaussian-splat', 'flock', 'gaussian-avatar'].includes(sourceType ?? '') ? 'geometry' : 'texture';
  const geometry = make('geometry', nonVisual ? sourceType as SceneNodeRole : 'geometry',
    nonVisual ? sourceType === 'camera' ? 'Camera lens' : sourceType === 'light' ? 'Light' : '3D effector'
      : cable ? 'Baked face, depth & cables' : voxel ? 'Voxel relief geometry' : sourceType === 'model' ? 'Mesh geometry' : sourceType === 'gaussian-splat' ? 'Gaussian splats' : sourceType === 'flock' ? 'Flock geometry' : 'Image plane',
    0, 100, [], [port('geometry', 'geometry', 'output', 'Geometry')]);
  const material = make('material', 'material', 'Material / surface', 250, 100,
    [port('geometry', 'geometry', 'input', 'Geometry')], [port('scene', 'scene', 'output', 'Surface')]);
  const transform = make('transform', 'transform', '3D transform', 500, 100,
    [port('scene', 'scene', 'input', 'Object')], [port('scene', 'scene', 'output', 'World space')]);
  const render = make('render', 'render', nonVisual ? 'Scene contribution' : '3D render', 750, 100,
    [port('scene', 'scene', 'input', 'World space')], []);
  graph.nodes.push(geometry, material, transform, render);
  graph.edges.push(edge('geometry', 'geometry', 'material', 'geometry', 'geometry'), edge('material', 'scene', 'transform', 'scene', 'scene'), edge('transform', 'scene', 'render', 'scene', 'scene'));
  if (cable?.params.sceneDepth || cable?.params.sceneData) {
    const depth = make('depth', 'depth', 'Saved scene depth', 0, 340, [], [port('depth', 'texture', 'output', 'Depth map')]);
    depth.params = { available: Boolean(cable.params.sceneData), enabled: Boolean(cable.params.sceneDepth) };
    graph.nodes.push(depth); geometry.inputs.push(port('depth', 'texture', 'input', 'Depth map'));
    graph.edges.push(edge('depth', 'depth', 'geometry', 'depth', 'texture'));
  }
  if (sceneGraphSupportsSource(sourceType, !!cable, clip.effects.some(e => e.enabled && e.type === 'voxel-relief'))) {
    const executable = sceneOperatorProjection(clip, graph.id);
    graph.nodes = executable.nodes; graph.edges = executable.edges; graph.groups = executable.groups; graph.issue = executable.issue;
  }
  const sceneOutput = graph.nodes.find(n => n.id === 'render');
  const dependencies = nonVisual ? [] : clips.filter(c => c.id !== clip.id && ['camera', 'light', 'splat-effector'].includes(c.source?.type ?? '')
    && c.startTime < clip.startTime + clip.duration && c.startTime + c.duration > clip.startTime);
  dependencies.forEach((dependency, index) => {
    const role = dependency.source!.type as 'camera' | 'light' | 'splat-effector';
    const id = `dependency-${dependency.id}`;
    const executable = sceneGraphSupportsSource(sourceType, !!cable, clip.effects.some(e => e.enabled && e.type === 'voxel-relief'));
    graph.nodes.push(make(id, role, `${role === 'camera' ? 'Camera' : role === 'light' ? 'Light' : 'Effector'}: ${dependency.name}`, (executable ? 810 : 250) + (index % 3) * 250, (executable ? 440 : 340) + Math.floor(index / 3) * 200,
      [], [port('scene', 'scene', 'output', 'Scene')], dependency));
    sceneOutput?.inputs.push(port(id, 'scene', 'input', role === 'camera' ? 'Camera' : role === 'light' ? 'Light' : 'Effector'));
    if (sceneOutput) graph.edges.push(edge(id, 'scene', 'render', id, 'scene'));
  });

  const proxy: NodeGraphNode = { id: 'scene3d', kind: 'effect', runtime: 'subgraph', label: '3D Scene', layout: { x: 0, y: 95 },
    inputs: [port('input', inputType, 'input')], outputs: [port('output', 'texture', 'output')], subgraphId: graph.id,
    binding: { kind: 'scene-node', clipId: clip.id, nodeId: 'render', role: 'render' } };
  // Match the runtime: source effects before cable geometry, then scene projection, grade and post effects.
  const mainIds = new Set(['source', 'text-render', 'transform', 'mask', 'color', 'output', ...clip.effects.filter(e => root.nodes.some(n => n.id === `effect-${e.id}` && n.inputs.some(p => p.type !== 'audio'))).map(e => `effect-${e.id}`),
    ...root.nodes.filter(n => n.binding?.kind === 'clip-custom-node' && n.inputs.some(p => p.id === 'input' && p.type === 'texture')).map(n => n.id)]);
  const before = root.nodes.filter(n => mainIds.has(n.id) && !['transform', 'color', 'output'].includes(n.id));
  const geometryEffect = cable || voxel;
  const cableIndex = geometryEffect ? before.findIndex(n => n.id === `effect-${geometryEffect.id}`) : -1;
  const split = cableIndex >= 0 ? cableIndex + 1 : before.some(node => node.id === 'text-render') ? 2 : 1;
  const ordered = [...before.slice(0, split), proxy, ...root.nodes.filter(n => n.id === 'color'), ...before.slice(split), root.nodes.find(n => n.id === 'output')!];
  const otherEdges = root.edges.filter(e => !(mainIds.has(e.fromNodeId) && mainIds.has(e.toNodeId) && ['texture', 'geometry'].includes(e.type)));
  const mainNodes = ordered.map((n, i) => ({ ...n, inputs: n.inputs.map(p => ({ ...p })), outputs: n.outputs.map(p => ({ ...p })), layout: clip.nodeGraph?.nodes.find(stored => stored.id === n.id)?.layout ?? { ...n.layout, x: i * 280 } }));
  for (let i = 1; i < mainNodes.length; i++) {
    const from = mainNodes[i - 1], to = mainNodes[i];
    if (to.id === 'text-render') continue; // Retain the recorded text dependency, not a geometry/image cable.
    const output = from.outputs.find(p => p.id === 'output') ?? from.outputs[0];
    const input = to.inputs.find(p => p.id === 'input') ?? to.inputs[0];
    if (!output || !input) continue;
    const type: NodeGraphSignalType = to.id === 'scene3d' ? inputType : i > mainNodes.findIndex(n => n.id === 'scene3d') ? 'texture' : output.type;
    output.type = type; input.type = type;
    otherEdges.push(edge(from.id, output.id, to.id, input.id, type));
  }
  const sceneRoot = { ...root, nodes: [...mainNodes, ...root.nodes.filter(n => !mainIds.has(n.id))], edges: otherEdges };
  return { ...document, graphs: document.graphs.map(g => g.id === root.id ? sceneRoot : g).concat(graph) };
}
