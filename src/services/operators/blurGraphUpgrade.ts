import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph } from './blurEffectGraphs';
import { createDefaultMotionBlurGraph, createDefaultRadialBlurGraph, createDefaultZoomBlurGraph, createEvenTapDirectionalBlurGraph } from './directionalBlurEffectGraphs';
import { createLegacyBoxBlurGraph, createLegacyGaussianBlurGraph } from './legacyBlurEffectGraphs';
import { createLegacyMotionBlurGraph, createLegacyRadialBlurGraph, createLegacyZoomBlurGraph } from './legacyDirectionalBlurEffectGraphs';

export type UpgradableBlurEffectType = 'box-blur' | 'gaussian-blur' | 'motion-blur' | 'radial-blur' | 'zoom-blur';

/** Earlier recipes per effect: the single-pass legacy graph, and for the directional blurs the 3.2.7 two-stage graph. */
const RECIPES: Record<UpgradableBlurEffectType, { earlier: Array<() => EffectOperatorGraph>; current: () => EffectOperatorGraph }> = {
  'box-blur': { earlier: [createLegacyBoxBlurGraph], current: createDefaultBoxBlurGraph },
  'gaussian-blur': { earlier: [createLegacyGaussianBlurGraph], current: createDefaultGaussianBlurGraph },
  'motion-blur': { earlier: [createLegacyMotionBlurGraph, () => createEvenTapDirectionalBlurGraph('motion-blur')], current: createDefaultMotionBlurGraph },
  'radial-blur': { earlier: [createLegacyRadialBlurGraph, () => createEvenTapDirectionalBlurGraph('radial-blur')], current: createDefaultRadialBlurGraph },
  'zoom-blur': { earlier: [createLegacyZoomBlurGraph, () => createEvenTapDirectionalBlurGraph('zoom-blur')], current: createDefaultZoomBlurGraph },
};
const earlierGraphs = new Map<UpgradableBlurEffectType, EffectOperatorGraph[]>();
const upgraded = new WeakMap<EffectOperatorGraph, Map<string, EffectOperatorGraph>>();

export function isUpgradableBlurEffectType(type: string): type is UpgradableBlurEffectType {
  return Object.hasOwn(RECIPES, type);
}

/**
 * Replace an untouched saved earlier blur graph (any presentation: packed compositions, folders,
 * layout) with the current recipe: the single-pass legacy graphs, and the 3.2.7 two-stage Motion,
 * Zoom and Radial graphs, whose stage A jumped when an animated amount changed its tap count (a bug
 * fix; still pictures differ by well under a level on average). Graphs with edited nodes, wiring,
 * exposed values or bypassed folders are user work and stay as saved.
 */
export function upgradeBlurGraph(type: UpgradableBlurEffectType, source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source)?.get(type); if (known) return known;
  let earlier = earlierGraphs.get(type);
  if (!earlier) { earlier = RECIPES[type].earlier.map(create => create()); earlierGraphs.set(type, earlier); }
  const result = earlier.some(graph => matchesEffectRecipe(source, graph)) ? RECIPES[type].current() : source;
  const byType = upgraded.get(source) ?? new Map<string, EffectOperatorGraph>();
  byType.set(type, result); upgraded.set(source, byType);
  return result;
}
