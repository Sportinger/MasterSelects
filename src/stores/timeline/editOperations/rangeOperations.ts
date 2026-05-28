import type { TimelineClip, TimelineTrack } from '../../../types';
import { cloneSourceForPart, deepCloneClipProps } from './splitBatchOperations';
import type {
  ExtractRangeOperation,
  LiftRangeOperation,
  TimelineEditWarning,
  TimelineRangeOperationRange,
} from './types';

const EPSILON = 0.0001;

type RangeEditOperation = LiftRangeOperation | ExtractRangeOperation;

interface ClipPartDraft {
  originalClip: TimelineClip;
  clip: TimelineClip;
  start: number;
  end: number;
}

export interface RangeEditApplyResult {
  clips: TimelineClip[];
  deletedClips: TimelineClip[];
  changedClipIds: string[];
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function normalizeRange(range: TimelineRangeOperationRange | null | undefined): TimelineRangeOperationRange | null {
  if (!range) return null;
  const startTime = Math.max(0, Math.min(range.startTime, range.endTime));
  const endTime = Math.max(startTime, Math.max(range.startTime, range.endTime));
  if (endTime - startTime <= EPSILON) return null;
  return {
    startTime,
    endTime,
    trackIds: [...new Set(range.trackIds)],
  };
}

function isTrackEligible(track: TimelineTrack | undefined): boolean {
  return !!track && track.locked !== true && track.visible !== false;
}

function intersectsRange(clip: TimelineClip, range: TimelineRangeOperationRange): boolean {
  return getClipEnd(clip) > range.startTime + EPSILON && clip.startTime < range.endTime - EPSILON;
}

function expandLinkedTrackIds(
  clips: TimelineClip[],
  range: TimelineRangeOperationRange,
  includeLinked: boolean,
): Set<string> {
  const trackIds = new Set(range.trackIds);
  if (!includeLinked) return trackIds;

  for (const clip of clips) {
    if (!trackIds.has(clip.trackId) || !intersectsRange(clip, range) || !clip.linkedClipId) continue;
    const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId);
    if (linkedClip) trackIds.add(linkedClip.trackId);
  }
  return trackIds;
}

function createClipPart(
  clip: TimelineClip,
  start: number,
  end: number,
  useOriginalId: boolean,
  suffix: string,
): TimelineClip {
  const duration = end - start;
  const inPoint = clip.inPoint + (start - clip.startTime);
  return {
    ...clip,
    ...deepCloneClipProps(clip),
    id: useOriginalId ? clip.id : `${clip.id}-${suffix}`,
    startTime: start,
    duration,
    inPoint,
    outPoint: inPoint + duration,
    source: useOriginalId ? clip.source : cloneSourceForPart(clip),
    linkedClipId: undefined,
    transitionIn: Math.abs(start - clip.startTime) <= EPSILON ? clip.transitionIn : undefined,
    transitionOut: Math.abs(end - getClipEnd(clip)) <= EPSILON ? clip.transitionOut : undefined,
  };
}

function createPartsForClip(clip: TimelineClip, range: TimelineRangeOperationRange, suffixBase: string): ClipPartDraft[] {
  const segments: Array<{ start: number; end: number }> = [];
  const clipEnd = getClipEnd(clip);

  if (clip.startTime < range.startTime - EPSILON) {
    segments.push({ start: clip.startTime, end: Math.min(range.startTime, clipEnd) });
  }
  if (clipEnd > range.endTime + EPSILON) {
    segments.push({ start: Math.max(range.endTime, clip.startTime), end: clipEnd });
  }

  return segments
    .filter((segment) => segment.end - segment.start > EPSILON)
    .map((segment, index) => {
      const clipPart = createClipPart(clip, segment.start, segment.end, index === 0, `${suffixBase}-p${index}`);
      return {
        originalClip: clip,
        clip: clipPart,
        start: segment.start,
        end: segment.end,
      };
    });
}

function reconnectLinkedParts(parts: ClipPartDraft[]): TimelineClip[] {
  return parts.map((part) => {
    const linkedOriginalId = part.originalClip.linkedClipId;
    if (!linkedOriginalId) return part.clip;

    const linkedPart = parts.find((candidate) =>
      candidate.originalClip.id === linkedOriginalId &&
      Math.abs(candidate.start - part.start) <= EPSILON &&
      Math.abs(candidate.end - part.end) <= EPSILON
    );
    return linkedPart
      ? { ...part.clip, linkedClipId: linkedPart.clip.id }
      : part.clip;
  });
}

export function applyRangeEditOperation(
  operation: RangeEditOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
  currentRange: TimelineRangeOperationRange | null,
): RangeEditApplyResult {
  const range = normalizeRange(operation.range ?? currentRange);
  if (!range) {
    return {
      clips,
      deletedClips: [],
      changedClipIds: [],
      selectedClipIds,
      warnings: [{ code: 'invalid-range', message: 'Select a valid timeline range before running this command.' }],
    };
  }

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const allowedTrackIds = expandLinkedTrackIds(clips, range, operation.includeLinked !== false);
  const lockedTrackIds = [...allowedTrackIds].filter((trackId) => !isTrackEligible(trackById.get(trackId)));
  const warnings: TimelineEditWarning[] = lockedTrackIds.map((trackId) => ({
    code: 'track-locked',
    trackId,
    message: 'Skipped locked or hidden track while editing the range.',
  }));
  const eligibleTrackIds = new Set([...allowedTrackIds].filter((trackId) => isTrackEligible(trackById.get(trackId))));
  const suffixBase = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const changedClipIds = new Set<string>();
  const deletedClips: TimelineClip[] = [];
  const partDrafts: ClipPartDraft[] = [];
  const untouchedClips: TimelineClip[] = [];
  const rippleDelta = range.endTime - range.startTime;

  for (const clip of clips) {
    if (!eligibleTrackIds.has(clip.trackId) || !intersectsRange(clip, range)) {
      untouchedClips.push(clip);
      continue;
    }

    changedClipIds.add(clip.id);
    const parts = createPartsForClip(clip, range, `${clip.id}-${suffixBase}`);
    if (parts.length === 0) {
      deletedClips.push(clip);
    } else {
      partDrafts.push(...parts);
    }
  }

  if (changedClipIds.size === 0) {
    return {
      clips,
      deletedClips: [],
      changedClipIds: [],
      selectedClipIds,
      warnings: warnings.length > 0 ? warnings : [{ code: 'no-op', message: 'No clips intersect the selected range.' }],
    };
  }

  const partClips = reconnectLinkedParts(partDrafts);
  const cleanedUntouchedClips = untouchedClips.map((clip) => (
    clip.linkedClipId && changedClipIds.has(clip.linkedClipId)
      ? { ...clip, linkedClipId: undefined }
      : clip
  ));
  const nextSelectedClipIds = new Set(selectedClipIds);
  for (const clipId of changedClipIds) nextSelectedClipIds.delete(clipId);

  let nextClips = [...cleanedUntouchedClips, ...partClips];
  if (operation.type === 'extract-range') {
    nextClips = nextClips.map((clip) => {
      if (!eligibleTrackIds.has(clip.trackId) || clip.startTime < range.endTime - EPSILON) return clip;
      changedClipIds.add(clip.id);
      return { ...clip, startTime: Math.max(0, clip.startTime - rippleDelta) };
    });
  }
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
  nextClips = nextClips.toSorted((a, b) =>
    (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) ||
    a.startTime - b.startTime ||
    a.id.localeCompare(b.id)
  );

  return {
    clips: nextClips,
    deletedClips,
    changedClipIds: [...changedClipIds, ...partClips.map((clip) => clip.id)],
    selectedClipIds: nextSelectedClipIds,
    warnings,
  };
}
