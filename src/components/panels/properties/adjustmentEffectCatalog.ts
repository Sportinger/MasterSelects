import { getEffect } from '../../../effects';
import type { EffectDefinition } from '../../../effects/types';
import {
  classifyAdjustmentEffect,
  listAdjustmentEffectClassifications,
} from '../../../services/motionDesign/adjustment/adjustmentEffectClassification';

/**
 * The effect picker groups for a target: everything for clips; for adjustment layers every effect
 * they admit, plus one sentence naming the effects they cannot take (their cards say why).
 */
export function adjustmentEffectCatalog<G extends { effects: EffectDefinition[] }>(
  groups: G[],
  isAdjustment: boolean,
): { effectCategories: G[]; unavailableNote?: string } {
  if (!isAdjustment) return { effectCategories: groups };
  const unavailable = listAdjustmentEffectClassifications().filter((entry) => !entry.admitted);
  return {
    effectCategories: groups
      .map((group) => ({ ...group, effects: group.effects.filter((effect) => classifyAdjustmentEffect(effect.id).admitted) }))
      .filter((group) => group.effects.length > 0),
    unavailableNote: unavailable.length
      ? `Not available on adjustment layers (they need a source clip of their own or cut pixels out): ${unavailable
        .map((entry) => getEffect(entry.effectType)?.name ?? entry.effectType).join(', ')}.`
      : undefined,
  };
}
