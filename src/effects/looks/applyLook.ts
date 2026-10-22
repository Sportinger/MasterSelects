import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { COLOR_RECIPE_EFFECT_TYPES } from '../../services/operators/colorEffectGraphs';
import { earlierPrintGraph, isReviewedPrintLook } from '../../services/operators/patternLegacyGraphs';
import { effectOperatorGraph } from '../../services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../services/operators/effectFamilyPresentation';
import { hasEarlierStylizeRecipe, isEarlierStylizeGraph, stylizeNewInstanceParams } from '../../services/operators/stylizeRecipes';
import { getDefaultParams, getEffect, withLegacyDefaultParams, withoutRuntimeTravelParams } from '..';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { checkedLookEntryOperatorGraph, lookEntryOmittedParams, lookEntryParams } from './lookEntryGraph';
import type { LookDefinition, LookStackEntry } from './types';

/** Applies a Look; returns the problems of stored graphs that could not be used (those entries render the current recipe). */
export function applyLookToClip(look: LookDefinition, clipId: string): string[] {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  const problems: string[] = [];
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      // A stored graph (or one carried in an old Look's values, such as the smoke Acuarela), a stylize
      // effect's earlier recipe, an analog effect's original graph or the original color math
      // (lookEntryGraph.ts). Such a graph starts without the parameters it never reads (the rebuilt
      // analog recipe's own, the watercolour Acuarela's), like a pinned saved effect.
      const { graph: operatorGraph, problem } = checkedLookEntryOperatorGraph(look, entry);
      if (problem) problems.push(problem);
      const omitParams = lookEntryOmittedParams(look, entry, operatorGraph);
      const effectId = addClipEffect(clipId, entry.effectId, operatorGraph ? { operatorGraph, ...(omitParams.length ? { omitParams } : {}) } : undefined);
      // A custom Look saved before an effect gained controls or a new recipe lacks their values: give it the ones that keep its look.
      const saved = lookEntryParams(look, entry);
      // Values a new instance starts with differently (Posterize Brightness Only) keep what an entry
      // saved without them meant: the parameter default.
      const definitions = getEffect(entry.effectId)?.params ?? {};
      const unsaved = Object.fromEntries(Object.keys(stylizeNewInstanceParams(entry.effectId)).filter(name => !(name in saved) && definitions[name])
        .map(name => [name, definitions[name].default]));
      const params = { ...unsaved, ...saved };
      if (Object.keys(params).length > 0) updateClipEffect(clipId, effectId, params);
      if (!entry.enabled) setClipEffectEnabled(clipId, effectId, false);
    }
  } finally {
    endBatch();
  }
  return problems;
}
/**
 * Which recipe a print look's graph is: `current` (the recipe a new instance renders), `earlier` (its
 * 3.2.7 graph) or `edited`. A project load gives every print look its graph, and those graphs are
 * large (Riso Glow about 170 KB), so a Look entry stores only an edited one.
 */
function printGraphRecipe(effect: { type: string; params?: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }): 'current' | 'earlier' | 'edited' {
  const graph = effect.operatorGraph;
  if (!graph) return 'current';
  const current = effectOperatorGraph({ id: 'look-entry', type: effect.type, params: { ...getDefaultParams(effect.type), ...effect.params } } as never);
  if (matchesEffectRecipe(graph, current)) return 'current';
  const earlier = earlierPrintGraph(effect.type);
  return earlier && matchesEffectRecipe(graph, earlier) ? 'earlier' : 'edited';
}

/**
 * A Look stack from clip effects. A parameter an instance does not store renders at its
 * `legacyDefault` (saved before the parameter existed); the entry stores that value explicitly, so the
 * Look applies and previews as the clip looked rather than with the new default.
 */
export function stackFromClipEffects(
  effects: Array<{ type: string; enabled?: boolean; params?: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }>,
): LookStackEntry[] {
  return effects.map((effect) => {
    const print = isReviewedPrintLook(effect.type) ? printGraphRecipe(effect) : undefined;
    return {
      effectId: effect.type,
      enabled: effect.enabled !== false,
      ...(hasEarlierStylizeRecipe(effect.type) && isEarlierStylizeGraph(effect.type, effect.operatorGraph) ? { recipe: 'earlier' as const } : {}),
      // A print look on its current recipe is marked so the entry is not taken for one saved before the
      // 2026-10-22 print review; an unmarked graph-less entry gets the 3.2.7 graph (lookEntryOriginalGraph),
      // which is exactly what a print look on its earlier graph needs.
      ...(print === 'current' ? { recipe: 'current' as const } : {}),
      params: withoutRuntimeTravelParams(effect.type, withLegacyDefaultParams(effect.type, Object.fromEntries(
        Object.entries(effect.params ?? {}).filter(([, value]) => (
          typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
        ))) as Record<string, number | boolean | string>)),
      // Color graphs are small and self-contained; other graphs may reference clip resources. A print look
      // stores its graph only when it was edited: its known recipes are rebuilt from the marker above.
      ...(effect.operatorGraph && (COLOR_RECIPE_EFFECT_TYPES.has(effect.type) || print === 'edited')
        ? { operatorGraph: structuredClone(effect.operatorGraph) } : {}),
    };
  });
}
