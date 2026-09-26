import { getEffect } from '../../effects';
import { effectEngine, effectEngineMembers } from '../../effects/effectCatalogGroups';
import type { Effect } from '../../types/effects';
import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';
import { startBatch, endBatch } from '../../stores/historyStore';

const parameterKeys = (type: string) => Object.keys(getEffect(type)?.params ?? {}).toSorted().join(',');

/**
 * Other looks of the same engine with exactly the same parameters. Switching
 * keeps every value and keyframe, because parameter IDs are identical.
 */
export function effectStyleOptions(type: string): Array<{ value: string; label: string }> {
  const engine = effectEngine(type);
  if (!engine) return [];
  const keys = parameterKeys(type);
  return effectEngineMembers(engine).filter(member => getEffect(member) && parameterKeys(member) === keys)
    .map(member => ({ value: member, label: getEffect(member)!.name }));
}

/** Replaces the look in place: same effect ID, stack position, parameters and keyframes; one undo step. */
export function changeEffectStyle(clipId: string, effectId: string, type: string): void {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId), effect = clip?.effects.find(candidate => candidate.id === effectId);
  if (!clip || !effect || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  if (effect.type === type) return;
  if (!effectStyleOptions(effect.type).some(option => option.value === type)) throw new Error(`${type} is not a style of ${effect.type}.`);
  // A customized node graph belongs to the previous look; the new style starts from its own default graph.
  const params = Object.fromEntries(Object.entries(effect.params).filter(([key]) => key !== EFFECT_GRAPH_PARAM));
  const next: Effect = { ...effect, type: type as Effect['type'], params, operatorGraph: undefined,
    name: effect.name === effect.type || effect.name === getEffect(effect.type)?.name ? type : effect.name };
  const batch = startBatch('Change effect style');
  try {
    state.updateClip(clip.id, { effects: clip.effects.map(candidate => candidate.id === effectId ? next : candidate) });
  } finally { if (batch.opened) endBatch(); }
}
