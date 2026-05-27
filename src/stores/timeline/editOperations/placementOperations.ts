import type { TimelineClip, TimelineTrack } from '../../../types';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { cloneSourceForPart, deepCloneClipProps } from './splitBatchOperations';
import type { PlaceTimelineRangeOperation, TimelineEditWarning } from './types';

const EPSILON = 0.001;

export interface PlacementApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  deletedClips: TimelineClip[];
  warnings: TimelineEditWarning[];
}

interface PlacementRange {
  startTime: number;
  endTime: number;
  duration: number;
}

function clipEnd(clip: Pick<TimelineClip, 'startTime' | 'duration'>): number {
  return clip.startTime + clip.duration;
}

function isLockedTrack(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function getTrackIdsForOperation(
  operation: PlaceTimelineRangeOperation,
  clips: TimelineClip[],
): string[] {
  if (operation.targetClipId) {
    const targetClip = clips.find((clip) => clip.id === operation.targetClipId);
    if (!targetClip) return [];

    const trackIds = new Set([targetClip.trackId]);
    if (operation.includeLinked !== false && targetClip.linkedClipId) {
      const linkedClip = clips.find((clip) => clip.id === targetClip.linkedClipId);
      if (linkedClip) trackIds.add(linkedClip.trackId);
    }
    return [...trackIds];
  }

  return [...new Set(operation.trackIds ?? [])];
}

function resolvePlacementRange(
  operation: PlaceTimelineRangeOperation,
  clips: TimelineClip[],
): { range: PlacementRange | null; warnings: TimelineEditWarning[] } {
  const targetClip = operation.targetClipId
    ? clips.find((clip) => clip.id === operation.targetClipId)
    : undefined;

  if (operation.targetClipId && !targetClip) {
    return {
      range: null,
      warnings: [{
        code: 'clip-not-found',
        clipId: operation.targetClipId,
        message: 'Target clip not found for placement operation.',
      }],
    };
  }

  const startTime = targetClip?.startTime ?? operation.startTime;
  const duration = targetClip?.duration ?? operation.duration;

  if (!Number.isFinite(startTime) || startTime === undefined) {
    return {
      range: null,
      warnings: [{ code: 'invalid-time', message: 'Placement start time must be a finite number.' }],
    };
  }

  if (!Number.isFinite(duration) || duration === undefined || duration <= EPSILON) {
    return {
      range: null,
      warnings: [{ code: 'invalid-range', message: 'Placement duration must be greater than zero.' }],
    };
  }

  const safeStartTime = Math.max(0, startTime);
  return {
    range: {
      startTime: safeStartTime,
      endTime: safeStartTime + duration,
      duration,
    },
    warnings: [],
  };
}

function getTargetClipIds(
  operation: PlaceTimelineRangeOperation,
  clips: TimelineClip[],
  trackIds: string[],
): Set<string> {
  const trackIdSet = new Set(trackIds);
  const targetClipIds = new Set<string>();

  for (const clip of clips) {
    if (trackIdSet.has(clip.trackId)) {
      targetClipIds.add(clip.id);
    }
  }

  if (operation.includeLinked !== false) {
    for (const clipId of [...targetClipIds]) {
      const clip = clips.find((candidate) => candidate.id === clipId);
      if (clip?.linkedClipId) targetClipIds.add(clip.linkedClipId);
    }
  }

  return targetClipIds;
}

function createSplitPartId(clipId: string, suffix: string): string {
  return `${clipId}-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getSplitRightIds(
  clips: TimelineClip[],
  targetClipIds: Set<string>,
  shouldSplit: (clip: TimelineClip) => boolean,
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const clip of clips) {
    if (!targetClipIds.has(clip.id)) continue;
    if (!shouldSplit(clip)) continue;
    ids.set(clip.id, createSplitPartId(clip.id, 'right'));
  }
  return ids;
}

function withTrimmedTail(clip: TimelineClip, endTime: number): TimelineClip {
  const nextDuration = Math.max(EPSILON, endTime - clip.startTime);
  return clearProcessedAudioAnalysisRefs({
    ...clip,
    duration: nextDuration,
    outPoint: clip.inPoint + nextDuration,
    transitionOut: undefined,
  });
}

function withTrimmedHead(clip: TimelineClip, startTime: number): TimelineClip {
  const currentEndTime = clipEnd(clip);
  const sourceDelta = Math.max(0, startTime - clip.startTime);
  return clearProcessedAudioAnalysisRefs({
    ...clip,
    startTime,
    duration: Math.max(EPSILON, currentEndTime - startTime),
    inPoint: clip.inPoint + sourceDelta,
    transitionIn: undefined,
  });
}

function createRightSplitPart(
  clip: TimelineClip,
  rightStartTime: number,
  rightTimelineStartTime: number,
  splitRightIds: Map<string, string>,
): TimelineClip {
  const rightId = splitRightIds.get(clip.id) ?? createSplitPartId(clip.id, 'right');
  const linkedRightId = clip.linkedClipId ? splitRightIds.get(clip.linkedClipId) : undefined;
  const currentEndTime = clipEnd(clip);
  const sourceDelta = Math.max(0, rightStartTime - clip.startTime);

  return clearProcessedAudioAnalysisRefs({
    ...clip,
    ...deepCloneClipProps(clip),
    id: rightId,
    startTime: rightTimelineStartTime,
    duration: Math.max(EPSILON, currentEndTime - rightStartTime),
    inPoint: clip.inPoint + sourceDelta,
    outPoint: clip.outPoint,
    linkedClipId: linkedRightId,
    source: cloneSourceForPart(clip),
    transitionIn: undefined,
  });
}

function finalizeLinks(clips: TimelineClip[]): TimelineClip[] {
  const clipIds = new Set(clips.map((clip) => clip.id));
  return clips.map((clip) => (
    clip.linkedClipId && !clipIds.has(clip.linkedClipId)
      ? { ...clip, linkedClipId: undefined }
      : clip
  ));
}

function applyInsertRange(
  clips: TimelineClip[],
  targetClipIds: Set<string>,
  range: PlacementRange,
): PlacementApplyResult {
  const changedClipIds = new Set<string>();
  const splitRightIds = getSplitRightIds(
    clips,
    targetClipIds,
    (clip) => clip.startTime < range.startTime - EPSILON && clipEnd(clip) > range.startTime + EPSILON,
  );
  const nextClips: TimelineClip[] = [];

  for (const clip of clips) {
    if (!targetClipIds.has(clip.id)) {
      nextClips.push(clip);
      continue;
    }

    const endTime = clipEnd(clip);
    if (endTime <= range.startTime + EPSILON) {
      nextClips.push(clip);
      continue;
    }

    if (clip.startTime >= range.startTime - EPSILON) {
      changedClipIds.add(clip.id);
      nextClips.push({ ...clip, startTime: clip.startTime + range.duration });
      continue;
    }

    changedClipIds.add(clip.id);
    const leftPart = withTrimmedTail(clip, range.startTime);
    const rightPart = createRightSplitPart(
      clip,
      range.startTime,
      range.startTime + range.duration,
      splitRightIds,
    );
    changedClipIds.add(rightPart.id);
    nextClips.push(leftPart, rightPart);
  }

  return {
    clips: finalizeLinks(nextClips),
    changedClipIds: [...changedClipIds],
    deletedClips: [],
    warnings: [],
  };
}

function applyOverwriteRange(
  clips: TimelineClip[],
  targetClipIds: Set<string>,
  range: PlacementRange,
  rippleDelta = 0,
): PlacementApplyResult {
  const changedClipIds = new Set<string>();
  const deletedClips: TimelineClip[] = [];
  const splitRightIds = getSplitRightIds(
    clips,
    targetClipIds,
    (clip) => clip.startTime < range.startTime - EPSILON && clipEnd(clip) > range.endTime + EPSILON,
  );
  const nextClips: TimelineClip[] = [];

  for (const clip of clips) {
    if (!targetClipIds.has(clip.id)) {
      nextClips.push(clip);
      continue;
    }

    const endTime = clipEnd(clip);
    const overlaps = clip.startTime < range.endTime - EPSILON && endTime > range.startTime + EPSILON;
    if (!overlaps) {
      const shouldRipple = rippleDelta !== 0 && clip.startTime >= range.endTime - EPSILON;
      if (shouldRipple) {
        changedClipIds.add(clip.id);
        nextClips.push({ ...clip, startTime: Math.max(0, clip.startTime + rippleDelta) });
      } else {
        nextClips.push(clip);
      }
      continue;
    }

    changedClipIds.add(clip.id);

    if (clip.startTime >= range.startTime - EPSILON && endTime <= range.endTime + EPSILON) {
      deletedClips.push(clip);
      continue;
    }

    if (clip.startTime < range.startTime - EPSILON && endTime > range.endTime + EPSILON) {
      const leftPart = withTrimmedTail(clip, range.startTime);
      const rightPart = createRightSplitPart(clip, range.endTime, range.endTime, splitRightIds);
      changedClipIds.add(rightPart.id);
      nextClips.push(leftPart, rightPart);
      continue;
    }

    if (clip.startTime < range.startTime - EPSILON) {
      nextClips.push(withTrimmedTail(clip, range.startTime));
      continue;
    }

    nextClips.push(withTrimmedHead(clip, range.endTime));
  }

  return {
    clips: finalizeLinks(nextClips),
    changedClipIds: [...changedClipIds],
    deletedClips,
    warnings: [],
  };
}

export function applyPlaceTimelineRangeOperation(
  operation: PlaceTimelineRangeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): PlacementApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const { range, warnings: rangeWarnings } = resolvePlacementRange(operation, clips);
  if (!range) {
    return { clips, changedClipIds: [], deletedClips: [], warnings: rangeWarnings };
  }

  const requestedTrackIds = getTrackIdsForOperation(operation, clips);
  if (requestedTrackIds.length === 0) {
    return {
      clips,
      changedClipIds: [],
      deletedClips: [],
      warnings: [{ code: 'invalid-range', message: 'Placement operation needs at least one target track.' }],
    };
  }

  const targetTrackIds = requestedTrackIds.filter((trackId) => {
    if (!isLockedTrack(tracks, trackId)) return true;
    warnings.push({
      code: 'track-locked',
      trackId,
      message: 'Locked tracks are skipped during placement.',
    });
    return false;
  });

  if (targetTrackIds.length === 0) {
    return { clips, changedClipIds: [], deletedClips: [], warnings };
  }

  const targetClipIds = getTargetClipIds(operation, clips, targetTrackIds);
  if (targetClipIds.size === 0) {
    return { clips, changedClipIds: [], deletedClips: [], warnings };
  }

  const result = operation.mode === 'insert'
    ? applyInsertRange(clips, targetClipIds, range)
    : applyOverwriteRange(
      clips,
      targetClipIds,
      range,
      operation.mode === 'ripple-overwrite' && Number.isFinite(operation.rippleDelta)
        ? operation.rippleDelta
        : 0,
    );

  return {
    ...result,
    warnings: [...warnings, ...result.warnings],
  };
}
