import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { COLOR_RECIPE_EFFECT_TYPES, createDefaultColorEffectGraph, type EditableColorEffectType } from './colorEffectGraphs';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyColorEffectGraph } from './legacyColorEffectGraphs';
import { flattenContrastGraph } from './contrastFlattenUpgrade';

/** Which math a color effect's graph renders: the 2026-10 recipe, the original math, or an edit. */
export type ColorEffectGraphState = 'recipe' | 'original' | 'edited';

const references = new Map<string, { recipe: EffectOperatorGraph; original: EffectOperatorGraph }>();
const verdicts = new WeakMap<EffectOperatorGraph, Map<string, ColorEffectGraphState>>();

/**
 * Classifies a color effect graph by its nodes and wiring (layout and folders are ignored).
 * Returns undefined for effect types that are not color recipes.
 */
export function colorEffectGraphState(type: string, graph: EffectOperatorGraph): ColorEffectGraphState | undefined {
  if (!COLOR_RECIPE_EFFECT_TYPES.has(type)) return undefined;
  const known = verdicts.get(graph)?.get(type);
  if (known) return known;
  let reference = references.get(type);
  if (!reference) {
    const colorType = type as EditableColorEffectType;
    reference = { recipe: createDefaultColorEffectGraph(colorType), original: createLegacyColorEffectGraph(colorType) };
    references.set(type, reference);
  }
  // A saved Contrast of the former recipe renders the current one (contrastFlattenUpgrade.ts).
  const rendered = type === 'contrast' ? flattenContrastGraph(graph) : graph;
  const state: ColorEffectGraphState = matchesEffectRecipe(rendered, reference.recipe) ? 'recipe'
    : matchesEffectRecipe(graph, reference.original) ? 'original' : 'edited';
  const byType = verdicts.get(graph) ?? new Map<string, ColorEffectGraphState>();
  byType.set(type, state);
  verdicts.set(graph, byType);
  return state;
}
