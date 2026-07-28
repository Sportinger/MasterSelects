import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipDragState } from '../types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import { resolveSelectedClipTrackTargets } from '../../../stores/timeline/editOperations/selectedClipTrackTargets';
import type {
  ResolvedClipMove,
  ResolvedClipMoveOperationPlan,
} from '../../../stores/timeline/editOperations';

const MIN_TOOL_GESTURE_DURATION = 0.1;
const CLIP_DRAG_RESOLVED_MOVE_BLOCK_REASONS = new Set([
  'fallback-track',
  'overlap-trim',
  'selected-linked-pair',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function timeRangesOverlap(startA: number, durationA: number, startB: number, durationB: number): boolean {
  const endA = startA + durationA;
  const endB = startB + durationB;
  return endA > startB && startA < endB;
}

function getSourceDuration(clip: TimelineClip): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, MIN_TOOL_GESTURE_DURATION);
}

function getSortedTrackClips(clips: TimelineClip[], trackId: string, excludeClipId: string): TimelineClip[] {
  return clips
    .filter((candidate) => candidate.trackId === trackId && candidate.id !== excludeClipId)
    .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
}

function findPreviousClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  const candidates = getSortedTrackClips(clips, clip.trackId, clip.id)
    .filter((candidate) => getClipEnd(candidate) <= clip.startTime + 0.0001);
  return candidates[candidates.length - 1] ?? null;
}

function findNextClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  return getSortedTrackClips(clips, clip.trackId, clip.id)
    .find((candidate) => candidate.startTime >= getClipEnd(clip) - 0.0001) ?? null;
}

export function clampSlipSourceDelta(clip: TimelineClip, sourceDelta: number): number {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const sourceDuration = getSourceDuration(clip);
  const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
  const nextInPoint = clamp(clip.inPoint + sourceDelta, 0, maxInPoint);
  return nextInPoint - clip.inPoint;
}

export function clampSlideTimelineDelta(clips: TimelineClip[], clip: TimelineClip, timelineDelta: number): number {
  const previousClip = findPreviousClip(clips, clip);
  const nextClip = findNextClip(clips, clip);
  if (!previousClip || !nextClip) return 0;

  const minDelta = -(previousClip.duration - MIN_TOOL_GESTURE_DURATION);
  const maxDelta = nextClip.duration - MIN_TOOL_GESTURE_DURATION;
  return clamp(timelineDelta, minDelta, maxDelta);
}

export function createClipDragTypedMoveCommitOperation(
  resolutionId: string,
  resolvedMoves: readonly ResolvedClipMove[],
  operationPlan: ResolvedClipMoveOperationPlan,
): TimelineEditOperation | null {
  if (operationPlan.canApplyWithMoveClipsOperation) {
    return operationPlan.operation;
  }

  const canApplyResolvedMove =
    operationPlan.blockedReasons.length > 0 &&
    operationPlan.blockedReasons.every(reason => CLIP_DRAG_RESOLVED_MOVE_BLOCK_REASONS.has(reason));

  if (!canApplyResolvedMove) return null;

  return {
    id: resolutionId,
    type: 'move-clips-resolved',
    resolvedMoves: [...resolvedMoves],
  };
}

export function collectDragExcludeClipIds(
  selectedClipIds: Iterable<string>,
  clipMap: Map<string, TimelineClip>,
): string[] {
  const excludeClipIds = new Set(selectedClipIds);
  for (const clipId of excludeClipIds) {
    const clip = clipMap.get(clipId);
    if (clip?.linkedClipId) {
      excludeClipIds.add(clip.linkedClipId);
    }
  }
  return [...excludeClipIds];
}

export function getClipDragTrackTargets(
  clipMap: Map<string, TimelineClip>,
  tracks: readonly TimelineTrack[],
  drag: ClipDragState,
  primaryTrackId: string,
): ReadonlyMap<string, string> {
  return resolveSelectedClipTrackTargets(
    tracks,
    [...clipMap.values()],
    drag.clipId,
    primaryTrackId,
    [drag.clipId, ...(drag.multiSelectClipIds ?? [])],
  ).targetTrackIdByClipId;
}

export function getClipDragOverlapClipIds(
  clipMap: Map<string, TimelineClip>,
  tracks: readonly TimelineTrack[],
  drag: ClipDragState,
  primaryStartTime: number,
  primaryTrackId: string,
  timeDelta: number,
  excludeClipIds: string[],
): string[] {
  const movingClip = clipMap.get(drag.clipId);
  if (!movingClip) return [];
  const trackTargets = getClipDragTrackTargets(clipMap, tracks, drag, primaryTrackId);

  const movedClips = new Map<string, { clip: TimelineClip; startTime: number; trackId: string }>();
  const excludedIds = new Set(excludeClipIds);
  const addMovedClip = (clip: TimelineClip, startTime: number, trackId = clip.trackId) => {
    movedClips.set(clip.id, { clip, startTime, trackId });
    excludedIds.add(clip.id);
  };

  addMovedClip(movingClip, primaryStartTime, trackTargets.get(movingClip.id) ?? primaryTrackId);

  if (drag.multiSelectClipIds?.length && drag.multiSelectTimeDelta !== undefined) {
    for (const selectedId of drag.multiSelectClipIds) {
      const selectedClip = clipMap.get(selectedId);
      if (selectedClip) {
        addMovedClip(
          selectedClip,
          selectedClip.startTime + drag.multiSelectTimeDelta,
          trackTargets.get(selectedClip.id) ?? selectedClip.trackId,
        );
      }
    }
  }

  if (!drag.altKeyPressed) {
    for (const moved of Array.from(movedClips.values())) {
      const linkedClip = moved.clip.linkedClipId ? clipMap.get(moved.clip.linkedClipId) : undefined;
      if (linkedClip && !movedClips.has(linkedClip.id)) {
        addMovedClip(
          linkedClip,
          linkedClip.startTime + timeDelta,
          trackTargets.get(linkedClip.id) ?? linkedClip.trackId,
        );
      }
    }

    if (movingClip.linkedGroupId) {
      for (const clip of clipMap.values()) {
        if (clip.linkedGroupId === movingClip.linkedGroupId && !movedClips.has(clip.id)) {
          addMovedClip(
            clip,
            clip.startTime + timeDelta,
            trackTargets.get(clip.id) ?? clip.trackId,
          );
        }
      }
    }
  }

  const overlapIds = new Set<string>();
  for (const moved of movedClips.values()) {
    for (const candidate of clipMap.values()) {
      if (excludedIds.has(candidate.id) || candidate.trackId !== moved.trackId) continue;
      if (timeRangesOverlap(moved.startTime, moved.clip.duration, candidate.startTime, candidate.duration)) {
        overlapIds.add(candidate.id);
      }
    }
  }

  return [...overlapIds];
}

type ClipDragResistanceResolver = (
  clipId: string,
  rawTime: number,
  trackId: string,
  duration: number,
  zoom?: number,
  excludeClipIds?: string[],
) => { startTime: number; forcingOverlap: boolean };

export interface ClipDragGroupPlacement {
  forcingOverlap: boolean;
  overlapClipIds: string[];
  primaryStartTime: number;
  timeDelta: number;
}

export function resolveClipDragGroupPlacement(
  clipMap: Map<string, TimelineClip>,
  tracks: readonly TimelineTrack[],
  drag: ClipDragState,
  primaryTrackId: string,
  initialTimeDelta: number,
  initialForcingOverlap: boolean,
  excludeClipIds: string[],
  getPositionWithResistance: ClipDragResistanceResolver,
): ClipDragGroupPlacement {
  const movingClip = clipMap.get(drag.clipId);
  const primaryOriginalStartTime = movingClip?.startTime ?? drag.originalStartTime;
  const trackTargets = getClipDragTrackTargets(clipMap, tracks, drag, primaryTrackId);
  const selectedClipIds = [drag.clipId, ...(drag.multiSelectClipIds ?? [])];
  let timeDelta = initialTimeDelta;
  let forcingOverlap = initialForcingOverlap;

  const applyFollowerResistance = (clip: TimelineClip) => {
    const result = getPositionWithResistance(
      clip.id,
      clip.startTime + timeDelta,
      trackTargets.get(clip.id) ?? clip.trackId,
      clip.duration,
      undefined,
      excludeClipIds,
    );
    const actualDelta = result.startTime - clip.startTime;
    if (Math.abs(actualDelta) < Math.abs(timeDelta)) {
      timeDelta = actualDelta;
      forcingOverlap = result.forcingOverlap || forcingOverlap;
    }
  };

  if (!drag.altKeyPressed) {
    const selectedClipIdSet = new Set(selectedClipIds);
    const checkedLinkedIds = new Set<string>();
    for (const selectedId of selectedClipIds) {
      const selectedClip = clipMap.get(selectedId);
      const linkedClip = selectedClip?.linkedClipId
        ? clipMap.get(selectedClip.linkedClipId)
        : undefined;
      if (
        !linkedClip ||
        selectedClipIdSet.has(linkedClip.id) ||
        checkedLinkedIds.has(linkedClip.id)
      ) continue;
      checkedLinkedIds.add(linkedClip.id);
      applyFollowerResistance(linkedClip);
    }
  }

  if (drag.multiSelectClipIds?.length && !forcingOverlap) {
    for (const selectedId of drag.multiSelectClipIds) {
      const selectedClip = clipMap.get(selectedId);
      if (selectedClip) applyFollowerResistance(selectedClip);
    }
  }

  const primaryStartTime = primaryOriginalStartTime + timeDelta;
  const previewDrag = {
    ...drag,
    currentTrackId: primaryTrackId,
    snappedTime: primaryStartTime,
    multiSelectTimeDelta: drag.multiSelectClipIds?.length ? timeDelta : undefined,
  };
  return {
    forcingOverlap,
    overlapClipIds: getClipDragOverlapClipIds(
      clipMap,
      tracks,
      previewDrag,
      primaryStartTime,
      primaryTrackId,
      timeDelta,
      excludeClipIds,
    ),
    primaryStartTime,
    timeDelta,
  };
}
