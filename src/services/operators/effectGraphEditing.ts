import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import type { EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import type { NodeGraphConnectionRequest } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import { effectOperatorGraph, validateEffectOwnerGraph, addableEffectOperators, canRemoveEffectOperator, isImageGraphEffectType } from './effectGraphOwner';
import { EFFECT_GRAPH_PARAM, connectEffectGraph, operatorEnabled } from './effectGraph';
import { prepareEditableOperatorGraph } from './editableOperatorGraph';
import { EFFECT_OPERATORS, getEffectOperator } from './operatorRegistry';
import type { AnimatableProperty } from '../../types/animationProperties';
import { getEffect } from '../../effects';
import { packOperatorCompositions } from './operatorComposition';

/** One logical input may feed several internal ports; editing its cable is one undoable transaction. */
export function editCompositionInput(clipId: string, effectId: string, targets: Array<{ nodeId: string; portId: string }>,
  source?: { nodeId: string; portId: string }) {
  editEffectGraph(clipId, effectId, source ? 'Connect composed node' : 'Disconnect composed node', graph => {
    for (const target of targets) {
      if (source) graph.edges = connectEffectGraph(graph, { id: `${source.nodeId}-${source.portId}-${target.nodeId}-${target.portId}`,
        from: source.nodeId, output: source.portId, to: target.nodeId, input: target.portId }).edges;
      else graph.edges = graph.edges.filter(edge => edge.to !== target.nodeId || edge.input !== target.portId);
    }
  });
}

/** Shared by the inspector and inline node values; animation keeps its owner. */
export function setAnimatedOperatorParameter(clipId: string, effectId: string, nodeId: string, parameter: string, value: OperatorValue) {
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
  delete params[EFFECT_GRAPH_PARAM];
  edit(graph, params);
  prepareEditableOperatorGraph(graph, () => validateEffectOwnerGraph(effect, graph, params));
  const batch = startBatch(label);
  try {
    state.updateClip(clipId, { effects: clip.effects.map(e => e.id === effectId ? { ...e, params, operatorGraph: packOperatorCompositions(graph) } : e) });
    state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

export function setOperatorParameter(clipId: string, effectId: string, nodeId: string, name: string, value: OperatorValue) {
  const effectType = readTimelineRuntimeState(useTimelineStore).clips.find(clip => clip.id === clipId)?.effects.find(effect => effect.id === effectId)?.type;
  editEffectGraph(clipId, effectId, 'Edit node parameter', (graph, params) => {
    const node = graph.nodes.find(n => n.id === nodeId);
    const spec = node && getEffectOperator(node.operator)?.parameters.find(p => p.id === name);
    if (!node || !spec) throw new Error('Parameter unavailable.');
    const binding = node.bindings[name];
    const ownerSpec = typeof binding === 'string' && effectType && isImageGraphEffectType(effectType) ? getEffect(effectType)?.params[binding] : undefined;
    const min = ownerSpec?.type === 'number' ? ownerSpec.min : spec.min, max = ownerSpec?.type === 'number' ? ownerSpec.max : spec.max;
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < (min ?? -Infinity) || value > (max ?? Infinity))) throw new Error('Parameter is outside its supported range.');
    if (spec.type === 'boolean' && typeof value !== 'boolean') throw new Error('Parameter requires a boolean value.');
    if (spec.type === 'color' && (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))) throw new Error('Parameter requires a hex color.');
    const select = ownerSpec?.type === 'select' ? ownerSpec : spec;
    if (spec.type === 'select' && (typeof value !== 'string' || !select.options?.some(option => option.value === value))) throw new Error('Parameter option is unavailable.');
    if (typeof binding === 'string') params[binding] = value;
    else if (Array.isArray(binding) && Array.isArray(value)) binding.forEach((key, i) => { params[key] = value[i]; });
    else throw new Error('Edit the exposed direction angles.');
  });
}

/** Edits a graph-local literal. Exposed/keyframed values continue to use stable effect param bindings. */
export function setOperatorConstant(clipId: string, effectId: string, nodeId: string, name: string, value: OperatorValue) {
  editEffectGraph(clipId, effectId, 'Edit node value', graph => {
    const node = graph.nodes.find(candidate => candidate.id === nodeId);
    const spec = node && getEffectOperator(node.operator)?.parameters.find(parameter => parameter.id === name);
    if (!node || !spec || node.bindings[name]) throw new Error('Constant unavailable.');
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)
      || (!['values.number', 'values.integer'].includes(node.operator) && (value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity))))) {
      throw new Error('Parameter is outside its supported range.');
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') throw new Error('Parameter requires a boolean value.');
    if (spec.type === 'color' && (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))) throw new Error('Parameter requires a hex color.');
    if (spec.type === 'select' && (typeof value !== 'string' || !spec.options?.some(option => option.value === value))) throw new Error('Parameter option is unavailable.');
    if (spec.type === 'vector' && (!Array.isArray(value) || value.length !== 3
      || value.some(component => !Number.isFinite(component)))) throw new Error('Parameter requires a finite vector.');
    node.constants = { ...node.constants, [name]: node.operator === 'values.integer' && typeof value === 'number' ? Math.trunc(value) : value };
  });
}

function applyOperatorVariant(graph: EffectOperatorGraph, nodeId: string, operatorId: string): void {
  const node = graph.nodes.find(candidate => candidate.id === nodeId);
  const current = node && getEffectOperator(node.operator), target = getEffectOperator(operatorId);
  if (!node || !current?.family || current.family !== target?.family) throw new Error('Operator variant unavailable.');
  node.operator = target.id;
  node.operatorVersion = target.version;
}

/** Persists an explicit registry variant while retaining stable ports and visibly invalid wiring. */
export function setOperatorVariant(clipId: string, effectId: string, nodeId: string, operatorId: string) {
  const effect = readTimelineRuntimeState(useTimelineStore).clips.find(clip => clip.id === clipId)?.effects.find(effect => effect.id === effectId);
  if (!effect || !addableEffectOperators(effect.type).some(operator => operator.id === operatorId)) throw new Error('Operator variant is not supported in this graph.');
  editEffectGraph(clipId, effectId, 'Change node variant', graph => applyOperatorVariant(graph, nodeId, operatorId));
}

export function createEffectGraphActions(clipId: string, effectId: string) {
  const ownerType = (domain: EffectOperatorGraph['domain']) => domain === 'voxel' ? 'voxel-relief'
    : domain === 'image' ? 'invert' : domain === 'analog-signal' ? 'analog-signal-lab' : 'face-cables';
  return {
    moveNode: (nodeId: string, layout: { x: number; y: number }) => editEffectGraph(clipId, effectId, 'Move node', graph => { graph.layout[nodeId] = layout; }),
    connectPorts: (c: NodeGraphConnectionRequest) => editEffectGraph(clipId, effectId, 'Connect nodes', graph => {
      const from = graph.nodes.find(node => node.id === c.fromNodeId), to = graph.nodes.find(node => node.id === c.toNodeId);
      const fromSpec = from && getEffectOperator(from.operator), toSpec = to && getEffectOperator(to.operator);
      const sourceType = fromSpec?.outputs.find(port => port.id === c.fromPortId)?.type;
      const targetType = toSpec?.inputs.find(port => port.id === c.toPortId)?.type;
      if (to && toSpec?.family === 'vector.split' && sourceType) {
        const variants = EFFECT_OPERATORS.filter(spec => spec.family === toSpec.family
          && spec.inputs.find(port => port.id === c.toPortId)?.type === sourceType);
        if (variants.length === 1) applyOperatorVariant(graph, to.id, variants[0].id);
      }
      if (from && fromSpec?.family === 'vector.combine' && targetType) {
        const variants = EFFECT_OPERATORS.filter(spec => spec.family === fromSpec.family
          && spec.outputs.find(port => port.id === c.fromPortId)?.type === targetType);
        if (variants.length === 1) applyOperatorVariant(graph, from.id, variants[0].id);
      }
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
      if (!node || !canRemoveEffectOperator(ownerType(graph.domain), node.id, node.operator)) throw new Error('This group requires that node.');
      graph.nodes = graph.nodes.filter(n => n.id !== id); graph.edges = graph.edges.filter(e => e.from !== id && e.to !== id); delete graph.layout[id];
      graph.groups?.forEach(g => { g.nodeIds = g.nodeIds.filter(nodeId => nodeId !== id); });
    }),
    addNode: (operatorId: string) => {
      const id = `node-${crypto.randomUUID().slice(0, 8)}`;
      editEffectGraph(clipId, effectId, 'Add node', (graph, params) => {
        const operator = getEffectOperator(operatorId);
        if (!operator || !addableEffectOperators(ownerType(graph.domain)).includes(operator)) throw new Error('Operator cannot be added here.');
        const node = { id, operator: operator.id, operatorVersion: operator.version,
          bindings: {} as Record<string, string | [string, string, string]>, constants: {} as Record<string, OperatorValue> };
        for (const p of operator.parameters) {
          if (graph.domain === 'image') { node.constants[p.id] = p.default; continue; }
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
      return getEffectOperator(operatorId)?.composition ? `@compound-${id}` : id;
    },
  };
}
