import type { LayerRenderData } from '../core/types';
import type { SceneLayer3DData } from './types';

/** Lights contribute illumination, not another image that would disable the object's effect stack. */
export function sceneCompositeStyle(data: LayerRenderData[], scene: SceneLayer3DData[], sourceEffectsApplied: boolean) {
  const visuals = scene.filter(layer => layer.kind !== 'light');
  const visual = visuals.length === 1 ? visuals[0] : undefined;
  const owner = visual && data.find(entry => entry.layer.id === visual.layerId)?.layer;
  const applied = new Set(sourceEffectsApplied ? visual?.layerSpaceEffects?.map(effect => effect.id) : []);
  if (sourceEffectsApplied && visual?.kind === 'plane' && visual.slitScanGeometry) {
    for (const effect of visual.postProjectionEffects ?? []) applied.add(effect.id);
  }
  return {
    sourceClipId: owner?.sourceClipId,
    // Slit Scan's native surface already applies clip opacity to its pixels.
    opacity: visual?.kind === 'plane' && visual.slitScanGeometry ? 1 : owner?.opacity ?? 1,
    blendMode: owner?.blendMode ?? 'normal' as const,
    colorCorrection: owner?.colorCorrection,
    effects: (owner?.effects ?? []).filter(effect => !(effect.enabled && (applied.has(effect.id)
      || ((visual?.kind === 'face-cables' || visual?.surfacePlan) && effect.type === 'face-cables' && effect.params.scene3D)
      || (visual?.kind === 'voxel' && effect.type === 'voxel-relief')))),
  };
}
