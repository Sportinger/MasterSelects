import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import type { EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import type { NodeGraphConnectionRequest } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { effectOperatorGraph, validateEffectOwnerGraph, addableEffectOperators, canRemoveEffectOperator } from './effectGraphOwner';
import { EFFECT_GRAPH_PARAM, connectEffectGraph, operatorEnabled } from './effectGraph';
import { getEffectOperator } from './operatorRegistry';
import type { AnimatableProperty } from '../../types/animationProperties';

/** Shared by the inspector and inline node values; animation keeps its owner. */
export function setAnimatedOperatorParameter(clipId: string, effectId: string, nodeId: string, parameter: string, value: number | boolean) {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(item => item.id === clipId);
  const effect = clip?.effects.find(item => item.id === effectId);
  if (!effect || state.isExporting || state.tracks.find(track => track.id === clip!.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const node = effectOperatorGraph(effect).nodes.find(item => item.id === nodeId);
  const binding = node?.bindings[parameter];
  if (typeof binding !== 'string') throw new Error('Parameter unavailable.');
  const property = `effect.${effectId}.${binding}` as AnimatableProperty;
  if (typeof value === 'number' && (state.isRecording(clipId, property) || state.hasKeyframes(clipId, property))) state.addKeyframe(clipId, property, value);
  else setOperatorParameter(clipId, effectId, nodeId, parameter, value);
}

type Params = Record<string, unknown>;
/** One owner mutation for both form and graph views. Old baked artifacts are retained until a successful bake. */
export function editEffectGraph(clipId: string, effectId: string, label: string,
  edit: (graph: EffectOperatorGraph, params: Params) => void) {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(c => c.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) throw new Error('Effect unavailable.');
  const graph = structuredClone(effectOperatorGraph(effect)), params = { ...effect.params };
  edit(graph, params);
  validateEffectOwnerGraph(effect, graph, params);
  params[EFFECT_GRAPH_PARAM] = JSON.stringify(graph);
  const batch = startBatch(label);
  try {
    state.updateClip(clipId, { effects: clip.effects.map(e => e.id === effectId ? { ...e, params } : e) });
    state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

export function setOperatorParameter(clipId: string, effectId: string, nodeId: string, name: string, value: OperatorValue) {
  editEffectGraph(clipId, effectId, 'Edit node parameter', (graph, params) => {
    const node = graph.nodes.find(n => n.id === nodeId);
    const spec = node && getEffectOperator(node.operator)?.parameters.find(p => p.id === name);
    if (!node || !spec) throw new Error('Parameter unavailable.');
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity))) throw new Error('Parameter is outside its supported range.');
    const binding = node.bindings[name];
    if (typeof binding === 'string') params[binding] = value;
    else if (Array.isArray(binding) && Array.isArray(value)) binding.forEach((key, i) => { params[key] = value[i]; });
    else throw new Error('Edit the exposed direction angles.');
  });
}

export function createEffectGraphActions(clipId: string, effectId: string) {
  return {
    moveNode: (nodeId: string, layout: { x: number; y: number }) => editEffectGraph(clipId, effectId, 'Move node', graph => { graph.layout[nodeId] = layout; }),
    connectPorts: (c: NodeGraphConnectionRequest) => editEffectGraph(clipId, effectId, 'Connect nodes', graph => {
      graph.edges = connectEffectGraph(graph, { id: `${c.fromNodeId}-${c.fromPortId}-${c.toNodeId}-${c.toPortId}`, from: c.fromNodeId, output: c.fromPortId, to: c.toNodeId, input: c.toPortId }).edges;
    }),
    disconnectEdge: (id: string) => editEffectGraph(clipId, effectId, 'Disconnect nodes', graph => { graph.edges = graph.edges.filter(e => e.id !== id); }),
    toggleBypass: (id: string) => editEffectGraph(clipId, effectId, 'Bypass node', (graph, params) => {
      const node = graph.nodes.find(n => n.id === id);
      if (!node || (graph.domain !== 'voxel' && !getEffectOperator(node.operator)?.bypass)) return;
      if (node.enabled) { params[node.enabled] = !operatorEnabled(node, params); node.bypassed = false; }
      else node.bypassed = !node.bypassed;
    }),
    deleteNode: (id: string) => editEffectGraph(clipId, effectId, 'Delete node', graph => {
      const node = graph.nodes.find(n => n.id === id);
      if (!node || !canRemoveEffectOperator(graph.domain === 'voxel' ? 'voxel-relief' : 'face-cables', node.id, node.operator)) throw new Error('This group requires that node.');
      graph.nodes = graph.nodes.filter(n => n.id !== id); graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id); delete graph.layout[id];
      graph.groups?.forEach(g => { g.nodeIds = g.nodeIds.filter(nodeId => nodeId !== id); });
    }),
    addNode: (operatorId: string) => {
      const id = `node-${crypto.randomUUID().slice(0, 8)}`;
      editEffectGraph(clipId, effectId, 'Add node', (graph, params) => {
        const operator = getEffectOperator(operatorId);
        if (!operator || !addableEffectOperators(graph.domain === 'voxel' ? 'voxel-relief' : 'face-cables').includes(operator)) throw new Error('Operator cannot be added here.');
        const node = { id, operator: operator.id, bindings: {} as Record<string, string | [string, string, string]> };
        for (const p of operator.parameters) {
          const key = `${id}_${p.id}`;
          if (Array.isArray(p.default)) {
            node.bindings[p.id] = ['x', 'y', 'z'].map(axis => `${key}_${axis}`) as [string, string, string];
            (node.bindings[p.id] as string[]).forEach((k, i) => { params[k] = (p.default as number[])[i]; });
          } else { node.bindings[p.id] = key; params[key] = p.default; }
        }
        const template = graph.nodes.find(n => n.operator === operatorId);
        if (template) for (const edge of graph.edges.filter(e => e.to === template.id)) graph.edges.push({ ...edge, id: `${edge.from}-${id}-${edge.input}`, to: id });
        const group = template && graph.groups?.find(g => g.nodeIds.includes(template.id));
        graph.nodes.push(node); graph.layout[id] = { x: 750, y: 650 + (graph.nodes.length - 13) * 160 };
        (group ?? graph.groups?.find(g => g.id === 'simulation'))?.nodeIds.push(id);
        const simulation = graph.nodes.find(n => n.operator === 'simulation.rope')!;
        const output = operator.outputs[0];
        if (simulation && (output.type === 'force' || output.type === 'drag')) graph.edges.push({ id: `${id}-${simulation.id}`, from: id, output: output.id, to: simulation.id, input: output.type === 'force' ? 'forces' : 'drag' });
      });
      return id;
    },
  };
}
