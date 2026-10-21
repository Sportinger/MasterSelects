import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, readEffectGraph } from './effectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { expandOperatorCompositions } from './operatorComposition';
import {
  createLegacyBlockifyGraph, createLegacyBlockMosaicGraph, createLegacyKaleidoscopeGraph, createLegacyMirrorGraph,
  createLegacyPixelateGraph, createLegacyRgbSplitGraph,
} from './legacyMirrorPixelEffectGraphs';
import { createDefaultBlockifyGraph, createDefaultBlockMosaicGraph, createDefaultPixelateGraph } from './cellGridRecipes';
import { createDefaultKaleidoscopeGraph, createDefaultMirrorGraph, createDefaultRgbSplitGraph } from './mirrorRecipes';

export type MirrorPixelEffectType = 'kaleidoscope' | 'mirror' | 'rgb-split' | 'pixelate' | 'blockify' | 'block-mosaic';

/**
 * Per effect: the shipped recipe before the mirror/pixel review, the current recipe and the values of
 * the new controls that keep a saved effect's look. Kaleidoscope (Stretch to Frame, Clamp) and
 * RGB Split (Clamp) look exactly as before apart from the alpha-edge fix; Mirror needs no values.
 * Pixelate, Blockify and Block Mosaic deliberately change: 1080p-based cell sizes, a centred grid
 * and averaged cell colours. Blockify keeps 8 levels, Block Mosaic a 1-pixel grout.
 */
const RECIPES: Record<MirrorPixelEffectType, { legacy: () => EffectOperatorGraph; current: () => EffectOperatorGraph; legacyParams: Record<string, number | string> }> = {
  kaleidoscope: { legacy: createLegacyKaleidoscopeGraph, current: createDefaultKaleidoscopeGraph, legacyParams: { shape: 'frame', edges: 'clamp' } },
  mirror: { legacy: createLegacyMirrorGraph, current: createDefaultMirrorGraph, legacyParams: {} },
  'rgb-split': { legacy: createLegacyRgbSplitGraph, current: createDefaultRgbSplitGraph, legacyParams: { edges: 'clamp' } },
  pixelate: { legacy: createLegacyPixelateGraph, current: createDefaultPixelateGraph, legacyParams: {} },
  blockify: { legacy: createLegacyBlockifyGraph, current: createDefaultBlockifyGraph, legacyParams: { levels: 8 } },
  'block-mosaic': { legacy: createLegacyBlockMosaicGraph, current: createDefaultBlockMosaicGraph, legacyParams: { grout: 1 } },
};
const legacyGraphs = new Map<MirrorPixelEffectType, EffectOperatorGraph>();
const currentGraphs = new Map<MirrorPixelEffectType, EffectOperatorGraph>();

export function isMirrorPixelEffectType(type: string): type is MirrorPixelEffectType { return Object.hasOwn(RECIPES, type); }

/**
 * Params of a graph-less saved effect (or an old Look entry) with the values that keep its look for
 * every new control it does not carry yet. New effects always carry every default parameter
 * (addClipEffect, tools, Looks and transitions fill them), so a missing control means old data.
 */
export function withLegacyMirrorPixelControls(type: string, params: Effect['params']): Effect['params'] {
  if (!isMirrorPixelEffectType(type)) return params;
  const missing = Object.entries(RECIPES[type].legacyParams).filter(([id]) => params[id] === undefined);
  return missing.length ? { ...params, ...Object.fromEntries(missing) } : params;
}

/**
 * Saved effects whose graph is the untouched pre-review recipe move to the current recipe; their
 * new controls get the values that keep the saved look. Edited graphs are user work and stay as
 * saved (they keep reading their own controls). Graph-less effects keep rendering the current
 * recipe and only get the missing control values.
 */
export function upgradePersistedMirrorPixelEffect(effect: Effect): Effect {
  if (!isMirrorPixelEffectType(effect.type)) return effect;
  const recipe = RECIPES[effect.type];
  const stored = effect.operatorGraph ?? (effect.params[EFFECT_GRAPH_PARAM] !== undefined
    ? readEffectGraph(effect.params[EFFECT_GRAPH_PARAM], recipe.current) : undefined);
  if (!stored) {
    const params = withLegacyMirrorPixelControls(effect.type, effect.params);
    return params === effect.params ? effect : { ...effect, params };
  }
  if (stored.incomplete || stored.groups?.some(group => group.bypassed)) return effect;
  let legacy = legacyGraphs.get(effect.type);
  if (!legacy) { legacy = expandOperatorCompositions(recipe.legacy()); legacyGraphs.set(effect.type, legacy); }
  if (!matchesEffectRecipe(stored, legacy)) return effect;
  const params = { ...withLegacyMirrorPixelControls(effect.type, effect.params) };
  delete params[EFFECT_GRAPH_PARAM];
  return { ...effect, params, operatorGraph: recipe.current() };
}

const recipeCopies = new WeakMap<EffectOperatorGraph, boolean>();
type MirrorPixelEffectLike = { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };

/** The effect renders the untouched built-in recipe (no stored graph, or an unedited copy of the current one). */
export function rendersBuiltInMirrorPixelRecipe(effect: MirrorPixelEffectLike): boolean {
  const type = effect.type;
  if (!isMirrorPixelEffectType(type)) return false;
  if (!effect.operatorGraph) return effect.params[EFFECT_GRAPH_PARAM] === undefined;
  const known = recipeCopies.get(effect.operatorGraph);
  if (known !== undefined) return known;
  let current = currentGraphs.get(type);
  if (!current) { current = expandOperatorCompositions(RECIPES[type].current()); currentGraphs.set(type, current); }
  const saved = effect.operatorGraph;
  const result = !saved.incomplete && !saved.groups?.some(group => group.bypassed) && matchesEffectRecipe(saved, current);
  recipeCopies.set(saved, result);
  return result;
}

const exactly = (value: unknown, target: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value - target) <= 1e-9;
const cellPixels = (size: unknown, width: number, height: number) =>
  typeof size === 'number' && Number.isFinite(size) ? Math.floor(size * Math.min(width, height) / 1080 + .5) : Number.NaN;

/**
 * Settings that return the input unchanged, so the pipeline skips the passes: RGB Split at
 * Amount 0, Mirror with both axes off, Pixelate with 1-pixel cells, Blockify and Block Mosaic at
 * Amount 0 or below. Only for the built-in recipe: an edited graph may do more.
 */
export function isNeutralMirrorPixelEffect(effect: MirrorPixelEffectLike, width: number, height: number): boolean {
  if (!rendersBuiltInMirrorPixelRecipe(effect)) return false;
  const params = effect.params;
  switch (effect.type) {
    case 'rgb-split': return exactly(params.amount, 0);
    case 'mirror': return params.horizontal === false && params.vertical === false;
    case 'pixelate': return cellPixels(params.size, width, height) <= 1;
    case 'blockify': case 'block-mosaic': return typeof params.amount === 'number' && params.amount <= 0;
    default: return false;
  }
}
