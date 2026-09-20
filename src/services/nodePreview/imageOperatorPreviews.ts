import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import type { BoundOperatorNode } from '../../types/operatorGraph';
import { effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { sampleOperatorParameter } from '../operators/effectGraph';
import { evaluateScalarOperation } from '../operators/scalarOperationSemantics';
import type { PreviewFrame, PreviewRequest, PreviewValueControl } from './previewTypes';
import type { Keyframe } from '../../types/keyframes';
import { getEffect } from '../../effects';

type PreviewValue = NonNullable<PreviewFrame['values']>[number];

function imageScalarValues(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number) {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return undefined;
  const graph = effectOperatorGraph(effect), selected = graph.nodes.find(node => node.id === binding.nodeId);
  const params = effectOperatorParams(effect);
  if (graph.domain !== 'image' || !selected || !['values.number', 'math.subtract.scalar'].includes(selected.operator)) return undefined;
  const incoming = (nodeId: string, portId: string) => graph.edges.find(edge => edge.to === nodeId && edge.input === portId);
  const cache = new Map<string, number>();
  const evaluate = (node: BoundOperatorNode): number | undefined => {
    const cached = cache.get(node.id); if (cached !== undefined) return cached;
    let value: number | undefined;
    if (node.operator === 'values.number') {
      const candidate = node.bindings.value === undefined ? node.constants?.value
        : sampleOperatorParameter(node, 'value', params, effect.id, keys, time);
      value = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : 1;
    } else if (node.operator === 'math.subtract.scalar') {
      const source = (port: string) => {
        const edge = incoming(node.id, port), upstream = edge && graph.nodes.find(item => item.id === edge.from);
        return upstream ? evaluate(upstream) : undefined;
      };
      const a = source('a'), b = source('b');
      if (b !== undefined) value = node.bypassed ? b : a === undefined ? undefined : evaluateScalarOperation('subtract', a, b);
    }
    if (value !== undefined) cache.set(node.id, value);
    return value;
  };
  const values: PreviewValue[] = [];
  if (selected.operator === 'math.subtract.scalar') for (const portId of ['a', 'b']) {
    const edge = incoming(selected.id, portId), source = edge && graph.nodes.find(node => node.id === edge.from);
    values.push({ portId, direction: 'input', value: source ? evaluate(source) : undefined });
  }
  values.push({ portId: 'value', direction: 'output', value: evaluate(selected) });
  return { graph, selected, evaluate, values };
}

export function imageOperatorKnownValues(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)): PreviewValue[] {
  return imageScalarValues(request, effect, keys, time)?.values.filter(value => value.value !== undefined) ?? [];
}

/** Numeric image-IR previews are deterministic graph evaluation; they never read or copy effect params. */
export function imageOperatorValuePreview(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)): PreviewFrame | undefined {
  const scalar = imageScalarValues(request, effect, keys, time); if (!scalar) return undefined;
  const { selected, evaluate, values } = scalar;
  // Per-pixel operands and results must be rendered by the canonical image IR.
  if (selected.operator === 'math.subtract.scalar' && !(request.port?.direction === 'input'
    && values.some(value => value.direction === 'input' && value.portId === request.port!.id && value.value !== undefined))) return undefined;
  const controls: PreviewValueControl[] = [];
  if (selected.operator === 'values.number' && typeof selected.constants?.value === 'number' && selected.bindings.value === undefined) {
    const spec = getEffectOperator(selected.operator)!.parameters.find(parameter => parameter.id === 'value')!;
    controls.push({ label: spec.label, value: selected.constants.value, defaultValue: Number(spec.default), min: spec.min, max: spec.max, step: spec.step,
      portId: 'value', direction: 'output', target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value', storage: 'constant' } });
  } else if (selected.operator === 'values.number' && typeof selected.bindings.value === 'string') {
    const binding = selected.bindings.value, owner = getEffect(effect.type)?.params[binding];
    const current = evaluate(selected);
    if (owner?.type === 'number' && current !== undefined) controls.push({ label: owner.label, value: current, defaultValue: Number(owner.default),
      min: owner.min, max: owner.max, step: owner.step, portId: 'value', direction: 'output', persistenceKey: `operator.${effect.id}.${binding}`,
      target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value' } });
  }
  const output = evaluate(selected);
  return { key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Live values', controls, values,
    drawing: { kind: 'number', value: output === undefined ? '—' : String(Number(output.toFixed(4))), caption: selected.operator === 'values.number' ? 'Value' : 'Result' } };
}
