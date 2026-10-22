import { getDefaultParams } from '..';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { originalAnalogGraph, predatesAnalogRecipe } from '../../services/operators/analogLegacyGraphs';
import { earlierPrintGraph, isReviewedPrintLook } from '../../services/operators/patternLegacyGraphs';
import type { LookDefinition, LookStackEntry } from './types';

/**
 * A custom Look entry saved before its analog effect's 2026-10 rebuild keeps that effect's
 * original graph, and one of a print look (Halftone, Riso, Dithering, Paper Print ...) saved
 * without a graph, before the 2026-10-22 print review, keeps its 3.2.7 graph (patternLegacyGraphs.ts;
 * newer entries store their graph, stackFromClipEffects). Built-in Looks and newer entries follow the
 * current recipe or their stored graph (undefined).
 */
export function lookEntryOriginalGraph(look: Pick<LookDefinition, 'builtIn'>,
  entry: Pick<LookStackEntry, 'effectId' | 'params'> & { operatorGraph?: EffectOperatorGraph }): EffectOperatorGraph | undefined {
  if (look.builtIn || entry.operatorGraph) return undefined;
  if (isReviewedPrintLook(entry.effectId)) return earlierPrintGraph(entry.effectId);
  if (!predatesAnalogRecipe(entry.effectId, entry.params)) return undefined;
  return originalAnalogGraph(entry.effectId);
}

/**
 * Default parameters an entry pinned to its original graph does not carry: the rebuilt recipe's
 * own parameters (such as its marker), which the original graph never reads. Without them the
 * effect matches a pinned saved effect, so no note talks about controls its graph does not have.
 */
export function lookEntryRecipeOnlyParams(look: Pick<LookDefinition, 'builtIn'>,
  entry: Pick<LookStackEntry, 'effectId' | 'params'> & { operatorGraph?: EffectOperatorGraph }): ReadonlySet<string> {
  const graph = lookEntryOriginalGraph(look, entry);
  if (!graph) return new Set();
  const bound = new Set(graph.nodes.flatMap(node => Object.values(node.bindings).filter((binding): binding is string => typeof binding === 'string')));
  return new Set(Object.keys(getDefaultParams(entry.effectId)).filter(id => !bound.has(id) && !Object.hasOwn(entry.params, id)));
}

/**
 * The effects a Look's thumbnail renders: the same parameters and graphs that applying the Look
 * gives a clip. The runtime passes the full entry graph (lookEntryGraph.ts) and the saved values
 * with legacy controls; by default an entry gets its original analog graph and its own values.
 */
export function lookThumbnailEffects(look: LookDefinition,
  operatorGraph: (entry: LookStackEntry) => EffectOperatorGraph | undefined = entry => lookEntryOriginalGraph(look, entry),
  savedParams: (entry: LookStackEntry) => Record<string, unknown> = entry => entry.params,
  omittedParams: (entry: LookStackEntry, graph: EffectOperatorGraph | undefined) => Iterable<string> = entry => lookEntryRecipeOnlyParams(look, entry)) {
  return look.stack.map((entry, index) => {
    const graph = operatorGraph(entry), recipeOnly = new Set(omittedParams(entry, graph));
    const defaults = Object.fromEntries(Object.entries(getDefaultParams(entry.effectId)).filter(([id]) => !recipeOnly.has(id)));
    return {
      id: `${look.id}:${index}`,
      type: entry.effectId,
      name: entry.effectId,
      enabled: entry.enabled,
      params: { ...defaults, ...savedParams(entry) },
      ...(graph ? { operatorGraph: graph } : {}),
    };
  });
}
