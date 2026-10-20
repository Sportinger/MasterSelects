import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, readEffectGraph } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyBulgeGraph, createLegacyTwirlGraph, createLegacyWaveGraph } from './legacyUvDistortEffectGraphs';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from './uvDistortRecipes';

type UpgradableUvDistortType = 'wave' | 'twirl' | 'bulge';
const RECIPES: Record<UpgradableUvDistortType, { legacy: () => EffectOperatorGraph; current: () => EffectOperatorGraph;
  /** Values of the new controls that reproduce the original look exactly (Bulge: framing only). */
  legacyParams: Record<string, number | string> }> = {
  wave: { legacy: createLegacyWaveGraph, current: createDefaultWaveGraph, legacyParams: { speed: 0, phase: 0, edges: 'clamp' } },
  twirl: { legacy: createLegacyTwirlGraph, current: createDefaultTwirlGraph, legacyParams: { shape: 'frame', edges: 'clamp' } },
  bulge: { legacy: createLegacyBulgeGraph, current: createDefaultBulgeGraph, legacyParams: { shape: 'frame', edges: 'clamp' } },
};
const legacyGraphs = new Map<UpgradableUvDistortType, EffectOperatorGraph>();

function isUpgradable(type: string): type is UpgradableUvDistortType { return Object.hasOwn(RECIPES, type); }

/**
 * Saved Wave, Twirl and Bulge effects whose graph is the untouched original recipe move to the
 * current recipe. The new controls (shape, frame edges, speed, phase) are filled with the values
 * that reproduce the saved look; parameters and keyframes keep their ids and meaning. Bulge also
 * gets the smooth curve (a deliberate fix of the smeared centre and the visible rim). Edited
 * graphs are user work and stay as saved.
 */
export function upgradePersistedUvDistortEffect(effect: Effect): Effect {
  if (!isUpgradable(effect.type)) return effect;
  const recipe = RECIPES[effect.type];
  const stored = effect.operatorGraph ?? (effect.params[EFFECT_GRAPH_PARAM] !== undefined
    ? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], recipe.current) : undefined);
  if (!stored || stored.incomplete || stored.groups?.some(group => group.bypassed)) return effect;
  let legacy = legacyGraphs.get(effect.type);
  if (!legacy) { legacy = recipe.legacy(); legacyGraphs.set(effect.type, legacy); }
  if (!matchesEffectRecipe(stored, legacy)) return effect;
  const params = { ...effect.params };
  delete params[EFFECT_GRAPH_PARAM];
  for (const [id, value] of Object.entries(recipe.legacyParams)) if (params[id] === undefined) params[id] = value;
  return { ...effect, params, operatorGraph: recipe.current() };
}
