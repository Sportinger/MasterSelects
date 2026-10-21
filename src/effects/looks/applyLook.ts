import { startBatch, endBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { COLOR_RECIPE_EFFECT_TYPES } from '../../services/operators/colorEffectGraphs';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { checkedLookEntryOperatorGraph } from './lookEntryGraph';
import type { LookDefinition, LookStackEntry } from './types';

/** Applies a Look; returns the problems of stored graphs that could not be used (those entries render the current recipe). */
export function applyLookToClip(look: LookDefinition, clipId: string): string[] {
  const { addClipEffect, updateClipEffect, setClipEffectEnabled } = useTimelineStore.getState();
  const problems: string[] = [];
  startBatch(`Apply look: ${look.name}`);
  try {
    for (const entry of look.stack) {
      const { graph: operatorGraph, problem } = checkedLookEntryOperatorGraph(look, entry);
      if (problem) problems.push(problem);
      const effectId = addClipEffect(clipId, entry.effectId, operatorGraph ? { operatorGraph } : undefined);
      if (Object.keys(entry.params).length > 0) updateClipEffect(clipId, effectId, entry.params);
      if (!entry.enabled) setClipEffectEnabled(clipId, effectId, false);
    }
  } finally {
    endBatch();
  }
  return problems;
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
