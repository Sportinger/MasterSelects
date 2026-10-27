// Score clips on the phone: find the selected one, or make one at the playhead on the first score
// track (adding a score track when there is none), through the editor's own addTrack/addScoreClip.

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';

const log = Logger.create('PhoneScore');
const NEW_SCORE_SECONDS = 8;

export function findSelectedPhoneScoreClip(clips: readonly TimelineClip[], selectedClipIds: Iterable<string>): TimelineClip | null {
  const selected = new Set(selectedClipIds);
  return clips.find((clip) => selected.has(clip.id) && clip.source?.type === 'score') ?? null;
}

/** Creates a score clip at the playhead and selects it; returns its id or why not. */
export function createPhoneScoreClip(): { clipId: string | null; error?: string } {
  const store = useTimelineStore.getState();
  const existing = store.tracks.find((track) => track.type === 'score' && track.locked !== true);
  const trackId = existing?.id ?? store.addTrack('score');
  if (!useTimelineStore.getState().tracks.some((track) => track.id === trackId)) {
    log.warn('No score track could be created');
    return { clipId: null, error: 'No score track could be created.' };
  }
  const clipId = useTimelineStore.getState().addScoreClip(trackId, store.playheadPosition, NEW_SCORE_SECONDS);
  if (!clipId) {
    log.warn('addScoreClip refused a new score clip', { trackId });
    return { clipId: null, error: 'The score clip could not be created (see the log).' };
  }
  useTimelineStore.getState().selectClip(clipId, false);
  return { clipId };
}
