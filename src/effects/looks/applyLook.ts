import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { COLOR_RECIPE_EFFECT_TYPES } from '../../services/operators/colorEffectGraphs';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { lookEntryOperatorGraph } from './lookEntryGraph';
import type { LookDefinition, LookStackEntry } from './types';

export function applyLookToClip(look: LookDefinition, clipId: string): void {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      const effectId = addClipEffect(clipId, entry.effectId);
      const operatorGraph = lookEntryOperatorGraph(look, entry);
      if (operatorGraph) {
        const state = useTimelineStore.getState(), clip = state.clips.find(candidate => candidate.id === clipId);
        if (clip) state.updateClip(clipId, { effects: clip.effects.map(effect => effect.id === effectId ? { ...effect, operatorGraph } : effect) });
      }
      if (Object.keys(entry.params).length > 0) updateClipEffect(clipId, effectId, entry.params);
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
    params: Object.fromEntries(Object.entries(effect.params ?? {}).filter(([, value]) => (
      typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
    ))) as Record<string, number | boolean | string>,
    // Color graphs are small and self-contained; other graphs may reference clip resources.
    ...(effect.operatorGraph && COLOR_RECIPE_EFFECT_TYPES.has(effect.type) ? { operatorGraph: structuredClone(effect.operatorGraph) } : {}),
  }));
}
