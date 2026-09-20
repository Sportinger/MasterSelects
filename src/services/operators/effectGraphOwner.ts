import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { cableOperatorGraph, compileCableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { compileVoxelGraph, voxelOperatorGraph } from './voxelGraph';
import { isVoxelOperator, VOXEL_OPERATORS } from './voxelOperators';
import { SCENE_OPERATORS } from './sceneOperators';
import { EFFECT_OPERATORS, getEffectOperator } from './operatorRegistry';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { SCALAR_FIELD_OPERATORS } from './scalarField';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';

export function hasEffectOperatorGraph(type: string): boolean { return type === 'face-cables' || type === 'voxel-relief'; }
export function effectOperatorGraph(effect: Pick<Effect, 'type' | 'params'>): EffectOperatorGraph {
  if (effect.type === 'voxel-relief') return voxelOperatorGraph(effect.params);
  if (effect.type === 'face-cables') return cableOperatorGraph(effect.params);
  throw new Error('This effect has no operator graph.');
}
export function validateEffectOwnerGraph(effect: Pick<Effect, 'type'>, graph: EffectOperatorGraph, params: Record<string, unknown>) {
  const next = { ...params, [EFFECT_GRAPH_PARAM]: JSON.stringify(graph) };
  if (effect.type === 'voxel-relief') compileVoxelGraph(next);
  else compileCableOperatorGraph(next);
}
export function addableEffectOperators(type: string) {
  return EFFECT_OPERATORS.filter(operator => operator.addable && (type === 'voxel-relief' ? isVoxelOperator(operator.id)
    : type === 'face-cables' && !SCENE_OPERATORS.includes(operator) && !VOXEL_OPERATORS.includes(operator) && !SCALAR_FIELD_OPERATORS.includes(operator)));
}

export function effectOperatorParams(effect: Pick<Effect, 'type' | 'params'>): Record<string, unknown> {
  if (effect.type !== 'voxel-relief') return effect.params;
  const defaults: Record<string, unknown> = Object.fromEntries(Object.entries(VOXEL_RELIEF_PARAMS).map(([id, spec]) => [id, spec.default]));
  for (const node of effectOperatorGraph(effect).nodes) for (const spec of getEffectOperator(node.operator)!.parameters) {
    const binding = node.bindings[spec.id];
    if (typeof binding === 'string' && defaults[binding] === undefined) defaults[binding] = spec.default;
  }
  return { ...defaults, ...effect.params };
}
export function canRemoveEffectOperator(type: string, nodeId: string, operatorId: string): boolean {
  return type === 'voxel-relief' ? operatorId !== 'render.voxel' && operatorId !== 'image.frame'
    : nodeId !== 'wind' && !!getEffectOperator(operatorId)?.addable;
}
