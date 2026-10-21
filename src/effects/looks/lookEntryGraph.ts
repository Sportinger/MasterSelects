import { COLOR_RECIPE_EFFECT_TYPES, type EditableColorEffectType } from '../../services/operators/colorEffectGraphs';
import { createLegacyColorEffectGraph } from '../../services/operators/legacyColorEffectGraphs';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { LookDefinition, LookStackEntry } from './types';

/**
 * The graph an applied Look entry needs: its saved graph, or for a custom Look saved before the
 * 2026-10 color rebuild the original color math, so an old Look keeps its look.
 */
export function lookEntryOperatorGraph(look: Pick<LookDefinition, 'builtIn' | 'schemaVersion'>, entry: LookStackEntry): EffectOperatorGraph | undefined {
  if (entry.operatorGraph) return structuredClone(entry.operatorGraph);
  if (look.builtIn || look.schemaVersion || !COLOR_RECIPE_EFFECT_TYPES.has(entry.effectId)) return undefined;
  return createLegacyColorEffectGraph(entry.effectId as EditableColorEffectType);
}
