// Which clips the Effects, Filters and Adjust sheets edit: the selected clips on unlocked video
// tracks (primary selection first). With nothing selected the Effects sheet edits an adjustment
// layer it adds at the playhead through the editor's own addMotionAdjustmentClip.

import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

/** Length of an adjustment layer added from the phone (the editor's default for the desktop menu). */
export const PHONE_ADJUSTMENT_DURATION = 5;

export interface PhoneVisualSelection {
  /** Every selected clip the sheets can change, primary selection first. */
  clips: TimelineClip[];
  /** The clip whose stack and values the sheet shows. */
  primary: TimelineClip | null;
  /** Why some or all selected clips are left out (locked track, audio). Null when none are. */
  note: string | null;
  /** True when nothing at all is selected (root scope). */
  nothingSelected: boolean;
}

type SelectionState = Pick<ReturnType<typeof useTimelineStore.getState>, 'clips' | 'tracks' | 'selectedClipIds' | 'primarySelectedClipId'>;

/**
 * Pure: splits the selection into editable visual clips and the ones it has to leave out. Adjustment
 * layers stay in: they take effects, Looks and the colour grade, applied to the picture below them.
 */
export function resolvePhoneVisualSelection(state: SelectionState): PhoneVisualSelection {
  const ids = [...state.selectedClipIds];
  if (ids.length === 0) return { clips: [], primary: null, note: null, nothingSelected: true };
  const ordered = state.primarySelectedClipId && state.selectedClipIds.has(state.primarySelectedClipId)
    ? [state.primarySelectedClipId, ...ids.filter((id) => id !== state.primarySelectedClipId)]
    : ids;
  const clips: TimelineClip[] = [];
  let locked = 0, audio = 0;
  for (const id of ordered) {
    const clip = state.clips.find((candidate) => candidate.id === id);
    if (!clip) continue;
    const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
    if (track?.type !== 'video') { audio++; continue; }
    if (track.locked) { locked++; continue; }
    clips.push(clip);
  }
  const parts = [
    audio ? `${audio} audio clip${audio > 1 ? 's have' : ' has'} no picture` : '',
    locked ? `${locked} clip${locked > 1 ? 's are' : ' is'} on a locked track` : '',
  ].filter(Boolean);
  const note = parts.length ? `${parts.join('; ')}, so ${clips.length ? 'left out' : 'nothing can change here'}.` : null;
  return { clips, primary: clips[0] ?? null, note, nothingSelected: false };
}

export function readPhoneVisualSelection(): PhoneVisualSelection {
  return resolvePhoneVisualSelection(useTimelineStore.getState());
}

const EPSILON = 1e-4;

/**
 * Video track for an adjustment layer at [start, start + duration): the nearest unlocked, visible video
 * track above the main picture (the lowest video track) that is free there; null asks for a new track.
 * (Same rule as the title placement; kept here so the design sheets do not depend on the text module.)
 */
export function choosePhoneOverlayTrack(
  tracks: readonly TimelineTrack[],
  clips: readonly Pick<TimelineClip, 'trackId' | 'startTime' | 'duration'>[],
  start: number,
  duration: number,
): string | null {
  const above = tracks.filter((track) => track.type === 'video').slice(0, -1).toReversed();
  const end = start + duration;
  for (const track of above) {
    if (track.locked || track.visible === false) continue;
    const busy = clips.some((clip) => clip.trackId === track.id && clip.startTime < end - EPSILON && clip.startTime + clip.duration > start + EPSILON);
    if (!busy) return track.id;
  }
  return null;
}

/**
 * Adds an adjustment layer at the playhead on the nearest free video track above the main picture
 * (a new track when none is free). Runs inside the caller's transaction; the caller selects it on Done.
 */
export function addPhoneAdjustmentLayer(): string {
  const state = useTimelineStore.getState();
  const start = Math.max(0, getPlayheadPosition(state.playheadPosition));
  const trackId = choosePhoneOverlayTrack(state.tracks, state.clips, start, PHONE_ADJUSTMENT_DURATION) ?? state.addTrack('video');
  const clipId = useTimelineStore.getState().addMotionAdjustmentClip(trackId, start, PHONE_ADJUSTMENT_DURATION);
  if (!clipId) throw new Error('The editor refused the adjustment layer (see the log for the reason).');
  return clipId;
}

export function isAdjustmentClip(clip: Pick<TimelineClip, 'source'> | null | undefined): boolean {
  return clip?.source?.type === 'motion-adjustment';
}
