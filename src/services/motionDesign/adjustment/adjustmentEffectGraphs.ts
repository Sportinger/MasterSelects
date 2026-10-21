import { COLOR_RECIPE_EFFECT_TYPES, createDefaultColorEffectGraph, type EditableColorEffectType } from '../../operators/colorEffectGraphs';
import type { Effect } from '../../../types';

/**
 * The Adjustment 1.0 mutation contract carries effect parameters only, while each timeline effect
 * also owns its render graph. An effect the call keeps (same id and type) keeps its graph, so an
 * untouched Brightness saved with the original color math does not switch to the 2026-10 recipe
 * when the list is replaced; a new color effect gets the recipe, the same as addClipEffect.
 */
export function withAdjustmentEffectGraphs(next: readonly Effect[], previous: readonly Effect[]): Effect[] {
  const kept = new Map(previous.map((effect) => [effect.id, effect]));
  return next.map((effect) => {
    const earlier = kept.get(effect.id);
    if (earlier && earlier.type === effect.type) {
      return earlier.operatorGraph ? { ...effect, operatorGraph: earlier.operatorGraph } : effect;
    }
    return COLOR_RECIPE_EFFECT_TYPES.has(effect.type)
      ? { ...effect, operatorGraph: createDefaultColorEffectGraph(effect.type as EditableColorEffectType) }
      : effect;
  });
}
