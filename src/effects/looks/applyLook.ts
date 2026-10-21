import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { LookDefinition, LookStackEntry } from './types';
import { originalAnalogGraph, predatesAnalogRecipe } from '../../services/operators/analogLegacyGraphs';

/** A custom Look saved before an analog effect's 2026-10 rebuild keeps that effect's original look. */
function keepOriginalAnalogLook(look: LookDefinition, entry: LookStackEntry, clipId: string, effectId: string): void {
  if (look.builtIn || !predatesAnalogRecipe(entry.effectId, entry.params)) return;
  const operatorGraph = originalAnalogGraph(entry.effectId), state = useTimelineStore.getState();
  const clip = state.clips.find(candidate => candidate.id === clipId);
  if (!operatorGraph || !clip) return;
  state.updateClip(clipId, { effects: clip.effects.map(effect => effect.id === effectId ? { ...effect, operatorGraph } : effect) });
}

export function applyLookToClip(look: LookDefinition, clipId: string): void {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      const effectId = addClipEffect(clipId, entry.effectId);
      if (Object.keys(entry.params).length > 0) updateClipEffect(clipId, effectId, entry.params);
      keepOriginalAnalogLook(look, entry, clipId, effectId);
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
