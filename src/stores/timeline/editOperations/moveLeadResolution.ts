import type { TimelineClip, TimelineTrack } from '../../../types';
import type {
  ClipMoveFallbackTrackResolution,
  ClipMoveOverlapTrimResolution,
  ClipMoveResistanceResolution,
  ClipMoveSnapResolution,
} from './transactionTypes';
import {
  isTrackCompatible,
  type ResolvedMoveFallbackTrackType,
} from './moveTrackCompatibility';

export type { ResolvedMoveFallbackTrackType } from './moveTrackCompatibility';

const MOVE_EPSILON_SECONDS = 0.000001;

export interface MoveResolutionSnapResult {
  startTime: number;
  snapped: boolean;
  snapEdgeTime?: number | null;
  source?: ClipMoveSnapResolution['source'];
  thresholdPx?: number;
}

export interface MoveResolutionResistanceResult {
  startTime: number;
  forcingOverlap: boolean;
  noFreeSpace?: boolean;
  blockedReason?: ClipMoveResistanceResolution['blockedReason'];
}

export interface ResolveClipMoveRequestInput {
  id: string;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  clipId: string;
  requestedStartTime: number;
  requestedTrackId?: string;
  requestedNewTrackType?: ResolvedMoveFallbackTrackType;
  selectedClipIds?: Iterable<string>;
  includeLinked?: boolean;
  includeGroups?: boolean;
  excludeClipIds?: Iterable<string>;
  getSnappedPosition?: (
    clipId: string,
    desiredStartTime: number,
    trackId: string,
  ) => MoveResolutionSnapResult;
  getPositionWithResistance?: (
    clipId: string,
    desiredStartTime: number,
    trackId: string,
    duration: number,
    excludeClipIds?: readonly string[],
  ) => MoveResolutionResistanceResult;
}

export interface ResolvedLeadMove {
  startTime: number;
  trackId: string;
  snapping: ClipMoveSnapResolution;
  resistance: ClipMoveResistanceResolution;
  fallbackTrack: ClipMoveFallbackTrackResolution;
  overlap: ClipMoveOverlapTrimResolution;
}

export function isTrackLocked(tracks: readonly TimelineTrack[], trackId: string | undefined): boolean {
  return Boolean(trackId && tracks.find(track => track.id === trackId)?.locked);
}

export function findLinkedClip(clip: TimelineClip, clips: readonly TimelineClip[]): TimelineClip | undefined {
  return clips.find(candidate => candidate.id === clip.linkedClipId || candidate.linkedClipId === clip.id);
}

export function createFallbackTrackProvisionalId(type: ResolvedMoveFallbackTrackType): string {
  return `__resolved_move_new_${type}_track__`;
}

export function createNoSnap(requestedStartTime: number): ClipMoveSnapResolution {
  return {
    enabled: false,
    snapped: false,
    requestedStartTime,
    resolvedStartTime: Math.max(0, requestedStartTime),
    source: 'none',
    snapIndicatorTime: null,
  };
}

export function resolveSnap(
  input: ResolveClipMoveRequestInput,
  clip: TimelineClip,
  trackId: string,
): ClipMoveSnapResolution {
  if (!input.getSnappedPosition) {
    return createNoSnap(input.requestedStartTime);
  }

  const snap = input.getSnappedPosition(clip.id, input.requestedStartTime, trackId);
  return {
    enabled: true,
    snapped: snap.snapped,
    requestedStartTime: input.requestedStartTime,
    resolvedStartTime: Math.max(0, snap.startTime),
    source: snap.source ?? (snap.snapped ? 'manual' : 'none'),
    snapIndicatorTime: snap.snapEdgeTime ?? null,
    thresholdPx: snap.thresholdPx,
  };
}

export function createResistance(
  result: MoveResolutionResistanceResult | undefined,
  snappedStartTime: number,
): ClipMoveResistanceResolution {
  if (!result) {
    return {
      mode: 'none',
      applied: false,
      forcingOverlap: false,
    };
  }

  return {
    mode: result.noFreeSpace
      ? 'new-track-zone'
      : result.forcingOverlap
        ? 'overlap-push-through'
        : Math.abs(result.startTime - snappedStartTime) > MOVE_EPSILON_SECONDS
          ? 'edge-clamp'
          : 'none',
    applied: result.noFreeSpace === true ||
      result.forcingOverlap === true ||
      Math.abs(result.startTime - snappedStartTime) > MOVE_EPSILON_SECONDS,
    forcingOverlap: result.forcingOverlap,
    blockedReason: result.blockedReason,
  };
}

export function createFallbackTrackResolution(): ClipMoveFallbackTrackResolution {
  return {
    createFallbackTrack: false,
  };
}

export function createOverlapResolution(
  forcingOverlap: boolean,
  overlappedClipIds: readonly string[] = [],
  trimClipIds: readonly string[] = overlappedClipIds,
  deleteClipIds: readonly string[] = [],
): ClipMoveOverlapTrimResolution {
  return {
    mode: forcingOverlap
      ? deleteClipIds.length > 0 && trimClipIds.length === 0
        ? 'delete-covered'
        : 'trim-overlapped'
      : 'none',
    overlappedClipIds,
    trimClipIds: forcingOverlap ? trimClipIds : [],
    deleteClipIds: forcingOverlap ? deleteClipIds : [],
  };
}

export function doTimeRangesOverlap(
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
): boolean {
  const endA = startA + durationA;
  const endB = startB + durationB;
  return endA > startB && startA < endB;
}

export function isCoveredByRange(
  candidate: TimelineClip,
  startTime: number,
  duration: number,
): boolean {
  const endTime = startTime + duration;
  const candidateEndTime = candidate.startTime + candidate.duration;
  return startTime <= candidate.startTime && endTime >= candidateEndTime;
}

export function findAlternativeTrack(
  input: ResolveClipMoveRequestInput,
  clip: TimelineClip,
  requestedTrackId: string,
  snappedStartTime: number,
  excludeClipIds: readonly string[],
): { track: TimelineTrack; result: MoveResolutionResistanceResult } | null {
  const requestedTrack = input.tracks.find(track => track.id === requestedTrackId);
  if (!requestedTrack || !input.getPositionWithResistance) return null;

  for (const track of input.tracks) {
    if (
      track.id === requestedTrackId ||
      track.id === clip.trackId ||
      track.type !== requestedTrack.type ||
      !isTrackCompatible(clip, track)
    ) {
      continue;
    }

    const result = input.getPositionWithResistance(
      clip.id,
      snappedStartTime,
      track.id,
      clip.duration,
      excludeClipIds,
    );
    if (!result.noFreeSpace) {
      return { track, result };
    }
  }

  return null;
}

export function resolveLeadMove(
  input: ResolveClipMoveRequestInput,
  clip: TimelineClip,
  targetTrackId: string,
  excludeClipIds: readonly string[],
): ResolvedLeadMove {
  const snapping = resolveSnap(input, clip, targetTrackId);
  const explicitNewTrackType = input.requestedNewTrackType ?? null;
  if (explicitNewTrackType) {
    const fallbackTrack = createFallbackTrackResolution();
    fallbackTrack.createFallbackTrack = true;
    fallbackTrack.requestedNewTrackType = explicitNewTrackType;
    fallbackTrack.fallbackTrackType = explicitNewTrackType;
    fallbackTrack.provisionalTrackId = createFallbackTrackProvisionalId(explicitNewTrackType);
    fallbackTrack.reason = 'explicit-new-track-zone';
    return {
      startTime: Math.max(0, snapping.resolvedStartTime),
      trackId: fallbackTrack.provisionalTrackId,
      snapping,
      resistance: {
        mode: 'new-track-zone',
        applied: true,
        forcingOverlap: false,
      },
      fallbackTrack,
      overlap: createOverlapResolution(false),
    };
  }

  const resistanceResult = input.getPositionWithResistance?.(
    clip.id,
    snapping.resolvedStartTime,
    targetTrackId,
    clip.duration,
    excludeClipIds,
  );
  let finalStartTime = Math.max(0, resistanceResult?.startTime ?? snapping.resolvedStartTime);
  let finalTrackId = targetTrackId;
  let resistance = createResistance(resistanceResult, snapping.resolvedStartTime);
  const fallbackTrack = createFallbackTrackResolution();
  const requestedTrack = input.tracks.find(track => track.id === targetTrackId);
  const shouldRerouteOccupiedTrack = targetTrackId !== clip.trackId || requestedTrack?.type === 'audio';

  if (resistanceResult?.noFreeSpace && shouldRerouteOccupiedTrack) {
    const alternative = findAlternativeTrack(input, clip, targetTrackId, snapping.resolvedStartTime, excludeClipIds);
    if (alternative) {
      finalTrackId = alternative.track.id;
      finalStartTime = Math.max(0, alternative.result.startTime);
      resistance = createResistance(alternative.result, snapping.resolvedStartTime);
    } else {
      const fallbackTrackType = requestedTrack?.type === 'audio' ? 'audio' : 'video';
      fallbackTrack.createFallbackTrack = true;
      fallbackTrack.requestedNewTrackType = fallbackTrackType;
      fallbackTrack.fallbackTrackType = fallbackTrackType;
      fallbackTrack.provisionalTrackId = createFallbackTrackProvisionalId(fallbackTrackType);
      fallbackTrack.reason = 'missing-compatible-track';
      finalTrackId = fallbackTrack.provisionalTrackId;
      finalStartTime = Math.max(0, snapping.resolvedStartTime);
      resistance = {
        mode: 'new-track-zone',
        applied: true,
        forcingOverlap: false,
      };
    }
  }

  return {
    startTime: finalStartTime,
    trackId: finalTrackId,
    snapping: {
      ...snapping,
      resolvedStartTime: finalStartTime,
    },
    resistance,
    fallbackTrack,
    overlap: createOverlapResolution(resistance.forcingOverlap === true),
  };
}
