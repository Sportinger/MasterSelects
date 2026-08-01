import type { Keyframe, TimelineClip, TimelineTrack } from '../../../types';
import type { DeleteClipsOperation, TimelineEditWarning } from './types';
import {
  clearMotionParentsPreservingWorld,
  type MotionParentWorldPreservationContext,
} from './motionParentWorldPreservation';

export interface DeleteClipsApplyResult {
  clips: TimelineClip[];
  deletedClips: TimelineClip[];
  changedClipIds: string[];
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
  clipKeyframes?: Map<string, Keyframe[]>;
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
  parentPreservation?: MotionParentWorldPreservationContext,
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

  const orphanedClipIds = clips
    .filter((clip) => !idsToDelete.has(clip.id)
      && !!clip.parentClipId
      && idsToDelete.has(clip.parentClipId))
    .map((clip) => clip.id);
  const lockedOrphan = clips.find((clip) => (
    orphanedClipIds.includes(clip.id) && isTrackLocked(tracks, clip.trackId)
  ));
  if (parentPreservation && lockedOrphan) {
    return {
      clips,
      deletedClips: [],
      changedClipIds: [],
      selectedClipIds,
      warnings: [{
        code: 'track-locked',
        clipId: lockedOrphan.id,
        trackId: lockedOrphan.trackId,
        message: 'Cannot preserve a parented child on a locked track.',
      }],
    };
  }
  let clipsWithPreservedChildren = clips;
  let nextClipKeyframes: Map<string, Keyframe[]> | undefined;
  if (parentPreservation && orphanedClipIds.length > 0) {
    const preserved = clearMotionParentsPreservingWorld(
      clips,
      orphanedClipIds,
      parentPreservation,
    );
    if (!preserved.ok) {
      return {
        clips,
        deletedClips: [],
        changedClipIds: [],
        selectedClipIds,
        warnings: [{
          code: 'unsupported',
          message: preserved.message,
        }],
      };
    }
    clipsWithPreservedChildren = preserved.clips;
    nextClipKeyframes = preserved.clipKeyframes;
  }

  const nextClips = clipsWithPreservedChildren
    .filter((clip) => !idsToDelete.has(clip.id))
    .map((clip) => {
      const linkedClipId = clip.linkedClipId && idsToDelete.has(clip.linkedClipId)
        ? undefined
        : clip.linkedClipId;
      const parentClipId = clip.parentClipId && idsToDelete.has(clip.parentClipId)
        ? undefined
        : clip.parentClipId;
      return linkedClipId === clip.linkedClipId && parentClipId === clip.parentClipId
        ? clip
        : { ...clip, linkedClipId, parentClipId };
    });

  return {
    clips: nextClips,
    deletedClips,
    changedClipIds: [...deletedClips.map((clip) => clip.id), ...orphanedClipIds],
    selectedClipIds: nextSelectedClipIds,
    warnings,
    ...(nextClipKeyframes ? { clipKeyframes: nextClipKeyframes } : {}),
  };
}
