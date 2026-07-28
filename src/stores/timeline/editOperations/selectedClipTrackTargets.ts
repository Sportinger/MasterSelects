import type { TimelineClip, TimelineTrack } from '../../../types';

export interface SelectedClipTrackTargetResolution {
  targetTrackIdByClipId: ReadonlyMap<string, string>;
  invalidClipIds: readonly string[];
}

/**
 * Applies the lead clip's vertical track delta to selected peers in the same
 * track family. Cross-family peers (for example linked audio selected with a
 * video clip) intentionally stay on their own tracks.
 */
export function resolveSelectedClipTrackTargets(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
  leadClipId: string,
  requestedLeadTrackId: string,
  selectedClipIds?: Iterable<string>,
): SelectedClipTrackTargetResolution {
  const leadClip = clips.find(clip => clip.id === leadClipId);
  if (!leadClip) {
    return {
      targetTrackIdByClipId: new Map(),
      invalidClipIds: [leadClipId],
    };
  }

  const selectedIds = new Set(selectedClipIds ?? []);
  const movingClipIds = selectedIds.has(leadClipId) ? [...selectedIds] : [leadClipId];
  const movingClips = movingClipIds
    .map(clipId => clips.find(clip => clip.id === clipId))
    .filter((clip): clip is TimelineClip => clip !== undefined);
  const targetTrackIdByClipId = new Map(
    movingClips.map(clip => [clip.id, clip.trackId] as const),
  );
  const missingTrackClipIds = movingClips
    .filter(clip => !tracks.some(track => track.id === clip.trackId))
    .map(clip => clip.id);
  if (missingTrackClipIds.length > 0) {
    return { targetTrackIdByClipId, invalidClipIds: missingTrackClipIds };
  }
  const leadTrack = tracks.find(track => track.id === leadClip.trackId);
  const requestedLeadTrack = tracks.find(track => track.id === requestedLeadTrackId);
  const sameFamilyClips = leadTrack
    ? movingClips.filter(clip => tracks.find(track => track.id === clip.trackId)?.type === leadTrack.type)
    : [leadClip];

  // A single lead may target the provisional new-track id. Moving multiple
  // same-family tracks there needs a separate multi-track creation policy.
  if (!leadTrack || !requestedLeadTrack) {
    if (sameFamilyClips.length === 1) {
      targetTrackIdByClipId.set(leadClip.id, requestedLeadTrackId);
      return { targetTrackIdByClipId, invalidClipIds: [] };
    }
    return {
      targetTrackIdByClipId,
      invalidClipIds: sameFamilyClips.map(clip => clip.id),
    };
  }

  if (requestedLeadTrack.type !== leadTrack.type) {
    return { targetTrackIdByClipId, invalidClipIds: [leadClip.id] };
  }

  const familyTracks = tracks.filter(track => track.type === leadTrack.type);
  const leadSourceIndex = familyTracks.findIndex(track => track.id === leadTrack.id);
  const leadTargetIndex = familyTracks.findIndex(track => track.id === requestedLeadTrack.id);
  const trackDelta = leadTargetIndex - leadSourceIndex;
  const pendingTargets = new Map<string, string>();
  const invalidClipIds: string[] = [];

  for (const clip of sameFamilyClips) {
    const sourceIndex = familyTracks.findIndex(track => track.id === clip.trackId);
    const targetTrack = familyTracks[sourceIndex + trackDelta];
    if (sourceIndex < 0 || !targetTrack || targetTrack.locked) {
      invalidClipIds.push(clip.id);
      continue;
    }
    pendingTargets.set(clip.id, targetTrack.id);
  }

  if (invalidClipIds.length > 0) {
    return { targetTrackIdByClipId, invalidClipIds };
  }
  for (const [clipId, trackId] of pendingTargets) {
    targetTrackIdByClipId.set(clipId, trackId);
  }
  return { targetTrackIdByClipId, invalidClipIds: [] };
}
