import type { LayerRenderData } from '../core/types';
import type { SceneLayer3DData } from './types';

/** Lights contribute illumination, not another image that would disable the object's effect stack. */
export function sceneCompositeStyle(data: LayerRenderData[], scene: SceneLayer3DData[], sourceEffectsApplied: boolean) {
  const visuals = scene.filter(layer => layer.kind !== 'light');
  const visual = visuals.length === 1 ? visuals[0] : undefined;
  const owner = visual && data.find(entry => entry.layer.id === visual.layerId)?.layer;
  const applied = new Set(sourceEffectsApplied ? visual?.layerSpaceEffects?.map(effect => effect.id) : []);
  return {
    opacity: owner?.opacity ?? 1,
    blendMode: owner?.blendMode ?? 'normal' as const,
    colorCorrection: owner?.colorCorrection,
    effects: (owner?.effects ?? []).filter(effect => !(effect.enabled && (applied.has(effect.id)
      || (visual?.kind === 'face-cables' && effect.type === 'face-cables')
      || (visual?.kind === 'voxel' && effect.type === 'voxel-relief')))),
  };
}
