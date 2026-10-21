import { getDefaultParams } from '..';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { originalAnalogGraph, predatesAnalogRecipe } from '../../services/operators/analogLegacyGraphs';
import type { LookDefinition, LookStackEntry } from './types';

/**
 * A custom Look entry saved before its analog effect's 2026-10 rebuild keeps that effect's
 * original graph; built-in Looks and newer entries follow the current recipe (undefined).
 */
export function lookEntryOriginalGraph(look: Pick<LookDefinition, 'builtIn'>,
  entry: Pick<LookStackEntry, 'effectId' | 'params'>): EffectOperatorGraph | undefined {
  if (look.builtIn || !predatesAnalogRecipe(entry.effectId, entry.params)) return undefined;
  return originalAnalogGraph(entry.effectId);
}

/**
 * Default parameters an entry pinned to its original graph does not carry: the rebuilt recipe's
 * own parameters (such as its marker), which the original graph never reads. Without them the
 * effect matches a pinned saved effect, so no note talks about controls its graph does not have.
 */
export function lookEntryRecipeOnlyParams(look: Pick<LookDefinition, 'builtIn'>,
  entry: Pick<LookStackEntry, 'effectId' | 'params'>): ReadonlySet<string> {
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
  savedParams: (entry: LookStackEntry) => Record<string, unknown> = entry => entry.params) {
  return look.stack.map((entry, index) => {
    const graph = operatorGraph(entry), recipeOnly = lookEntryRecipeOnlyParams(look, entry);
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
