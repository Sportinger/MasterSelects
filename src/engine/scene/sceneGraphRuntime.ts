import type { SceneOperatorGraph, SceneSurfacePlan } from '../../types/operatorGraph';
import type { SceneLayer3DData } from './types';
import { compileSceneGraph } from '../../services/operators/sceneGraph';
import { Logger } from '../../services/logger';

const plans = new WeakMap<SceneOperatorGraph, SceneSurfacePlan | null>();
/** Shared by preview, nested compositions and export; never reads timeline stores. */
export function applySceneOperatorGraph(layer: SceneLayer3DData, definition?: SceneOperatorGraph): SceneLayer3DData {
  if (!definition || !['plane', 'face-cables'].includes(layer.kind)) return layer;
  if (!plans.has(definition)) {
    try { plans.set(definition, compileSceneGraph(definition)); }
    catch (error) { plans.set(definition, null); Logger.create('SceneGraph').warn('Invalid scene graph; object muted', String(error)); }
  }
  const plan = plans.get(definition);
  if (!plan) return { ...layer, opacity: 0 };
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { ...layer, ...(plan.geometry === 'plane' ? { kind: 'plane' as const } : {}),
    ...(layer.kind === 'face-cables' ? { cableParams: { ...layer.cableParams, cableClipTransformBypassed: !plan.applyClipTransform } } : {}),
    worldMatrix: plan.applyClipTransform ? layer.worldMatrix : identity,
    opacity: layer.opacity * (plan.visible ? plan.opacity : 0), surfacePlan: plan };
}
