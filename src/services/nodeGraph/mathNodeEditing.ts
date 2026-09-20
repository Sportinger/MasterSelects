import type { NodeGraphNode } from '../../types/nodeGraph';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { editEffectGraph } from '../operators/effectGraphEditing';
import { SCALAR_FIELD_OPERATORS } from '../operators/scalarField';
import { effectOperatorParams } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { getFlockOperator } from '../flock/operators/flockOperatorRegistry';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { useTimelineStore } from '../../stores/timeline';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';

export function mathModeOptions(node: NodeGraphNode) {
  // Typed image/vector math operators share the `math.*` namespace but not the
  // scalar-field executable family. Never offer scalar-field modes for them.
  if (node.operatorId?.startsWith('math.') && SCALAR_FIELD_OPERATORS.some(operator => operator.id === node.operatorId)) {
    return SCALAR_FIELD_OPERATORS.filter(op => op.id.startsWith('math.'))
      .map(op => ({ value: op.id, label: op.label }));
  }
  if (node.operatorId === 'flock.math') return (getFlockOperator('flock.math')?.params.find(p => p.id === 'op')?.options ?? [])
    .map(option => ({ value: option.value, label: option.label }));
  return [];
}

/** Keep stable node IDs, output links and parameter bindings (including keys).
 * Inputs absent from the new operation disconnect in the same undoable edit. */
export function changeScalarMathMode(graph: EffectOperatorGraph, params: Record<string, unknown>, nodeId: string, mode: string) {
  const node = graph.nodes.find(n => n.id === nodeId), next = SCALAR_FIELD_OPERATORS.find(op => op.id === mode && mode.startsWith('math.'));
  if (!node?.operator.startsWith('math.') || !next) throw new Error('Math operation unavailable.');
  const previous = getEffectOperator(node.operator)!;
  // Materialize implicit values before changing the operation's defaults.
  for (const spec of previous.parameters) {
    const binding = node.bindings[spec.id];
    if (typeof binding === 'string' && params[binding] === undefined) params[binding] = spec.default;
  }
  for (const spec of next.parameters) {
    if (!node.bindings[spec.id]) {
      node.bindings[spec.id] = spec.id === 'value' ? node.bindings.a ?? `${node.id}_value`
        : spec.id === 'a' ? node.bindings.value ?? `${node.id}_a` : `${node.id}_${spec.id}`;
    }
    const binding = node.bindings[spec.id];
    if (typeof binding === 'string' && params[binding] === undefined) params[binding] = spec.default;
  }
  node.operator = mode;
  graph.edges = graph.edges.filter(edge => edge.to !== nodeId || next.inputs.some(port => port.id === edge.input));
}

export function setMathNodeMode(clipId: string, node: NodeGraphNode, mode: string) {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(clip => clip.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const binding = node.binding;
  if (binding?.kind === 'effect-operator') {
    const effect = clip.effects.find(effect => effect.id === binding.effectId);
    if (!effect) throw new Error('Math node unavailable.');
    const defaults = effectOperatorParams(effect);
    editEffectGraph(clipId, binding.effectId, 'Change math operation', (graph, params) => {
      const current = graph.nodes.find(n => n.id === binding.nodeId);
      for (const key of Object.values(current?.bindings ?? {})) if (typeof key === 'string' && params[key] === undefined && defaults[key] !== undefined) params[key] = defaults[key];
      changeScalarMathMode(graph, params, binding.nodeId, mode);
    });
  } else if (binding?.kind === 'flock-node' && node.operatorId === 'flock.math') {
    const batch = startBatch('Change math operation');
    try { if (!state.setFlockGraphParam(clipId, binding.nodeId, 'op', mode)) throw new Error('Math operation unavailable.'); }
    finally { if (batch.opened) endBatch(); }
  }
}
