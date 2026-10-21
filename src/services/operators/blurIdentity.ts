import { blurPixelScale, directionalBlurStreakPx } from '../../effects/blur/blurSampling';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, readEffectGraph } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph } from './blurEffectGraphs';
import { createDefaultMotionBlurGraph, createDefaultRadialBlurGraph, createDefaultZoomBlurGraph } from './directionalBlurEffectGraphs';
import { isUpgradableBlurEffectType, upgradeBlurGraph, type UpgradableBlurEffectType } from './blurGraphUpgrade';

const RECIPES: Record<UpgradableBlurEffectType, () => EffectOperatorGraph> = {
  'gaussian-blur': createDefaultGaussianBlurGraph, 'box-blur': createDefaultBoxBlurGraph, 'motion-blur': createDefaultMotionBlurGraph,
  'radial-blur': createDefaultRadialBlurGraph, 'zoom-blur': createDefaultZoomBlurGraph,
};
const recipes = new Map<string, EffectOperatorGraph>();
const recipeCopies = new WeakMap<EffectOperatorGraph, Map<string, boolean>>();

/** True when the saved graph is the current or the legacy recipe (layout and packing ignored). */
function isRecipeGraph(type: UpgradableBlurEffectType, saved: EffectOperatorGraph): boolean {
  const known = recipeCopies.get(saved)?.get(type);
  if (known !== undefined) return known;
  let recipe = recipes.get(type);
  if (!recipe) { recipe = RECIPES[type](); recipes.set(type, recipe); }
  const result = upgradeBlurGraph(type, saved) !== saved || matchesEffectRecipe(saved, recipe);
  const byType = recipeCopies.get(saved) ?? new Map<string, boolean>();
  byType.set(type, result); recipeCopies.set(saved, byType);
  return result;
}

/** Recipe checks of graphs saved in the legacy `params.operatorGraph` string, by type and string. */
const legacyRecipes = new Map<string, boolean>();

/** True when the instance runs the built-in recipe: no saved graph, or a saved copy of the current or legacy recipe. */
function runsRecipe(type: UpgradableBlurEffectType, effect: { params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): boolean {
  if (effect.operatorGraph) return isRecipeGraph(type, effect.operatorGraph);
  const legacy = effect.params[EFFECT_GRAPH_PARAM];
  if (legacy === undefined || legacy === '') return true;
  if (typeof legacy !== 'string') return false;
  const key = `${type}\n${legacy}`;
  let result = legacyRecipes.get(key);
  if (result === undefined) {
    try { result = isRecipeGraph(type, readEffectGraph(legacy, RECIPES[type])); } catch { result = false; }
    if (legacyRecipes.size >= 64) legacyRecipes.clear();
    legacyRecipes.set(key, result);
  }
  return result;
}

/**
 * A blur at zero strength renders its input unchanged: the pipeline skips it instead of running
 * its passes (the legacy shaders short-circuited too). Only for the built-in recipe, because an
 * edited graph may do more than blur. Thresholds keep the skipped result within 1/4 of an 8-bit step.
 */
export function isNeutralBlurEffect(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph },
  width: number, height: number): boolean {
  const type = effect.type;
  if (!isUpgradableBlurEffectType(type)) return false;
  if (!runsRecipe(type, effect)) return false;
  if (type === 'gaussian-blur' || type === 'box-blur') {
    const radius = effect.params.radius;
    if (typeof radius !== 'number' || !Number.isFinite(radius)) return false;
    // Gaussian: sigma 0.1 px weighs a neighbour exp(-50); Box: the neighbour weight is the radius in px.
    return Math.max(0, radius) * blurPixelScale(width, height) <= (type === 'gaussian-blur' ? 0.2 : 1e-3);
  }
  const amount = effect.params.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  return directionalBlurStreakPx(type, effect.params, width, height) <= 1e-3;
}
