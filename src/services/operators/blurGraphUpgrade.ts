import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph } from './blurEffectGraphs';
import { createDefaultMotionBlurGraph, createDefaultRadialBlurGraph, createDefaultZoomBlurGraph } from './directionalBlurEffectGraphs';
import { createLegacyBoxBlurGraph, createLegacyGaussianBlurGraph } from './legacyBlurEffectGraphs';
import { createLegacyMotionBlurGraph, createLegacyRadialBlurGraph, createLegacyZoomBlurGraph } from './legacyDirectionalBlurEffectGraphs';

export type UpgradableBlurEffectType = 'box-blur' | 'gaussian-blur' | 'motion-blur' | 'radial-blur' | 'zoom-blur';

const RECIPES: Record<UpgradableBlurEffectType, { legacy: () => EffectOperatorGraph; current: () => EffectOperatorGraph }> = {
  'box-blur': { legacy: createLegacyBoxBlurGraph, current: createDefaultBoxBlurGraph },
  'gaussian-blur': { legacy: createLegacyGaussianBlurGraph, current: createDefaultGaussianBlurGraph },
  'motion-blur': { legacy: createLegacyMotionBlurGraph, current: createDefaultMotionBlurGraph },
  'radial-blur': { legacy: createLegacyRadialBlurGraph, current: createDefaultRadialBlurGraph },
  'zoom-blur': { legacy: createLegacyZoomBlurGraph, current: createDefaultZoomBlurGraph },
};
const legacyGraphs = new Map<UpgradableBlurEffectType, EffectOperatorGraph>();
const upgraded = new WeakMap<EffectOperatorGraph, Map<string, EffectOperatorGraph>>();

export function isUpgradableBlurEffectType(type: string): type is UpgradableBlurEffectType {
  return Object.hasOwn(RECIPES, type);
}

/**
 * Replace an untouched saved single-pass blur graph (any presentation: packed compositions,
 * folders, layout) with the current recipe. Graphs with edited nodes, wiring, exposed values
 * or bypassed folders are user work and stay as saved.
 */
export function upgradeBlurGraph(type: UpgradableBlurEffectType, source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source)?.get(type); if (known) return known;
  let legacy = legacyGraphs.get(type);
  if (!legacy) { legacy = RECIPES[type].legacy(); legacyGraphs.set(type, legacy); }
  const result = matchesEffectRecipe(source, legacy) ? RECIPES[type].current() : source;
  const byType = upgraded.get(source) ?? new Map<string, EffectOperatorGraph>();
  byType.set(type, result); upgraded.set(source, byType);
  return result;
}
