import type { TimelineClip, TimelineTrack } from '../../../types';
import type { SelectClipsFromTimeOperation, TimelineEditWarning } from './types';

function isTrackEligible(track: TimelineTrack | undefined): boolean {
  return !!track && track.locked !== true && track.visible !== false;
}

function resolveLinkedClipIds(clips: TimelineClip[], selectedIds: Set<string>): Set<string> {
  const nextIds = new Set(selectedIds);
  for (const clip of clips) {
    if (nextIds.has(clip.id) && clip.linkedClipId) {
      nextIds.add(clip.linkedClipId);
    }
  }
  return nextIds;
}

export function selectClipsFromTimeOperation(
  operation: SelectClipsFromTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): { selectedClipIds: string[]; warnings: TimelineEditWarning[] } {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const allowedTrackIds = operation.trackIds
    ? new Set(operation.trackIds)
    : new Set(tracks.filter(isTrackEligible).map((track) => track.id));
  const warnings: TimelineEditWarning[] = [];
  const selectedIds = new Set<string>();

  for (const clip of clips) {
    if (!allowedTrackIds.has(clip.trackId)) continue;
    const track = trackById.get(clip.trackId);
    if (!isTrackEligible(track)) continue;

    const clipEnd = clip.startTime + clip.duration;
    const shouldSelect = operation.direction === 'forward'
      ? clipEnd > operation.time
      : clip.startTime < operation.time;
    if (shouldSelect) selectedIds.add(clip.id);
  }

  const withLinked = operation.includeLinked === false ? selectedIds : resolveLinkedClipIds(clips, selectedIds);
  if (withLinked.size === 0) {
    warnings.push({
      code: 'no-op',
      message: 'No clips matched the selection operation.',
    });
  }

  return {
    selectedClipIds: [...withLinked],
    warnings,
  };
}
