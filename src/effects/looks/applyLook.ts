import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { withLegacyLookParams } from './legacyLookParams';
import { EFFECT_GRAPH_PARAM } from '../../services/operators/effectGraph';
import { migratePersistedEffectOperatorGraph } from '../../services/operators/effectGraphOwner';
import { withoutWatercolourParams } from '../../services/operators/acuarelaIdentity';
import type { LookDefinition, LookStackEntry } from './types';

export function applyLookToClip(look: LookDefinition, clipId: string): void {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      const effectId = addClipEffect(clipId, entry.effectId);
      // A custom Look saved before an effect gained controls lacks them: give them the values that keep its look.
      const params = look.builtIn ? entry.params : withLegacyLookParams(entry.effectId, entry.params);
      if (Object.keys(params).length > 0) updateClipEffect(clipId, effectId, params);
      // A graph carried in the params (the smoke Acuarela of an old Look) moves to the effect's
      // canonical operatorGraph, as on project load, so renders do not re-parse it every frame; the
      // watercolour defaults filled in by addClipEffect go, so the params still name the smoke recipe.
      if (typeof params[EFFECT_GRAPH_PARAM] === 'string') {
        const state = useTimelineStore.getState(), clip = state.clips.find(item => item.id === clipId);
        if (clip) state.updateClip(clipId, { effects: clip.effects.map(effect => effect.id === effectId ? withoutWatercolourParams(migratePersistedEffectOperatorGraph(effect)) : effect) });
      }
      if (!entry.enabled) setClipEffectEnabled(clipId, effectId, false);
    }
  } finally {
    endBatch();
  }
}
export function stackFromClipEffects(
  effects: Array<{ type: string; enabled?: boolean; params?: Record<string, unknown> }>,
): LookStackEntry[] {
  return effects.map((effect) => ({
    effectId: effect.type,
    enabled: effect.enabled !== false,
    params: Object.fromEntries(Object.entries(effect.params ?? {}).filter(([, value]) => (
      typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
    ))) as Record<string, number | boolean | string>,
  }));
}
