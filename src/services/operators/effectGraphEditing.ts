import type { EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import type { NodeGraphConnectionRequest } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { useHistoryStore } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { cableOperatorGraph, compileCableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { EFFECT_GRAPH_PARAM, connectEffectGraph, operatorEnabled, validateEffectGraph } from './effectGraph';
import { getEffectOperator } from './operatorRegistry';

type Params = Record<string, unknown>;
/** One owner mutation for both form and graph views. Old baked artifacts are retained until a successful bake. */
export function editEffectGraph(clipId: string, effectId: string, label: string,
  edit: (graph: EffectOperatorGraph, params: Params) => void) {
  assertExclusiveTimelineMutationAllowed();
  const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) throw new Error('Effect unavailable.');
  const graph = structuredClone(cableOperatorGraph(effect.params)), params = { ...effect.params };
  edit(graph, params);
  const errors = validateEffectGraph(graph);
  if (errors.length) throw new Error(errors[0]);
  params[EFFECT_GRAPH_PARAM] = JSON.stringify(graph);
  compileCableOperatorGraph(params);
  const history = useHistoryStore.getState(), batch = history.startBatch(label);
  try {
    state.updateClip(clipId, { effects: clip.effects.map(e => e.id === effectId ? { ...e, params } : e) });
    state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) history.endBatch(); }
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
      if (!node || !getEffectOperator(node.operator)?.bypass) return;
      if (node.enabled) { params[node.enabled] = !operatorEnabled(node, params); node.bypassed = false; }
      else node.bypassed = !node.bypassed;
    }),
    deleteNode: (id: string) => editEffectGraph(clipId, effectId, 'Delete node', graph => {
      const node = graph.nodes.find(n => n.id === id);
      if (!node || node.id === 'wind' || !getEffectOperator(node.operator)?.addable) throw new Error('This group requires that node.');
      graph.nodes = graph.nodes.filter(n => n.id !== id); graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id); delete graph.layout[id];
    }),
    addNode: (operatorId: string) => {
      const id = `node-${crypto.randomUUID().slice(0, 8)}`;
      editEffectGraph(clipId, effectId, 'Add node', (graph, params) => {
        const operator = getEffectOperator(operatorId);
        if (!operator?.addable) throw new Error('Operator cannot be added here.');
        const node = { id, operator: operator.id, bindings: {} as Record<string, string | [string, string, string]> };
        for (const p of operator.parameters) {
          const key = `${id}_${p.id}`;
          if (Array.isArray(p.default)) {
            node.bindings[p.id] = ['x', 'y', 'z'].map(axis => `${key}_${axis}`) as [string, string, string];
            (node.bindings[p.id] as string[]).forEach((k, i) => { params[k] = (p.default as number[])[i]; });
          } else { node.bindings[p.id] = key; params[key] = p.default; }
        }
        graph.nodes.push(node); graph.layout[id] = { x: 750, y: 650 + (graph.nodes.length - 13) * 160 };
        const simulation = graph.nodes.find(n => n.operator === 'simulation.rope')!;
        const output = operator.outputs[0];
        if (output.type === 'force' || output.type === 'drag') graph.edges.push({ id: `${id}-${simulation.id}`, from: id, output: output.id, to: simulation.id, input: output.type === 'force' ? 'forces' : 'drag' });
      });
      return id;
    },
  };
}
