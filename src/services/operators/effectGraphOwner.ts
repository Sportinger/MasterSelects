import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { cableOperatorGraph, compileCableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { compileVoxelGraph, voxelOperatorGraph } from './voxelGraph';
import { isVoxelOperator, VOXEL_OPERATORS } from './voxelOperators';
import { SCENE_OPERATORS } from './sceneOperators';
import { EFFECT_OPERATORS, getEffectOperator } from './operatorRegistry';
import { EFFECT_GRAPH_PARAM, readEffectGraph, validateEffectGraph } from './effectGraph';
import { SCALAR_FIELD_OPERATORS } from './scalarField';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';
import { compileImageOperatorGraph, createDefaultInvertImageGraph, migrateImageOperatorGraph } from './imageOperatorGraph';
import { IMAGE_OPERATORS } from './imageOperators';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from './analogSignalGraph';
import { ANALOG_SIGNAL_OPERATORS } from './analogSignalOperators';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from './colorEffectGraphs';
import { getEffect } from '../../effects';
import { createDefaultPointwiseEffectGraph, type EditablePointwiseEffectType } from './pointwiseEffectGraphs';

const LOCAL_IMAGE_EFFECTS = new Set(['invert', 'brightness', 'contrast', 'saturation', 'exposure', 'levels', 'hue-shift', 'temperature', 'vibrance', 'threshold', 'posterize']);
export function isLocalImageEffectType(type: string): type is 'invert' | EditableColorEffectType | EditablePointwiseEffectType { return LOCAL_IMAGE_EFFECTS.has(type); }
export function hasEffectOperatorGraph(type: string): boolean { return type === 'face-cables' || type === 'voxel-relief' || isLocalImageEffectType(type) || type === 'analog-signal-lab'; }
type EffectGraphOwner = { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };

export function effectOperatorCompileParams(effect: Pick<EffectGraphOwner, 'params' | 'operatorGraph'>): Record<string, unknown> {
  return effect.operatorGraph
    ? { ...effect.params, [EFFECT_GRAPH_PARAM]: JSON.stringify(effect.operatorGraph) }
    : effect.params;
}

export function effectOperatorGraph(effect: EffectGraphOwner): EffectOperatorGraph {
  if (effect.type === 'analog-signal-lab') {
    const graph = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], createDefaultAnalogSignalGraph);
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    if (!graph.incomplete) compileAnalogSignalGraph(graph, effect.params);
    return graph;
  }
  const effectType = effect.type;
  if (isLocalImageEffectType(effectType)) {
    const fallback = effectType === 'invert' ? createDefaultInvertImageGraph
      : effectType === 'threshold' || effectType === 'posterize' ? () => createDefaultPointwiseEffectGraph(effectType)
        : () => createDefaultColorEffectGraph(effectType);
    const saved = effect.operatorGraph ?? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], fallback);
    const graph = migrateImageOperatorGraph(saved);
    const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
    if (errors.length) throw new Error(errors[0]);
    if (!graph.incomplete) compileImageOperatorGraph(graph, effectOperatorParams(effect));
    return graph;
  }
  const params = effectOperatorCompileParams(effect);
  if (effect.type === 'voxel-relief') return voxelOperatorGraph(params);
  if (effect.type === 'face-cables') return cableOperatorGraph(params);
  throw new Error('This effect has no operator graph.');
}

/** Converts the former JSON parameter into the canonical effect-owned field.
 * Canonical data always wins, but is still validated before it can enter runtime state. */
export function migratePersistedEffectOperatorGraph(effect: Effect): Effect {
  const legacy = effect.params[EFFECT_GRAPH_PARAM];
  if (!hasEffectOperatorGraph(effect.type)) {
    if (effect.operatorGraph || legacy !== undefined) throw new Error(`Effect ${effect.id} does not support an operator graph.`);
    return effect;
  }
  const graph = effectOperatorGraph(effect);
  const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  const versionedGraph: EffectOperatorGraph = {
    ...graph,
    schemaVersion: 1,
    nodes: graph.nodes.map(node => ({ ...node, operatorVersion: node.operatorVersion ?? 1 })),
  };
  if (!versionedGraph.incomplete) validateEffectOwnerGraph(effect, versionedGraph, effect.params);
  const params = { ...effect.params };
  delete params[EFFECT_GRAPH_PARAM];
  return { ...effect, params, operatorGraph: structuredClone(versionedGraph) };
}
export function validateEffectOwnerGraph(effect: Pick<Effect, 'type'>, graph: EffectOperatorGraph, params: Record<string, unknown>) {
  const next = { ...params, [EFFECT_GRAPH_PARAM]: JSON.stringify(graph) };
  if (effect.type === 'voxel-relief') compileVoxelGraph(next);
  else if (effect.type === 'face-cables') compileCableOperatorGraph(next);
  else if (isLocalImageEffectType(effect.type)) compileImageOperatorGraph(graph, effectOperatorParams({ type: effect.type, params }));
  else if (effect.type === 'analog-signal-lab') compileAnalogSignalGraph(graph, params);
  else throw new Error('This effect has no operator graph.');
}
export function addableEffectOperators(type: string) {
  if (type === 'analog-signal-lab') return ANALOG_SIGNAL_OPERATORS.filter(operator => operator.addable);
  if (isLocalImageEffectType(type)) {
    const shared = ['image.frame', 'values.number'].flatMap(id => {
      const operator = getEffectOperator(id); return operator ? [operator] : [];
    });
    return [...shared, ...IMAGE_OPERATORS.filter(operator => operator.addable)];
  }
  return EFFECT_OPERATORS.filter(operator => operator.addable && (type === 'voxel-relief' ? isVoxelOperator(operator.id)
    : type === 'face-cables' && !SCENE_OPERATORS.includes(operator) && !VOXEL_OPERATORS.includes(operator) && !SCALAR_FIELD_OPERATORS.includes(operator)));
}

export function effectOperatorParams(effect: EffectGraphOwner): Record<string, unknown> {
  if (isLocalImageEffectType(effect.type)) {
    const definition = getEffect(effect.type);
    const defaults = Object.fromEntries(Object.entries(definition?.params ?? {}).map(([id, spec]) => [id, spec.default]));
    return { ...defaults, ...effect.params };
  }
  if (effect.type !== 'voxel-relief') return effect.params;
  const defaults: Record<string, unknown> = Object.fromEntries(Object.entries(VOXEL_RELIEF_PARAMS).map(([id, spec]) => [id, spec.default]));
  for (const node of effectOperatorGraph(effect).nodes) for (const spec of getEffectOperator(node.operator)!.parameters) {
    const binding = node.bindings[spec.id];
    if (typeof binding === 'string' && defaults[binding] === undefined) defaults[binding] = spec.default;
  }
  return { ...defaults, ...effect.params };
}
export function canRemoveEffectOperator(type: string, nodeId: string, operatorId: string): boolean {
  if (type === 'analog-signal-lab') return !['frame', 'output'].includes(nodeId) && !!getEffectOperator(operatorId)?.addable;
  return type === 'voxel-relief' ? operatorId !== 'render.voxel' && operatorId !== 'image.frame'
    : nodeId !== 'wind' && !!getEffectOperator(operatorId)?.addable;
}
