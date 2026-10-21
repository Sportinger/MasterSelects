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

const withLegacyControls = (effect: Effect, legacyParams: Record<string, number | string>): Effect['params'] => {
  const params = { ...effect.params };
  delete params[EFFECT_GRAPH_PARAM];
  for (const [id, value] of Object.entries(legacyParams)) if (params[id] === undefined) params[id] = value;
  return params;
};

/**
 * Saved Wave, Twirl and Bulge effects whose graph is the untouched original recipe move to the
 * current recipe. The new controls (shape, frame edges, speed, phase) are filled with the values
 * that reproduce the saved look; parameters and keyframes keep their ids and meaning. Bulge also
 * gets the smooth curve (a deliberate fix of the smeared centre and the visible rim). Edited
 * graphs are user work and stay as saved.
 *
 * Effects saved before effects owned a graph (no `operatorGraph`, no graph parameter) rendered
 * the original recipe too. New effects always carry every default parameter (addClipEffect,
 * tools and transitions fill them), so a graph-less effect without the new controls is old saved
 * data: it gets the same original-look values.
 */
export function upgradePersistedUvDistortEffect(effect: Effect): Effect {
  if (!isUpgradable(effect.type)) return effect;
  const recipe = RECIPES[effect.type];
  const stored = effect.operatorGraph ?? (effect.params[EFFECT_GRAPH_PARAM] !== undefined
    ? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], recipe.current) : undefined);
  if (!stored) {
    const missing = Object.keys(recipe.legacyParams).filter(id => effect.params[id] === undefined);
    return missing.length ? { ...effect, params: withLegacyControls(effect, recipe.legacyParams) } : effect;
  }
  if (stored.incomplete || stored.groups?.some(group => group.bypassed)) return effect;
  let legacy = legacyGraphs.get(effect.type);
  if (!legacy) { legacy = recipe.legacy(); legacyGraphs.set(effect.type, legacy); }
  if (!matchesEffectRecipe(stored, legacy)) return effect;
  return { ...effect, params: withLegacyControls(effect, recipe.legacyParams), operatorGraph: recipe.current() };
}
