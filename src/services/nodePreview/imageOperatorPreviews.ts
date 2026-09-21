import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { sampleOperatorParameter } from '../operators/effectGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../operators/imageOperatorGraph';
import type { PreviewFrame, PreviewRequest, PreviewValueControl } from './previewTypes';
import type { Keyframe } from '../../types/keyframes';
import { getEffect } from '../../effects';
import { resolveImageOperatorChoice } from '../operators/imageOperatorChoice';

type PreviewValue = NonNullable<PreviewFrame['values']>[number];

function imageScalarValues(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number) {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return undefined;
  const graph = effectOperatorGraph(effect), selected = graph.nodes.find(node => node.id === binding.nodeId);
  const params = { ...effectOperatorParams(effect) };
  if (graph.domain !== 'image' || !selected) return undefined;
  const definition = getEffectOperator(selected.operator)!;
  if (![...definition.inputs, ...definition.outputs].some(port => port.type === 'number')) return undefined;
  for (const node of graph.nodes) if (node.operator === 'values.number' && typeof node.bindings.value === 'string') {
    params[node.bindings.value] = sampleOperatorParameter(node, 'value', params, effect.id, keys, time);
  }
  const evaluatePort = (portId: string, direction: 'input' | 'output'): number | undefined => {
    try {
      const plan = compileImageOperatorPreview(graph, params, { nodeId: selected.id, portId, direction }, effectOperatorCompileContext(effect));
      if (plan.capabilities.length || plan.instructions.some(instruction => instruction.operation === 'input')) return undefined;
      const value = evaluateImageOperatorPlan(plan, [0, 0, 0, 0])[0];
      return Number.isFinite(value) ? value : undefined;
    } catch { return undefined; }
  };
  const values: PreviewValue[] = [];
  for (const direction of ['input', 'output'] as const) for (const port of definition[direction === 'input' ? 'inputs' : 'outputs']) {
    if (port.type === 'number') values.push({ portId: port.id, direction, value: evaluatePort(port.id, direction) });
  }
  const evaluate = () => values.find(value => value.direction === 'output' && value.portId === 'value')?.value as number | undefined;
  return { graph, selected, evaluate, values };
}

export function imageOperatorKnownValues(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)): PreviewValue[] {
  return imageScalarValues(request, effect, keys, time)?.values.filter(value => value.value !== undefined) ?? [];
}

/** Numeric previews evaluate canonical bindings without persisting duplicate parameter values. */
export function imageOperatorValuePreview(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)): PreviewFrame | undefined {
  const binding = request.node.binding;
  if (binding?.kind === 'effect-operator') {
    const selected = effectOperatorGraph(effect).nodes.find(node => node.id === binding.nodeId);
    if (selected?.operator === 'image.kernel-index' || selected?.operator === 'image.sequence-index') {
      const scope = selected.operator === 'image.kernel-index' ? 'Kernel' : 'Sequence';
      return { key: request.key, revision: request.revision, time: request.time, status: 'missing', label: `${scope} scope only`,
        presentation: 'text', drawing: { kind: 'text', lines: [`Varies per ${scope.toLowerCase()} sample`] } };
    }
    if (selected?.operator === 'values.choice' && typeof selected.bindings.value === 'string') {
      const ownerKey = selected.bindings.value, owner = getEffect(effect.type)?.params[ownerKey];
      if (owner?.type !== 'select' || !owner.options?.length) return undefined;
      const params = effectOperatorParams(effect), context = effectOperatorCompileContext(effect);
      const selectedIndex = resolveImageOperatorChoice(ownerKey, params, context);
      const fallback = String(owner.default), value = owner.options[selectedIndex].value;
      const controls: PreviewValueControl[] = [{ label: owner.label, value, defaultValue: fallback, options: owner.options,
        portId: 'value', direction: 'output', target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value' } }];
      return { key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Live value', controls,
        values: [{ portId: 'value', direction: 'output', value: selectedIndex }],
        drawing: { kind: 'number', value: String(selectedIndex), caption: owner.options[selectedIndex]?.label ?? value } };
    }
    if (selected?.operator === 'values.boolean' || selected?.operator === 'values.color') {
      const spec = getEffectOperator(selected.operator)!.parameters.find(parameter => parameter.id === 'value')!;
      const ownerKey = typeof selected.bindings.value === 'string' ? selected.bindings.value : undefined;
      const owner = ownerKey ? getEffect(effect.type)?.params[ownerKey] : undefined;
      const sampled = sampleOperatorParameter(selected, 'value', effectOperatorParams(effect), effect.id, keys, time);
      const color = selected.operator === 'values.color';
      const value = color
        ? (typeof sampled === 'string' ? sampled : String(spec.default))
        : (typeof sampled === 'boolean' ? sampled : Boolean(spec.default));
      const controls: PreviewValueControl[] = [{ label: owner?.label ?? spec.label, value,
        defaultValue: color
          ? (owner?.type === 'color' ? String(owner.default) : String(spec.default))
          : (owner?.type === 'boolean' ? Boolean(owner.default) : Boolean(spec.default)), portId: 'value', direction: 'output',
        target: ownerKey
          ? { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value' }
          : { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value', storage: 'constant' } }];
      return { key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Live value', controls,
        drawing: { kind: 'text', lines: [color ? String(value) : value ? 'True' : 'False'] } };
    }
  }
  const scalar = imageScalarValues(request, effect, keys, time); if (!scalar) return undefined;
  const { selected, evaluate, values } = scalar;
  // Per-pixel operands and results must be rendered by the canonical image IR.
  const requestedValue = request.port ? values.find(value => value.direction === request.port!.direction && value.portId === request.port!.id)?.value : evaluate();
  if (selected.operator !== 'values.number' && requestedValue === undefined) return undefined;
  const controls: PreviewValueControl[] = [];
  if (selected.operator === 'values.number' && typeof selected.constants?.value === 'number' && selected.bindings.value === undefined) {
    const spec = getEffectOperator(selected.operator)!.parameters.find(parameter => parameter.id === 'value')!;
    controls.push({ label: spec.label, value: selected.constants.value, defaultValue: Number(spec.default),
      min: Math.min(spec.min ?? -30, selected.constants.value), max: Math.max(spec.max ?? 30, selected.constants.value), step: spec.step,
      portId: 'value', direction: 'output', target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value', storage: 'constant' } });
  } else if (selected.operator === 'values.number' && typeof selected.bindings.value === 'string') {
    const binding = selected.bindings.value, owner = getEffect(effect.type)?.params[binding];
    const current = evaluate();
    if (owner?.type === 'number' && current !== undefined) controls.push({ label: owner.label, value: current, defaultValue: Number(owner.default),
      min: owner.min, max: owner.max, step: owner.step, portId: 'value', direction: 'output', persistenceKey: `operator.${effect.id}.${binding}`,
      target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value' } });
  }
  const output = typeof requestedValue === 'number' ? requestedValue : evaluate();
  return { key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Live values', controls, values,
    drawing: { kind: 'number', value: output === undefined ? '—' : String(Number(output.toFixed(4))), caption: selected.operator === 'values.number' ? 'Value' : 'Result' } };
}
