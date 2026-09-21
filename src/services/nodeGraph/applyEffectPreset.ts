import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { renderHostPort } from '../render/renderHostPort';
import { instantiateEffectPreset, type EffectPreset } from './effectPresetLibrary';

export function applyEffectPreset(clipId: string, preset: EffectPreset): string {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore);
  const clip = state.clips.find(candidate => candidate.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) {
    throw new Error('The clip is unavailable, locked or exporting.');
  }
  if (clip.source?.type === 'audio') throw new Error('Select a visual clip to add this effect preset.');
  const effect = instantiateEffectPreset(preset);
  const batch = startBatch('Add effect preset');
  try {
    state.updateClip(clipId, { effects: [...clip.effects, effect] });
    state.invalidateCache();
    renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
  return `effect-${effect.id}`;
}
