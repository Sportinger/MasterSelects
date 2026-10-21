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

/** The effects a Look's thumbnail renders: the same parameters and graphs that applying the Look gives a clip. */
export function lookThumbnailEffects(look: LookDefinition) {
  return look.stack.map((entry, index) => {
    const operatorGraph = lookEntryOriginalGraph(look, entry);
    return {
      id: `${look.id}:${index}`,
      type: entry.effectId,
      name: entry.effectId,
      enabled: entry.enabled,
      params: { ...getDefaultParams(entry.effectId), ...entry.params },
      ...(operatorGraph ? { operatorGraph } : {}),
    };
  });
}
