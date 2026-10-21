import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from './uvDistortRecipes';

type NeutralCheckedType = 'wave' | 'twirl' | 'bulge';
const RECIPES: Record<NeutralCheckedType, () => EffectOperatorGraph> = {
  wave: createDefaultWaveGraph, twirl: createDefaultTwirlGraph, bulge: createDefaultBulgeGraph,
};
const recipes = new Map<NeutralCheckedType, EffectOperatorGraph>();
const recipeCopies = new WeakMap<EffectOperatorGraph, boolean>();
const isChecked = (type: string): type is NeutralCheckedType => Object.hasOwn(RECIPES, type);

function isRecipeGraph(type: NeutralCheckedType, saved: EffectOperatorGraph): boolean {
  const known = recipeCopies.get(saved);
  if (known !== undefined) return known;
  let recipe = recipes.get(type);
  if (!recipe) { recipe = RECIPES[type](); recipes.set(type, recipe); }
  const result = !saved.incomplete && !saved.groups?.some(group => group.bypassed) && matchesEffectRecipe(saved, recipe);
  recipeCopies.set(saved, result);
  return result;
}

const exactly = (value: unknown, target: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value - target) <= 1e-6;

type UvDistortEffectLike = { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };

/** The effect renders the untouched built-in Wave, Twirl or Bulge recipe (no stored graph, or an unedited copy). */
export function rendersBuiltInUvDistortRecipe(effect: UvDistortEffectLike): boolean {
  const type = effect.type;
  if (!isChecked(type)) return false;
  return effect.operatorGraph ? isRecipeGraph(type, effect.operatorGraph) : effect.params[EFFECT_GRAPH_PARAM] === undefined;
}

/**
 * Wave with no height, Twirl with no twist and Bulge & Pinch at Amount 1 return their input
 * unchanged: the pipeline skips them instead of running the premultiply and sample passes.
 * Only for the built-in recipe, because an edited graph may do more than distort.
 */
export function isNeutralUvDistortEffect(effect: UvDistortEffectLike): boolean {
  const type = effect.type;
  if (!rendersBuiltInUvDistortRecipe(effect)) return false;
  if (type === 'wave') return exactly(effect.params.amplitudeX, 0) && exactly(effect.params.amplitudeY, 0);
  return exactly(effect.params.amount, type === 'bulge' ? 1 : 0);
}
