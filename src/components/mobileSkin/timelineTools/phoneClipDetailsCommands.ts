// What the clip Details sheet reads and changes, through the editor's own actions only: renaming
// (MIDI clips with renameMidiClip, storyboard scenes with updateStoryboardScene, exactly the clip
// types the desktop renames), the source label colour (the desktop context menu's target and the
// media store's setLabelColor), clip parenting (setClipParent, which keeps the world position),
// a new null object as parent (addMotionNullAndParentSelected) and track parenting (setTrackParent).
// Every refusal comes back as a sentence, never as silence.

import { planTimelineMotionParentMutation } from '../../../services/motionDesign/contracts/timelineStructureAdapter';
import { resolveClipContextMenuLabelTarget } from '../../timeline/utils/clipContextMenu';
import { useMediaStore } from '../../../stores/mediaStore';
import type { LabelColor } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionPixelSize } from '../../../stores/timeline/helpers/activeCompositionSize';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

type TimelineState = ReturnType<typeof useTimelineStore.getState>;

export type PhoneRenameSupport = 'midi' | 'storyboard' | null;

export function phoneRenameSupport(clip: Pick<TimelineClip, 'source' | 'storyboardProperties'>): PhoneRenameSupport {
  if (clip.source?.type === 'midi') return 'midi';
  if (clip.source?.type === 'storyboard' && clip.storyboardProperties?.sceneId) return 'storyboard';
  return null;
}

/** Renames with the editor's action for this clip type; the message says what happened. */
export function renamePhoneClip(clipId: string, name: string): { ok: boolean; message: string } {
  const store = useTimelineStore.getState();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  const next = name.trim().slice(0, 120);
  if (!clip) return { ok: false, message: 'The clip is gone.' };
  if (!next) return { ok: false, message: 'Type a name first.' };
  if (next === clip.name) return { ok: false, message: 'The clip already has this name.' };
  const support = phoneRenameSupport(clip);
  if (support === 'midi') store.renameMidiClip(clipId, next);
  else if (support === 'storyboard') store.updateStoryboardScene(clip.storyboardProperties!.sceneId, { title: next }, { historyLabel: 'Rename storyboard scene' });
  else return { ok: false, message: 'This clip takes its name from its media.' };
  return { ok: true, message: `Renamed to “${next}”.` };
}

/** The media item whose label colour the clip shows (the desktop context menu's target). */
export function phoneClipLabelTarget(clip: TimelineClip | null | undefined): { mediaItemId: string | null; currentColor: LabelColor } {
  return resolveClipContextMenuLabelTarget(clip, useMediaStore.getState());
}

export function setPhoneClipLabelColor(clipId: string, color: LabelColor): boolean {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
  const { mediaItemId } = phoneClipLabelTarget(clip);
  if (!mediaItemId) return false;
  useMediaStore.getState().setLabelColor([mediaItemId], color);
  return true;
}

function trackOf(state: Pick<TimelineState, 'tracks'>, clip: TimelineClip): TimelineTrack | undefined {
  return state.tracks.find((track) => track.id === clip.trackId);
}

/** Clips the selected clip can be parented to: other clips on video tracks of the composition. */
export function phoneParentCandidates(state: Pick<TimelineState, 'clips' | 'tracks'>, clipId: string): TimelineClip[] {
  const videoTracks = new Set(state.tracks.filter((track) => track.type === 'video').map((track) => track.id));
  return state.clips
    .filter((clip) => clip.id !== clipId && videoTracks.has(clip.trackId))
    .toSorted((a, b) => a.startTime - b.startTime || a.name.localeCompare(b.name));
}

/** Why this clip cannot take part in parenting at all (gone, not visual, locked), or null. */
export function phoneParentTrackProblem(state: Pick<TimelineState, 'clips' | 'tracks'>, clipId: string): string | null {
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return 'The clip is gone.';
  const track = trackOf(state, clip);
  if (track?.type !== 'video') return 'Only clips on video tracks have a position to parent.';
  if (track.locked) return 'This track is locked. Unlock it to change the parent.';
  return null;
}

/** Why the clip cannot get this parent (cycle, locked track, …), or null when it can. */
export function phoneParentProblem(state: TimelineState, clipId: string, parentClipId: string | null): string | null {
  const trackProblem = phoneParentTrackProblem(state, clipId);
  if (trackProblem) return trackProblem;
  const clip = state.clips.find((candidate) => candidate.id === clipId)!;
  const plan = planTimelineMotionParentMutation({
    compositionId: clip.compositionId ?? 'timeline:active',
    compositionSize: getActiveCompositionPixelSize(),
    clips: state.clips,
    clipKeyframes: state.clipKeyframes,
    timelineTime: state.playheadPosition,
    childClipId: clipId,
    ...(parentClipId ? { parentClipId } : {}),
  });
  if (plan.ok) return null;
  return plan.failures[0]?.message ?? 'The editor refused this parent.';
}

/** Sets or clears the parent with the editor's action; checks first so a refusal is visible. */
export function setPhoneClipParent(clipId: string, parentClipId: string | null): { ok: boolean; message: string } {
  const state = useTimelineStore.getState();
  const problem = phoneParentProblem(state, clipId, parentClipId);
  if (problem) return { ok: false, message: problem };
  state.setClipParent(clipId, parentClipId);
  const after = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  if ((after?.parentClipId ?? null) !== parentClipId) return { ok: false, message: 'The editor did not apply the parent (see the log).' };
  const parentName = parentClipId ? state.clips.find((clip) => clip.id === parentClipId)?.name ?? 'the clip' : null;
  return { ok: true, message: parentName ? `Parented to “${parentName}”; it stays where it is.` : 'Parent removed; it stays where it is.' };
}

/**
 * Creates a null object on a new video track and parents the selected clips to it (the editor's
 * addMotionNullAndParentSelected). The new null becomes the selection.
 */
export function parentSelectionToNewNull(clipIds: readonly string[]): { ok: boolean; message: string } {
  const store = useTimelineStore.getState();
  const ids = clipIds.filter((id) => store.clips.some((clip) => clip.id === id));
  if (ids.length === 0) return { ok: false, message: 'Select a clip first.' };
  for (const id of ids) {
    const problem = phoneParentTrackProblem(store, id);
    if (problem) return { ok: false, message: problem };
  }
  const trackId = store.addTrack('video');
  const nullId = useTimelineStore.getState().addMotionNullAndParentSelected(trackId, store.playheadPosition, ids);
  if (!nullId) {
    const after = useTimelineStore.getState();
    if (!after.clips.some((clip) => clip.trackId === trackId)) after.removeTrack(trackId);
    return { ok: false, message: 'The editor could not create the null for this selection (see the log).' };
  }
  return { ok: true, message: `Null created on a new track; ${ids.length === 1 ? 'the clip follows' : `${ids.length} clips follow`} it. Move or rotate the null to move them.` };
}

/** Tracks this clip's track can be parented to (same type, not itself). */
export function phoneTrackParentCandidates(state: Pick<TimelineState, 'tracks'>, trackId: string): TimelineTrack[] {
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  return track ? state.tracks.filter((candidate) => candidate.id !== trackId && candidate.type === track.type) : [];
}

/** True when `parentId` is `trackId` itself or one of its descendants (would be a loop). */
export function phoneTrackParentWouldLoop(tracks: readonly TimelineTrack[], trackId: string, parentId: string): boolean {
  let current: string | undefined = parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === trackId) return true;
    seen.add(current);
    current = tracks.find((track) => track.id === current)?.parentTrackId;
  }
  return false;
}

export function setPhoneTrackParent(trackId: string, parentTrackId: string | null): { ok: boolean; message: string } {
  const store = useTimelineStore.getState();
  if (parentTrackId && phoneTrackParentWouldLoop(store.tracks, trackId, parentTrackId)) {
    return { ok: false, message: 'That track already follows this one: parenting it back would make a loop.' };
  }
  store.setTrackParent(trackId, parentTrackId);
  const after = useTimelineStore.getState().tracks.find((track) => track.id === trackId);
  if ((after?.parentTrackId ?? null) !== parentTrackId) return { ok: false, message: 'The editor did not apply the track parent (see the log).' };
  const name = parentTrackId ? store.tracks.find((track) => track.id === parentTrackId)?.name ?? 'the track' : null;
  return { ok: true, message: name ? `The track follows “${name}”.` : 'The track has no parent now.' };
}
