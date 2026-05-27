import type { TimelineClip, TimelineTrack } from '../../../types';
import type { SplitAllAtTimeOperation, SplitAtTimeOperation, TimelineEditWarning } from './types';

const MIN_SPLIT_EDGE_DISTANCE_SECONDS = 0.001;

function isTrackEligible(track: TimelineTrack | undefined): boolean {
  return !!track && track.locked !== true && track.visible !== false;
}

function isClipSplittableAt(clip: TimelineClip, time: number): boolean {
  return (
    time > clip.startTime + MIN_SPLIT_EDGE_DISTANCE_SECONDS &&
    time < clip.startTime + clip.duration - MIN_SPLIT_EDGE_DISTANCE_SECONDS
  );
}

function removeLinkedDuplicates(clips: TimelineClip[], clipIds: string[]): string[] {
  const requested = new Set(clipIds);
  const emittedPairKeys = new Set<string>();
  const uniqueIds: string[] = [];

  for (const clipId of clipIds) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;

    if (clip.linkedClipId && requested.has(clip.linkedClipId)) {
      const pairKey = [clip.id, clip.linkedClipId].toSorted().join(':');
      if (emittedPairKeys.has(pairKey)) continue;
      emittedPairKeys.add(pairKey);
    }

    uniqueIds.push(clipId);
  }

  return uniqueIds;
}

export function resolveSplitAtTimeTargets(
  operation: SplitAtTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): { clipIds: string[]; warnings: TimelineEditWarning[] } {
  const warnings: TimelineEditWarning[] = [];
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const validClipIds: string[] = [];

  for (const clipId of operation.clipIds) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      warnings.push({ code: 'clip-not-found', message: 'Clip not found for split operation.', clipId });
      continue;
    }
    if (!isTrackEligible(trackById.get(clip.trackId))) {
      warnings.push({ code: 'track-locked', message: 'Cannot split clip on a locked or hidden track.', clipId, trackId: clip.trackId });
      continue;
    }
    if (!isClipSplittableAt(clip, operation.time)) {
      warnings.push({ code: 'invalid-time', message: 'Split time must be inside the clip boundaries.', clipId });
      continue;
    }
    validClipIds.push(clip.id);
  }

  const clipIds = operation.includeLinked === false
    ? validClipIds
    : removeLinkedDuplicates(clips, validClipIds);

  if (clipIds.length === 0) {
    warnings.push({ code: 'no-op', message: 'No valid clips to split.' });
  }

  return { clipIds, warnings };
}

export function resolveSplitAllAtTimeTargets(
  operation: SplitAllAtTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): { clipIds: string[]; warnings: TimelineEditWarning[] } {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const allowedTrackIds = operation.trackIds
    ? new Set(operation.trackIds)
    : new Set(tracks.filter(isTrackEligible).map((track) => track.id));
  const clipIds = clips
    .filter((clip) => allowedTrackIds.has(clip.trackId))
    .filter((clip) => isTrackEligible(trackById.get(clip.trackId)))
    .filter((clip) => isClipSplittableAt(clip, operation.time))
    .map((clip) => clip.id);

  const uniqueClipIds = operation.includeLinked === false
    ? clipIds
    : removeLinkedDuplicates(clips, clipIds);

  return {
    clipIds: uniqueClipIds,
    warnings: uniqueClipIds.length === 0 ? [{ code: 'no-op', message: 'No clips cross the split time.' }] : [],
  };
}
