import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyAcuarelaGraph, hasLegacyAcuarelaParams } from './acuarelaEffectGraph';
import { createDefaultAcuarelaGraph } from './acuarelaWatercolorGraph';

let recipe: EffectOperatorGraph | undefined;
const recipeCopies = new WeakMap<EffectOperatorGraph, boolean>();

/** True when the instance renders the built-in watercolour recipe (no saved graph, or an untouched saved copy). */
export function rendersBuiltInAcuarelaRecipe(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): boolean {
  if (effect.type !== 'acuarela') return false;
  if (!effect.operatorGraph) return effect.params[EFFECT_GRAPH_PARAM] === undefined && !hasLegacyAcuarelaParams(effect.params);
  let known = recipeCopies.get(effect.operatorGraph);
  if (known === undefined) {
    recipe ??= createDefaultAcuarelaGraph();
    known = matchesEffectRecipe(effect.operatorGraph, recipe);
    recipeCopies.set(effect.operatorGraph, known);
  }
  return known;
}

/** Mix 0 returns the original picture: the pipeline skips the three passes. */
export function isNeutralAcuarelaEffect(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): boolean {
  const mix = effect.params.opacity;
  return typeof mix === 'number' && mix <= 0 && rendersBuiltInAcuarelaRecipe(effect);
}

/**
 * A custom Look (or other params-only copy) saved with the smoke Acuarela lacks the watercolour
 * values. Instantiating it fills those defaults, which would switch it to the watercolour recipe;
 * the copy carries the smoke recipe as its graph instead, so the Look keeps its appearance.
 */
export function withLegacyAcuarelaGraph<T extends Record<string, unknown>>(type: string, params: T): T {
  if (type !== 'acuarela' || params[EFFECT_GRAPH_PARAM] !== undefined || !hasLegacyAcuarelaParams(params)) return params;
  return { ...params, [EFFECT_GRAPH_PARAM]: JSON.stringify(createLegacyAcuarelaGraph()) };
}
