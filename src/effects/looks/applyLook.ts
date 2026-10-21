import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { withLegacyLookParams } from './legacyLookParams';
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
