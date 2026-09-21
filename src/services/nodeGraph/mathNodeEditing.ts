import type { NodeGraphNode } from '../../types/nodeGraph';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { editEffectGraph } from '../operators/effectGraphEditing';
import { SCALAR_FIELD_OPERATORS } from '../operators/scalarField';
import { addableEffectOperators, effectOperatorParams } from '../operators/effectGraphOwner';
import { EFFECT_OPERATORS, getEffectOperator } from '../operators/operatorRegistry';
import { getFlockOperator } from '../flock/operators/flockOperatorRegistry';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { useTimelineStore } from '../../stores/timeline';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { findClipOperatorEffect, resolveClipOperatorOwner } from '../operators/clipOperatorGraphOwner';

function typedMathModes(operatorId: string) {
  const variant = getEffectOperator(operatorId)?.variant;
  if (!operatorId.startsWith('math.') || !variant) return [];
  return EFFECT_OPERATORS.filter(operator => operator.id.startsWith('math.') && operator.variant === variant && operator.addable);
}

export function mathModeOptions(node: NodeGraphNode) {
  // Typed image/vector math operators share the `math.*` namespace but not the
  // scalar-field executable family. Never offer scalar-field modes for them.
  if (node.operatorId?.startsWith('math.') && SCALAR_FIELD_OPERATORS.some(operator => operator.id === node.operatorId)) {
    return SCALAR_FIELD_OPERATORS.filter(op => op.id.startsWith('math.'))
      .map(op => ({ value: op.id, label: op.label }));
  }
  if (node.operatorId === 'flock.math') return (getFlockOperator('flock.math')?.params.find(p => p.id === 'op')?.options ?? [])
    .map(option => ({ value: option.value, label: option.label }));
  const supported = typeof node.params?.operatorOwnerType === 'string' ? addableEffectOperators(node.params.operatorOwnerType) : undefined;
  const typed = typedMathModes(node.operatorId ?? '').filter(operator => !supported || supported.includes(operator));
  if (typed.length > 1) return typed.map(operator => ({ value: operator.id, label: operator.label }));
  return [];
}

/** Keep stable node IDs, output links and parameter bindings (including keys).
 * Inputs absent from the new operation disconnect in the same undoable edit. */
export function changeScalarMathMode(graph: EffectOperatorGraph, params: Record<string, unknown>, nodeId: string, mode: string) {
  const node = graph.nodes.find(n => n.id === nodeId);
  const typed = typedMathModes(node?.operator ?? '');
  const candidates = typed.length ? typed : SCALAR_FIELD_OPERATORS.some(op => op.id === node?.operator)
    ? SCALAR_FIELD_OPERATORS.filter(op => op.id.startsWith('math.')) : [];
  const next = candidates.find(op => op.id === mode);
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
  node.operatorVersion = next.version;
  graph.edges = graph.edges.filter(edge => edge.to !== nodeId || next.inputs.some(port => port.id === edge.input));
}

export function setMathNodeMode(clipId: string, node: NodeGraphNode, mode: string) {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const selected = state.clips.find(clip => clip.id === clipId);
  const clip = node.binding?.kind === 'effect-operator' ? resolveClipOperatorOwner(selected, node.binding.effectId, state.clips) : selected;
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  clipId = clip.id;
  const binding = node.binding;
  if (binding?.kind === 'effect-operator') {
    const effect = findClipOperatorEffect(clip, binding.effectId);
    if (!effect) throw new Error('Math node unavailable.');
    if (!addableEffectOperators(effect.type).some(operator => operator.id === mode)) throw new Error('Math operation is not supported in this graph.');
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
