import { useTimelineStore } from '../../../../stores/timeline';
import { applyMoveClipsOperation } from '../../../../stores/timeline/editOperations/moveOperations';
import { applyTrimClipOperation } from '../../../../stores/timeline/editOperations/trimOperations';
import type { TimelineEditOperation } from '../../../../stores/timeline/editOperations';
import { resolveLinkedVideoAudioPair } from '../../../../stores/timeline/helpers/linkedClipSpeed';
import { startBatch, endBatch } from '../../../../stores/historyStore';

type TimeEdit = Extract<TimelineEditOperation, { type: 'move-clips' | 'trim-clip' }>;

/** Pure planners preflight the entire edit; a locked follower must not become a partial edit. */
export function applyCompositionTimeEdit(operation: TimeEdit): string {
  const state = useTimelineStore.getState();
  if (state.isExporting) return 'The timeline is locked during export.';
  const preview = operation.type === 'move-clips'
    ? applyMoveClipsOperation(operation, state.clips, state.tracks)
    : applyTrimClipOperation(operation, state.clips, state.tracks);
  const blocked = preview.warnings.filter(warning => warning.code !== 'no-op');
  if (blocked.length) return blocked.map(warning => warning.message).join(' ');
  const result = state.applyTimelineEditOperation(operation, { source: 'ui',
    historyLabel: operation.type === 'move-clips' ? 'Place clip' : 'Slice clip' });
  return result.warnings.map(warning => warning.message).join(' ');
}

export function moveCompositionClip(clipId: string, startTime: number, trackId?: string): string {
  return applyCompositionTimeEdit({ id: crypto.randomUUID(), type: 'move-clips',
    moves: [{ clipId, startTime, trackId }], includeLinked: true });
}

export function changeCompositionClipSpeed(clipId: string, speed?: number): string {
  const state = useTimelineStore.getState(), clip = state.clips.find(candidate => candidate.id === clipId);
  if (!clip) return 'Clip is no longer available.';
  if (state.isExporting) return 'The timeline is locked during export.';
  const pair = resolveLinkedVideoAudioPair(state.clips, clipId);
  const affected = pair ? [pair.video, pair.audio] : [clip];
  if (affected.some(candidate => state.tracks.find(track => track.id === candidate.trackId)?.locked)) return 'The clip or its linked audio is on a locked track.';
  const batch = startBatch(speed === undefined ? 'Reverse clip' : 'Change clip speed');
  try {
    if (speed === undefined) state.toggleClipReverse(clipId);
    else if (!state.setClipSpeed(clipId, speed)) return 'Speed could not be changed. Use a magnitude between 0.1 and 10.';
    return '';
  } finally { if (batch.opened) endBatch(); }
}
