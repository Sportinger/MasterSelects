import type { TimelineClip, TimelineTrack } from '../../../types';
import type { DeleteAllGapsOperation, DeleteGapAtTimeOperation, RippleDeleteSelectionOperation, TimelineEditWarning } from './types';

const EPSILON = 0.0001;

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function collectLinkedIds(clips: TimelineClip[], clipIds: Iterable<string>): Set<string> {
  const ids = new Set(clipIds);
  for (const clip of clips) {
    if (ids.has(clip.id) && clip.linkedClipId) ids.add(clip.linkedClipId);
    if (clip.linkedClipId && ids.has(clip.linkedClipId)) ids.add(clip.id);
  }
  return ids;
}

function getRippleDeleteRangeByTrack(deletedClips: TimelineClip[]): Map<string, { start: number; end: number }> {
  const rangeByTrack = new Map<string, { start: number; end: number }>();
  for (const clip of deletedClips) {
    const current = rangeByTrack.get(clip.trackId);
    const start = Math.min(current?.start ?? clip.startTime, clip.startTime);
    const end = Math.max(current?.end ?? getClipEnd(clip), getClipEnd(clip));
    rangeByTrack.set(clip.trackId, { start, end });
  }
  return rangeByTrack;
}

function findLinkedClip(clip: TimelineClip, clips: TimelineClip[]): TimelineClip | undefined {
  return clips.find((candidate) => candidate.id === clip.linkedClipId || candidate.linkedClipId === clip.id);
}

function addLinkedShiftTargets(
  targetStartByClipId: Map<string, number>,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  warnings: TimelineEditWarning[],
): void {
  for (const [clipId, targetStart] of [...targetStartByClipId.entries()]) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;

    const linkedClip = findLinkedClip(clip, clips);
    if (!linkedClip || targetStartByClipId.has(linkedClip.id)) continue;

    if (isTrackLocked(tracks, linkedClip.trackId)) {
      warnings.push({
        code: 'track-locked',
        message: 'Skipped locked linked clip while deleting gap.',
        clipId: linkedClip.id,
        trackId: linkedClip.trackId,
      });
      continue;
    }

    const delta = targetStart - clip.startTime;
    if (Math.abs(delta) <= EPSILON) continue;
    targetStartByClipId.set(linkedClip.id, Math.max(0, linkedClip.startTime + delta));
  }
}

export function applyRippleDeleteSelectionOperation(
  operation: RippleDeleteSelectionOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
): { clips: TimelineClip[]; selectedClipIds: Set<string>; changedClipIds: string[]; warnings: TimelineEditWarning[] } {
  const requestedIds = operation.clipIds && operation.clipIds.length > 0
    ? new Set(operation.clipIds)
    : new Set(selectedClipIds);
  const idsToDelete = operation.includeLinked === false ? requestedIds : collectLinkedIds(clips, requestedIds);
  const deletedClips = clips.filter((clip) => idsToDelete.has(clip.id));
  const warnings: TimelineEditWarning[] = [];

  if (deletedClips.length === 0) {
    return {
      clips,
      selectedClipIds,
      changedClipIds: [],
      warnings: [{ code: 'no-op', message: 'No selected clips to ripple delete.' }],
    };
  }

  const lockedClip = deletedClips.find((clip) => isTrackLocked(tracks, clip.trackId));
  if (lockedClip) {
    return {
      clips,
      selectedClipIds,
      changedClipIds: [],
      warnings: [{
        code: 'track-locked',
        message: 'Cannot ripple delete clips on locked tracks.',
        clipId: lockedClip.id,
        trackId: lockedClip.trackId,
      }],
    };
  }

  const rangeByTrack = getRippleDeleteRangeByTrack(deletedClips);
  const changedClipIds = new Set<string>(deletedClips.map((clip) => clip.id));
  const nextClips = clips
    .filter((clip) => !idsToDelete.has(clip.id))
    .map((clip) => {
      const range = rangeByTrack.get(clip.trackId);
      if (!range || clip.startTime < range.end - EPSILON) return clip;
      const delta = range.end - range.start;
      changedClipIds.add(clip.id);
      return { ...clip, startTime: Math.max(0, clip.startTime - delta) };
    });

  return {
    clips: nextClips,
    selectedClipIds: new Set(),
    changedClipIds: [...changedClipIds],
    warnings,
  };
}

function findGapAroundTime(trackClips: TimelineClip[], time: number): { start: number; end: number } | null {
  const sorted = trackClips.toSorted((a, b) => a.startTime - b.startTime);
  let previousEnd = 0;

  for (const clip of sorted) {
    if (time > previousEnd + EPSILON && time < clip.startTime - EPSILON) {
      return { start: previousEnd, end: clip.startTime };
    }
    previousEnd = Math.max(previousEnd, getClipEnd(clip));
  }

  return null;
}

export function applyDeleteGapAtTimeOperation(
  operation: DeleteGapAtTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): { clips: TimelineClip[]; changedClipIds: string[]; warnings: TimelineEditWarning[] } {
  const warnings: TimelineEditWarning[] = [];
  const allowedTrackIds = operation.trackIds
    ? new Set(operation.trackIds)
    : new Set(tracks.filter((track) => track.locked !== true && track.visible !== false).map((track) => track.id));
  const shiftByTrack = new Map<string, { start: number; delta: number }>();

  for (const track of tracks) {
    if (!allowedTrackIds.has(track.id)) continue;
    if (track.locked) {
      warnings.push({ code: 'track-locked', message: 'Skipped locked track while deleting gap.', trackId: track.id });
      continue;
    }
    const gap = findGapAroundTime(clips.filter((clip) => clip.trackId === track.id), operation.time);
    if (!gap) continue;
    shiftByTrack.set(track.id, { start: gap.end, delta: gap.end - gap.start });
  }

  if (shiftByTrack.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'no-op', message: 'No timeline gap found at the requested time.' }],
    };
  }

  const targetStartByClipId = new Map<string, number>();
  for (const clip of clips) {
    const shift = shiftByTrack.get(clip.trackId);
    if (!shift || clip.startTime < shift.start - EPSILON) continue;
    targetStartByClipId.set(clip.id, Math.max(0, clip.startTime - shift.delta));
  }

  addLinkedShiftTargets(targetStartByClipId, clips, tracks, warnings);

  const nextClips = clips.map((clip) => {
    const nextStart = targetStartByClipId.get(clip.id);
    return nextStart === undefined ? clip : { ...clip, startTime: nextStart };
  });

  return { clips: nextClips, changedClipIds: [...targetStartByClipId.keys()], warnings };
}

export function applyDeleteAllGapsOperation(
  operation: DeleteAllGapsOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): { clips: TimelineClip[]; changedClipIds: string[]; warnings: TimelineEditWarning[] } {
  const warnings: TimelineEditWarning[] = [];
  const allowedTrackIds = operation.trackIds
    ? new Set(operation.trackIds)
    : new Set(tracks.filter((track) => track.locked !== true && track.visible !== false).map((track) => track.id));
  const nextStartByClipId = new Map<string, number>();

  for (const track of tracks) {
    if (!allowedTrackIds.has(track.id)) continue;
    if (track.locked) {
      warnings.push({ code: 'track-locked', message: 'Skipped locked track while deleting all gaps.', trackId: track.id });
      continue;
    }

    const sorted = clips
      .filter((clip) => clip.trackId === track.id)
      .toSorted((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    let nextStart = 0;
    const startTime = operation.startTime;

    for (const clip of sorted) {
      const currentStart = clip.startTime;
      if (startTime !== undefined && currentStart < startTime - EPSILON) {
        nextStart = Math.max(nextStart, currentStart + clip.duration);
        continue;
      }
      const targetStart = currentStart > nextStart + EPSILON ? nextStart : currentStart;
      if (Math.abs(targetStart - currentStart) > EPSILON) {
        nextStartByClipId.set(clip.id, targetStart);
      }
      nextStart = Math.max(nextStart, targetStart + clip.duration);
    }
  }

  if (nextStartByClipId.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: warnings.length > 0
        ? warnings
        : [{ code: 'no-op', message: 'No timeline gaps found.' }],
    };
  }

  addLinkedShiftTargets(nextStartByClipId, clips, tracks, warnings);

  const nextClips = clips.map((clip) => {
    const nextStart = nextStartByClipId.get(clip.id);
    return nextStart === undefined ? clip : { ...clip, startTime: Math.max(0, nextStart) };
  });

  return { clips: nextClips, changedClipIds: [...nextStartByClipId.keys()], warnings };
}
