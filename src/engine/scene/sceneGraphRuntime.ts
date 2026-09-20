import type { SceneOperatorGraph, SceneSurfacePlan } from '../../types/operatorGraph';
import type { SceneLayer3DData } from './types';
import { compileSceneGraph } from '../../services/operators/sceneGraph';
import { Logger } from '../../services/logger';
import { scenePrimitiveMeshType } from '../../services/operators/scenePrimitive';

const plans = new WeakMap<SceneOperatorGraph, SceneSurfacePlan | null>();
/** Shared by preview, nested compositions and export; never reads timeline stores. */
export function applySceneOperatorGraph(layer: SceneLayer3DData, definition?: SceneOperatorGraph): SceneLayer3DData {
  if (!definition || (layer.kind !== 'plane' && layer.kind !== 'face-cables')) return layer;
  if (!plans.has(definition)) {
    try { plans.set(definition, compileSceneGraph(definition)); }
    catch (error) { plans.set(definition, null); Logger.create('SceneGraph').warn('Invalid scene graph; object muted', String(error)); }
  }
  const plan = plans.get(definition);
  if (!plan) return { ...layer, opacity: 0 };
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const worldMatrix = plan.applyClipTransform ? layer.worldMatrix : identity;
  const opacity = layer.opacity * (plan.visible ? plan.opacity : 0);
  if (plan.geometry === 'primitive') {
    const meshType = scenePrimitiveMeshType(plan.primitiveShape ?? 'box');
    if (layer.kind === 'plane') return { ...layer, kind: 'primitive', meshType, worldMatrix, opacity, surfacePlan: plan };
    return { ...layer, kind: 'primitive', meshType, worldMatrix, opacity, surfacePlan: plan };
  }
  if (layer.kind === 'plane') return { ...layer, kind: 'plane', worldMatrix, opacity, surfacePlan: plan };
  if (plan.geometry === 'plane') {
    const { cableParams: discardedCableParams, ...planeLayer } = layer;
    void discardedCableParams;
    return { ...planeLayer, kind: 'plane', worldMatrix, opacity, surfacePlan: plan };
  }
  const cableParams = { ...layer.cableParams, cableClipTransformBypassed: !plan.applyClipTransform };
  return { ...layer, kind: 'face-cables', cableParams, worldMatrix, opacity, surfacePlan: plan };
}
