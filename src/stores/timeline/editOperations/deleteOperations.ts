import type { TimelineClip, TimelineTrack } from '../../../types';
import type { DeleteClipsOperation, TimelineEditWarning } from './types';

export interface DeleteClipsApplyResult {
  clips: TimelineClip[];
  deletedClips: TimelineClip[];
  changedClipIds: string[];
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
}

function collectLinkedIds(clips: TimelineClip[], clipIds: Iterable<string>): Set<string> {
  const ids = new Set(clipIds);
  for (const clip of clips) {
    if (ids.has(clip.id) && clip.linkedClipId) ids.add(clip.linkedClipId);
    if (clip.linkedClipId && ids.has(clip.linkedClipId)) ids.add(clip.id);
  }
  return ids;
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

export function applyDeleteClipsOperation(
  operation: DeleteClipsOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
): DeleteClipsApplyResult {
  const requestedIds = new Set(operation.clipIds);
  const idsToDelete = operation.includeLinked === false ? requestedIds : collectLinkedIds(clips, requestedIds);
  const deletedClips = clips.filter((clip) => idsToDelete.has(clip.id));

  if (deletedClips.length === 0) {
    return {
      clips,
      deletedClips: [],
      changedClipIds: [],
      selectedClipIds,
      warnings: [{
        code: 'no-op',
        message: 'No matching clips to delete.',
      }],
    };
  }

  const missingIds = [...requestedIds].filter((id) => !clips.some((clip) => clip.id === id));
  const warnings: TimelineEditWarning[] = missingIds.map((clipId) => ({
    code: 'clip-not-found',
    clipId,
    message: `Clip not found: ${clipId}`,
  }));

  const lockedClip = deletedClips.find((clip) => isTrackLocked(tracks, clip.trackId));
  if (lockedClip) {
    return {
      clips,
      deletedClips: [],
      changedClipIds: [],
      selectedClipIds,
      warnings: [{
        code: 'track-locked',
        clipId: lockedClip.id,
        trackId: lockedClip.trackId,
        message: 'Cannot delete clips on locked tracks.',
      }],
    };
  }

  const nextSelectedClipIds = new Set(selectedClipIds);
  for (const clipId of idsToDelete) nextSelectedClipIds.delete(clipId);

  const nextClips = clips
    .filter((clip) => !idsToDelete.has(clip.id))
    .map((clip) => clip.linkedClipId && idsToDelete.has(clip.linkedClipId)
      ? { ...clip, linkedClipId: undefined }
      : clip);

  return {
    clips: nextClips,
    deletedClips,
    changedClipIds: deletedClips.map((clip) => clip.id),
    selectedClipIds: nextSelectedClipIds,
    warnings,
  };
}
