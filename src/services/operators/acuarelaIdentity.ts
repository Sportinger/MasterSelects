import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, readEffectGraph } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyAcuarelaGraph, hasLegacyAcuarelaParams } from './acuarelaEffectGraph';
import { createAcuarelaGraphBefore20261022, createDefaultAcuarelaGraph } from './acuarelaWatercolorGraph';

let recipes: EffectOperatorGraph[] | undefined;
const recipeCopies = new WeakMap<EffectOperatorGraph, boolean>();

/**
 * True when the instance renders the built-in watercolour recipe (no saved graph, or an untouched
 * saved copy of the current recipe or of the one before 2026-10-22, which drew the same pixels).
 */
export function rendersBuiltInAcuarelaRecipe(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): boolean {
  if (effect.type !== 'acuarela') return false;
  if (!effect.operatorGraph) return effect.params[EFFECT_GRAPH_PARAM] === undefined && !hasLegacyAcuarelaParams(effect.params);
  let known = recipeCopies.get(effect.operatorGraph);
  if (known === undefined) {
    recipes ??= [createDefaultAcuarelaGraph(), createAcuarelaGraphBefore20261022()];
    const graph = effect.operatorGraph;
    known = recipes.some(recipe => matchesEffectRecipe(graph, recipe));
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

/** Parameters only the watercolour recipe reads. */
const WATERCOLOUR_PARAM_IDS = new Set(['wash', 'bleed', 'edges', 'simplify', 'blooms', 'shadows', 'granulation', 'paper', 'grainSize', 'lift', 'flow']);

/** The watercolour-only parameters an Acuarela on the smoke recipe leaves out (none for other effects). */
export function watercolourOnlyParams(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): string[] {
  return rendersAcuarelaSmokeRecipe(effect) ? [...WATERCOLOUR_PARAM_IDS] : [];
}

/**
 * An instance that renders the smoke recipe (a Look applied with it gets the watercolour defaults
 * first) drops the watercolour values, so its parameters alone still name the smoke recipe for
 * the clamp notes and the worker CPU pass (`hasLegacyAcuarelaParams`).
 */
export function withoutWatercolourParams<T extends { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }>(effect: T): T {
  if (!rendersAcuarelaSmokeRecipe(effect) || !Object.keys(effect.params).some(id => WATERCOLOUR_PARAM_IDS.has(id))) return effect;
  return { ...effect, params: Object.fromEntries(Object.entries(effect.params).filter(([id]) => !WATERCOLOUR_PARAM_IDS.has(id))) };
}

/** True when the instance renders with the smoke recipe's frame history (saved smoke effects, or a graph built on it). */
export function rendersAcuarelaSmokeRecipe(effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): boolean {
  if (effect.type !== 'acuarela') return false;
  let graph = effect.operatorGraph;
  if (!graph && typeof effect.params[EFFECT_GRAPH_PARAM] === 'string') {
    try { graph = readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], createDefaultAcuarelaGraph); } catch { return false; }
  }
  if (!graph) return hasLegacyAcuarelaParams(effect.params);
  return graph.nodes.some(node => node.operator === 'image.frame-history');
}
