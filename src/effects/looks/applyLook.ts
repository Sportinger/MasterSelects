import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { LookDefinition, LookStackEntry } from './types';
import { lookEntryOriginalGraph, lookEntryRecipeOnlyParams } from './lookStackEffects';

/**
 * A custom Look saved before an analog effect's 2026-10 rebuild keeps that effect's original look:
 * the original graph, without the rebuilt recipe's own default parameters (as a pinned saved effect).
 */
function keepOriginalAnalogLook(look: LookDefinition, entry: LookStackEntry, clipId: string, effectId: string): void {
  const operatorGraph = lookEntryOriginalGraph(look, entry), state = useTimelineStore.getState();
  const clip = state.clips.find(candidate => candidate.id === clipId);
  if (!operatorGraph || !clip) return;
  const recipeOnly = lookEntryRecipeOnlyParams(look, entry);
  state.updateClip(clipId, { effects: clip.effects.map(effect => effect.id === effectId ? { ...effect, operatorGraph,
    params: Object.fromEntries(Object.entries(effect.params).filter(([id]) => !recipeOnly.has(id))) } : effect) });
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
