import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { sampleOperatorParameter } from '../operators/effectGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan, type ImageOperatorCompileContext } from '../operators/imageOperatorGraph';
import type { PreviewFrame, PreviewRequest, PreviewValueControl } from './previewTypes';
import type { Keyframe } from '../../types/keyframes';
import { getEffect } from '../../effects';
import { resolveImageOperatorChoice } from '../operators/imageOperatorChoice';
import { IMAGE_OPERATORS } from '../operators/imageOperators';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { compileAnalogSignalGraph } from '../operators/analogSignalGraph';
import type { ImageOperatorPreviewTarget } from './imageOperatorPreviewStages';
import { applyParameterSourcesToEffects } from '../parameterSources/parameterSourceRendering';
import { isParameterNodeDriven } from '../parameterSources/parameterSourceTargets';

type PreviewValue = NonNullable<PreviewFrame['values']>[number];
type ScalarPreview = { graph: EffectOperatorGraph; selected: EffectOperatorGraph['nodes'][number];
  evaluate: () => number | undefined; values: PreviewValue[] };
const EMPTY_KEYS: Keyframe[] = [];
const preparedPreviews = new WeakMap<Effect, { signature: string; graph: EffectOperatorGraph;
  keys?: Keyframe[]; time?: number; controls?: TimelineClip; compiler?: ImageOperatorPreviewCompiler; values: Map<string, ScalarPreview | undefined> }>();

/** All visible ports of an unchanged effect share its validated graph and scalar
 * results. Folding, panning and retrying a texture tap must not rebuild its shader. */
function preparedPreview(effect: Effect) {
  const signature = JSON.stringify([effect.type, effect.params, effect.operatorGraph]);
  let prepared = preparedPreviews.get(effect);
  if (!prepared || prepared.signature !== signature) {
    prepared = { signature, graph: effectOperatorGraph(effect), values: new Map() };
    preparedPreviews.set(effect, prepared);
  }
  return prepared;
}

const previewOperatorIds = new Set([...IMAGE_OPERATORS.map(operator => operator.id), 'values.number', 'values.boolean', 'values.color', 'values.choice']);

/** Adapts a reachable generic numeric island to the canonical image evaluator without
 * assigning values to Analog runtime boundaries. The dummy image path only satisfies
 * the image-plan container and is never evaluated by a numeric preview target. */
function numericPreviewGraph(graph: EffectOperatorGraph, selectedId: string, params: Record<string, unknown>): {
  graph: EffectOperatorGraph; params: Record<string, unknown>; context?: ImageOperatorCompileContext;
} | undefined {
  if (graph.domain === 'image') return { graph, params };
  if (graph.domain !== 'analog-signal') return;
  let canonical: { graph: EffectOperatorGraph; params: Record<string, unknown>; context: ImageOperatorCompileContext } | undefined;
  try {
    canonical = compileAnalogSignalGraph(graph, params).stages.find(stage => stage.imagePreview?.graph.nodes.some(node => node.id === selectedId))?.imagePreview;
  } catch { /* An incomplete owner may still expose an isolated editable literal. */ }
  if (canonical) return canonical;
  const byId = new Map(graph.nodes.map(node => [node.id, node])), included = new Set<string>();
  const visit = (id: string): boolean => {
    if (included.has(id)) return true;
    const node = byId.get(id);
    if (!node || !previewOperatorIds.has(node.operator)) return false;
    included.add(id);
    return graph.edges.filter(edge => edge.to === id).every(edge => visit(edge.from));
  };
  if (!visit(selectedId)) return;
  const occupied = new Set(graph.nodes.map(node => node.id));
  const unique = (base: string) => { let id = base, suffix = 1; while (occupied.has(id)) id = `${base}-${suffix++}`; occupied.add(id); return id; };
  const frame = unique('__preview-frame'), output = unique('__preview-output');
  return { params, graph: { version: 1, schemaVersion: 1, domain: 'image', nodes: [
    ...graph.nodes.filter(node => included.has(node.id)),
    { id: frame, operator: 'image.frame', operatorVersion: 1, bindings: {} },
    { id: output, operator: 'image.output', operatorVersion: 1, bindings: {} },
  ], edges: [...graph.edges.filter(edge => included.has(edge.from) && included.has(edge.to)),
    { id: unique('__preview-edge'), from: frame, output: 'image', to: output, input: 'image' }], layout: {} } };
}

export type ImageOperatorPreviewCompiler = (graph: EffectOperatorGraph, params: Record<string, unknown>,
  target: ImageOperatorPreviewTarget) => ReturnType<typeof compileImageOperatorPreview>;

function imageScalarValues(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number,
  compilePreview?: ImageOperatorPreviewCompiler, clip?: TimelineClip): ScalarPreview | undefined {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return undefined;
  const definition = getEffectOperator(binding.operator);
  if (!definition || ![...definition.inputs, ...definition.outputs].some(port => port.type === 'number')) return undefined;
  const prepared = preparedPreview(effect), sampledKeys = keys.length ? keys : EMPTY_KEYS, sampledTime = keys.length || clip?.nodeGraph?.parameterSources ? time : 0;
  // The clip only affects values through parameter sources. Folding, layout and
  // other graph-view edits replace the clip object and must not recompile every value.
  const controls = clip?.nodeGraph?.parameterSources ? clip : undefined;
  if (prepared.keys !== sampledKeys || prepared.time !== sampledTime || prepared.compiler !== compilePreview || prepared.controls !== controls) {
    prepared.keys = sampledKeys; prepared.time = sampledTime; prepared.controls = controls; prepared.compiler = compilePreview; prepared.values.clear();
  }
  if (!prepared.values.has(binding.nodeId)) prepared.values.set(binding.nodeId,
    evaluateScalarValues(request, effect, keys, time, prepared.graph, compilePreview, clip));
  return prepared.values.get(binding.nodeId);
}

function evaluateScalarValues(request: PreviewRequest, effect: Effect, keys: Keyframe[], time: number,
  ownerGraph: EffectOperatorGraph, compilePreview?: ImageOperatorPreviewCompiler, clip?: TimelineClip): ScalarPreview | undefined {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return undefined;
  const selected = ownerGraph.nodes.find(node => node.id === binding.nodeId);
  const params = { ...effectOperatorParams(effect) };
  if (!selected) return undefined;
  for (const node of ownerGraph.nodes) if (['values.number', 'values.integer'].includes(node.operator) && typeof node.bindings.value === 'string') {
    params[node.bindings.value] = sampleOperatorParameter(node, 'value', params, effect.id, keys, time);
  }
  if (clip?.nodeGraph?.parameterSources) Object.assign(params, applyParameterSourcesToEffects(clip, keys, time, [{ ...effect, params: params as Effect['params'] }])[0].params);
  const preview = compilePreview ? { graph: ownerGraph, params } : numericPreviewGraph(ownerGraph, selected.id, params);
  if (!preview) return undefined;
  const graph = preview.graph; Object.assign(params, preview.params);
  const definition = getEffectOperator(selected.operator)!;
  if (![...definition.inputs, ...definition.outputs].some(port => port.type === 'number')) return undefined;
  const evaluatePort = (portId: string, direction: 'input' | 'output'): number | undefined => {
    try {
      const target = { effectId: effect.id, nodeId: selected.id, portId, direction };
      const plan = compilePreview?.(graph, params, target)
        ?? compileImageOperatorPreview(graph, params, target,
          ('context' in preview ? preview.context : undefined) ?? effectOperatorCompileContext(effect));
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

export function imageOperatorKnownValues(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [],
  time = Math.max(0, request.time - clip.startTime), compilePreview?: ImageOperatorPreviewCompiler): PreviewValue[] {
  return imageScalarValues(request, effect, keys, time, compilePreview, clip)?.values.filter(value => value.value !== undefined) ?? [];
}

/** Numeric previews evaluate canonical bindings without persisting duplicate parameter values. */
export function imageOperatorValuePreview(request: PreviewRequest, clip: TimelineClip, effect: Effect, keys: Keyframe[] = [],
  time = Math.max(0, request.time - clip.startTime), compilePreview?: ImageOperatorPreviewCompiler): PreviewFrame | undefined {
  const binding = request.node.binding;
  if (binding?.kind === 'effect-operator') {
    const selected = preparedPreview(effect).graph.nodes.find(node => node.id === binding.nodeId);
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
  const scalar = imageScalarValues(request, effect, keys, time, compilePreview, clip); if (!scalar) return undefined;
  const { selected, evaluate, values } = scalar;
  // Per-pixel operands and results must be rendered by the canonical image IR.
  const requestedValue = request.port ? values.find(value => value.direction === request.port!.direction && value.portId === request.port!.id)?.value : evaluate();
  const numericValue = selected.operator === 'values.number' || selected.operator === 'values.integer';
  if (!numericValue && requestedValue === undefined) return undefined;
  const controls: PreviewValueControl[] = [];
  if (numericValue && typeof selected.constants?.value === 'number' && selected.bindings.value === undefined) {
    const spec = getEffectOperator(selected.operator)!.parameters.find(parameter => parameter.id === 'value')!;
    controls.push({ label: spec.label, value: selected.operator === 'values.integer' ? Math.trunc(selected.constants.value) : selected.constants.value, defaultValue: Number(spec.default),
      min: Math.min(spec.min ?? -30, selected.constants.value), max: Math.max(spec.max ?? 30, selected.constants.value), step: spec.step,
      portId: 'value', direction: 'output', target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value', storage: 'constant' } });
  } else if (numericValue && typeof selected.bindings.value === 'string') {
    const binding = selected.bindings.value, owner = getEffect(effect.type)?.params[binding];
    const current = evaluate();
    if (owner?.type === 'number' && current !== undefined && !isParameterNodeDriven(clip, `effect.${effect.id}.${binding}`)) controls.push({ label: owner.label, value: current, defaultValue: Number(owner.default),
      min: owner.min, max: owner.max, step: selected.operator === 'values.integer' ? 1 : owner.step, portId: 'value', direction: 'output', persistenceKey: `operator.${effect.id}.${binding}`,
      target: { clipId: clip.id, effectId: effect.id, nodeId: selected.id, parameter: 'value' } });
  }
  const output = typeof requestedValue === 'number' ? requestedValue : evaluate();
  return { key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Live values', controls, values,
    drawing: { kind: 'number', value: output === undefined ? '—' : String(Number(output.toFixed(4))), caption: numericValue ? 'Value' : 'Result' } };
}
