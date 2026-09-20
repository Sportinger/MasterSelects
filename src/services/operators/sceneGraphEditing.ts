import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import type { NodeGraphConnectionRequest } from '../../types/nodeGraph';
import type { SceneOperatorGraph } from '../../types/operatorGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { createClipNodeGraphState } from '../nodeGraph/clipGraphProjectionState';
import { compileSceneGraph, sceneGraphForClip, sceneGraphSupportsSource } from './sceneGraph';
import { connectEffectGraph } from './effectGraph';
import { SCENE_OPERATORS } from './sceneOperators';

export function editSceneGraph(clipId: string, label: string, edit: (definition: SceneOperatorGraph) => void) {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(c => c.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  if (!sceneGraphSupportsSource(clip.source?.type, clip.effects.some(e => e.enabled && e.type === 'face-cables' && Boolean(e.params.scene3D)), clip.effects.some(e => e.enabled && e.type === 'voxel-relief'))) throw new Error('This source uses its own geometry renderer.');
  const definition = structuredClone(sceneGraphForClip(clip)); edit(definition); compileSceneGraph(definition);
  const batch = startBatch(label);
  try {
    const nodeGraph = clip.nodeGraph ?? createClipNodeGraphState(clip);
    state.updateClip(clipId, { nodeGraph: { ...nodeGraph, scene: definition } }); state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

export function createSceneGraphActions(clipId: string) {
  return {
    moveNode: (id: string, layout: { x: number; y: number }) => editSceneGraph(clipId, 'Move scene node', d => { d.graph.layout[id] = layout; }),
    connectPorts: (c: NodeGraphConnectionRequest) => editSceneGraph(clipId, 'Connect scene nodes', d => {
      d.graph = connectEffectGraph(d.graph, { id: `${c.fromNodeId}-${c.fromPortId}-${c.toNodeId}-${c.toPortId}`, from: c.fromNodeId, output: c.fromPortId, to: c.toNodeId, input: c.toPortId });
    }),
    disconnectEdge: (id: string) => editSceneGraph(clipId, 'Disconnect scene nodes', d => { d.graph.edges = d.graph.edges.filter(e => e.id !== id); }),
    deleteNode: (id: string) => editSceneGraph(clipId, 'Delete scene node', d => {
      if (!SCENE_OPERATORS.find(o => o.id === d.graph.nodes.find(n => n.id === id)?.operator)?.addable) throw new Error('Keep the scene source, transform and output nodes.');
      d.graph.nodes = d.graph.nodes.filter(n => n.id !== id); d.graph.edges = d.graph.edges.filter(e => e.from !== id && e.to !== id);
      d.graph.groups?.forEach(g => { g.nodeIds = g.nodeIds.filter(n => n !== id); }); delete d.graph.layout[id];
    }),
    toggleBypass: (id: string) => editSceneGraph(clipId, 'Toggle scene node bypass', d => {
      const node = d.graph.nodes.find(n => n.id === id);
      if (!node) throw new Error('Scene node is unavailable.');
      node.bypassed = !node.bypassed;
    }),
    setParameter: (id: string, name: string, value: number) => editSceneGraph(clipId, 'Edit scene node', d => {
      const node = d.graph.nodes.find(n => n.id === id), spec = SCENE_OPERATORS.find(o => o.id === node?.operator)?.parameters.find(p => p.id === name);
      if (!node || !spec || !Number.isFinite(value) || value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity)) throw new Error('Invalid scene parameter.');
      const binding = node.bindings[name]; if (typeof binding !== 'string') throw new Error('Invalid parameter binding.'); d.params[binding] = value;
    }),
    addNode: (operator: string) => {
      const id = `scene-${crypto.randomUUID().slice(0, 8)}`;
      editSceneGraph(clipId, 'Add scene node', d => {
        const spec = SCENE_OPERATORS.find(o => o.id === operator); if (!spec?.addable) throw new Error('Operator is not addable.');
        const bindings: Record<string, string> = {};
        for (const p of spec.parameters) { bindings[p.id] = `${id}_${p.id}`; d.params[bindings[p.id]] = p.default; }
        d.graph.nodes.push({ id, operator, bindings });
        d.graph.layout[id] = { x: 280 * ((d.graph.nodes.length - 1) % 5), y: 650 + Math.floor((d.graph.nodes.length - 8) / 5) * 220 };
      }); return id;
    },
  };
}
