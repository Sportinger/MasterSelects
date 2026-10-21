import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { editEffectGraph } from '../../services/operators/effectGraphEditing';
import { createEarlierStylizeGraph, hasEarlierStylizeRecipe, isEarlierStylizeGraph, stylizeNewInstanceParams } from '../../services/operators/stylizeRecipes';
import { getEffect } from '..';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { LookDefinition, LookStackEntry } from './types';

export function applyLookToClip(look: LookDefinition, clipId: string): void {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      const effectId = addClipEffect(clipId, entry.effectId);
      // A stylize effect saved with its earlier recipe gets that recipe back, so its values keep their look.
      const earlier = entry.recipe === 'earlier' ? createEarlierStylizeGraph(entry.effectId) : undefined;
      if (earlier) editEffectGraph(clipId, effectId, `Apply look: ${look.name}`, target => {
        for (const key of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[key];
        Object.assign(target, earlier);
      });
      // Values a new instance starts with differently (Posterize Brightness Only) keep what an entry
      // saved without them meant: the parameter default.
      const definitions = getEffect(entry.effectId)?.params ?? {};
      const unsaved = Object.fromEntries(Object.keys(stylizeNewInstanceParams(entry.effectId)).filter(name => !(name in entry.params) && definitions[name])
        .map(name => [name, definitions[name].default]));
      const params = { ...unsaved, ...entry.params };
      if (Object.keys(params).length > 0) updateClipEffect(clipId, effectId, params);
      if (!entry.enabled) setClipEffectEnabled(clipId, effectId, false);
    }
  } finally {
    endBatch();
  }
}
export function stackFromClipEffects(
  effects: Array<{ type: string; enabled?: boolean; params?: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }>,
): LookStackEntry[] {
  return effects.map((effect) => ({
    effectId: effect.type,
    enabled: effect.enabled !== false,
    ...(hasEarlierStylizeRecipe(effect.type) && isEarlierStylizeGraph(effect.type, effect.operatorGraph) ? { recipe: 'earlier' as const } : {}),
    params: Object.fromEntries(Object.entries(effect.params ?? {}).filter(([, value]) => (
      typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
    ))) as Record<string, number | boolean | string>,
  }));
}
