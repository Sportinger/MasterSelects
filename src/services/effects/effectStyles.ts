import { getEffect } from '../../effects';
import { effectEngine, effectEngineMembers } from '../../effects/effectCatalogGroups';
import type { Effect } from '../../types/effects';
import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { EFFECT_GRAPH_PARAM } from '../operators/effectGraph';
import { startBatch, endBatch } from '../../stores/historyStore';

const paramsOf = (type: string) => getEffect(type)?.params ?? {};

/**
 * Other looks of the same engine. Every look of an engine has the engine's base parameters, and a
 * parameter two looks both have must be of the same kind, so switching keeps those values and
 * keyframes. A look's own controls (a Speed, a Shape) keep their stored value for a switch back.
 */
export function effectStyleOptions(type: string): Array<{ value: string; label: string }> {
  const engine = effectEngine(type);
  const own = paramsOf(type);
  if (!engine || !getEffect(type)) return [];
  return effectEngineMembers(engine).filter((member) => {
    const other = getEffect(member)?.params;
    return !!other && Object.entries(own).every(([key, param]) => !other[key] || other[key].type === param.type);
  }).map(member => ({ value: member, label: getEffect(member)!.name }));
}

/**
 * Replaces the look in place: same effect ID, stack position, parameters and keyframes; one undo
 * step. Controls only the new look has start at its defaults (not a saved-project fallback), and a
 * choice the new look does not offer falls back to its default.
 */
export function changeEffectStyle(clipId: string, effectId: string, type: string): void {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId), effect = clip?.effects.find(candidate => candidate.id === effectId);
  if (!clip || !effect || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  if (effect.type === type) return;
  if (!effectStyleOptions(effect.type).some(option => option.value === type)) throw new Error(`${type} is not a style of ${effect.type}.`);
  // A customized node graph belongs to the previous look; the new style starts from its own default graph.
  const params = Object.fromEntries(Object.entries(effect.params).filter(([key]) => key !== EFFECT_GRAPH_PARAM));
  for (const [key, param] of Object.entries(paramsOf(type))) {
    const stored = params[key];
    const offered = param.type !== 'select' || param.options?.some(option => option.value === stored);
    if (stored === undefined || !offered) params[key] = param.default;
  }
  const next: Effect = { ...effect, type: type as Effect['type'], params, operatorGraph: undefined,
    name: effect.name === effect.type || effect.name === getEffect(effect.type)?.name ? type : effect.name };
  const batch = startBatch('Change effect style');
  try {
    state.updateClip(clip.id, { effects: clip.effects.map(candidate => candidate.id === effectId ? next : candidate) });
  } finally { if (batch.opened) endBatch(); }
}
