import type { TimelineClip } from '../../../types';
import type {
  MoveClipsOperation,
  TimelineClipMove,
  TimelineEditWarning,
} from './types';
import type {
  ClipMoveGroupResolution,
  ClipMoveLinkedResolution,
  ClipMoveOverlapTrimResolution,
  ClipMoveSelectedLinkedPairResolution,
  MoveClipsParityChecklist,
  ResolvedClipMove,
} from './transactionTypes';
import {
  createFallbackTrackProvisionalId,
  createFallbackTrackResolution,
  createNoSnap,
  createOverlapResolution,
  createResistance,
  doTimeRangesOverlap,
  findLinkedClip,
  isCoveredByRange,
  isTrackLocked,
  resolveLeadMove,
  type ResolvedLeadMove,
  type ResolveClipMoveRequestInput,
} from './moveLeadResolution';
import {
  isNewTrackTypeCompatible,
  isTrackCompatible,
} from './moveTrackCompatibility';
import { resolveSelectedClipTrackTargets } from './selectedClipTrackTargets';

export type {
  MoveResolutionResistanceResult,
  MoveResolutionSnapResult,
  ResolvedMoveFallbackTrackType,
  ResolveClipMoveRequestInput,
} from './moveLeadResolution';

export const RESOLVED_MOVE_PARITY_REQUIRED = {
  snapping: 'required',
  resistance: 'required',
  fallbackTrackCreation: 'required',
  overlapTrimming: 'required',
  linkedClips: 'required',
  linkedGroups: 'required',
  selectedLinkedPairs: 'required',
} as const satisfies MoveClipsParityChecklist;

export interface ResolveClipMoveRequestResult {
  id: string;
  requestedClipIds: string[];
  resolvedMoves: ResolvedClipMove[];
  operation: MoveClipsOperation;
  warnings: TimelineEditWarning[];
  parity: MoveClipsParityChecklist;
}

export type ResolvedClipMoveOperationBlockReason =
  | 'empty'
  | 'warnings'
  | 'fallback-track'
  | 'overlap-trim'
  | 'selected-linked-pair';

export interface ResolvedClipMoveOperationPlan {
  operation: MoveClipsOperation;
  canApplyWithMoveClipsOperation: boolean;
  blockedReasons: ResolvedClipMoveOperationBlockReason[];
}

export interface MaterializedResolvedClipMoveFallbackTrack {
  provisionalTrackId: string;
  trackId: string;
  type: 'video' | 'audio';
}

export interface MaterializedResolvedClipMoveOperation {
  operation: MoveClipsOperation;
  materializedFallbackTracks: MaterializedResolvedClipMoveFallbackTrack[];
  warnings: TimelineEditWarning[];
}

interface MoveDraft {
  clip: TimelineClip;
  requestedStartTime: number;
  requestedTrackId?: string;
  isLeadClip: boolean;
  linked: ClipMoveLinkedResolution;
  linkedGroup: ClipMoveGroupResolution;
  selectedLinkedPair: ClipMoveSelectedLinkedPairResolution;
}

function createLinkedResolution(
  includeLinked: boolean,
  linkedClipIds: readonly string[],
  skippedLinkedClipIds: readonly string[],
  reason?: ClipMoveLinkedResolution['reason'],
): ClipMoveLinkedResolution {
  return {
    includeLinked,
    linkedClipIds,
    skippedLinkedClipIds,
    reason,
  };
}

function createGroupResolution(
  includeGroups: boolean,
  linkedGroupIds: readonly string[],
  groupClipIds: readonly string[],
  skippedGroupClipIds: readonly string[] = [],
): ClipMoveGroupResolution {
  return {
    includeGroups,
    linkedGroupIds,
    groupClipIds,
    skippedGroupClipIds,
  };
}

function createSelectedPairResolution(
  selectedPairClipIds: readonly string[] = [],
  dedupedClipIds: readonly string[] = [],
): ClipMoveSelectedLinkedPairResolution {
  return {
    selectedPairClipIds,
    dedupedClipIds,
    preservedOffsets: selectedPairClipIds.length > 0,
  };
}

function addDraft(
  drafts: Map<string, MoveDraft>,
  draft: MoveDraft,
): void {
  if (drafts.has(draft.clip.id)) return;
  drafts.set(draft.clip.id, draft);
}

function collectMoveDrafts(
  input: ResolveClipMoveRequestInput,
  leadClip: TimelineClip,
  requestedLeadStartTime: number,
  requestedLeadTrackId: string,
  targetTrackIdByClipId: ReadonlyMap<string, string>,
): MoveDraft[] {
  const includeLinked = input.includeLinked !== false;
  const includeGroups = input.includeGroups !== false;
  const selectedClipIds = new Set(input.selectedClipIds ?? []);
  const drafts = new Map<string, MoveDraft>();
  const requestedTimelineDelta = requestedLeadStartTime - leadClip.startTime;

  const baseSelectedIds = selectedClipIds.has(leadClip.id)
    ? [...selectedClipIds].filter(id => input.clips.some(clip => clip.id === id))
    : [leadClip.id];

  const leadLinkedClip = findLinkedClip(leadClip, input.clips);
  const selectedPairClipIds = leadLinkedClip && selectedClipIds.has(leadClip.id) && selectedClipIds.has(leadLinkedClip.id)
    ? [leadClip.id, leadLinkedClip.id]
    : [];

  for (const clipId of baseSelectedIds) {
    const clip = input.clips.find(candidate => candidate.id === clipId);
    if (!clip) continue;
    addDraft(drafts, {
      clip,
      requestedStartTime: clip.id === leadClip.id ? requestedLeadStartTime : clip.startTime + requestedTimelineDelta,
      requestedTrackId: clip.id === leadClip.id
        ? requestedLeadTrackId
        : targetTrackIdByClipId.get(clip.id) ?? clip.trackId,
      isLeadClip: clip.id === leadClip.id,
      linked: createLinkedResolution(includeLinked, [], []),
      linkedGroup: createGroupResolution(includeGroups, [], []),
      selectedLinkedPair: selectedPairClipIds.includes(clip.id)
        ? createSelectedPairResolution(selectedPairClipIds, [clip.id])
        : createSelectedPairResolution(),
    });
  }

  if (includeLinked) {
    for (const draft of [...drafts.values()]) {
      const linkedClip = findLinkedClip(draft.clip, input.clips);
      if (!linkedClip) continue;
      if (drafts.has(linkedClip.id)) {
        draft.linked = createLinkedResolution(true, [], [linkedClip.id], 'already-selected');
        continue;
      }
      draft.linked = createLinkedResolution(true, [linkedClip.id], []);
      addDraft(drafts, {
        clip: linkedClip,
        requestedStartTime: linkedClip.startTime + requestedTimelineDelta,
        requestedTrackId: linkedClip.trackId,
        isLeadClip: false,
        linked: createLinkedResolution(true, [draft.clip.id], []),
        linkedGroup: createGroupResolution(includeGroups, [], []),
        selectedLinkedPair: createSelectedPairResolution(),
      });
    }
  } else if (leadLinkedClip) {
    const leadDraft = drafts.get(leadClip.id);
    if (leadDraft) {
      leadDraft.linked = createLinkedResolution(false, [], [leadLinkedClip.id], 'alt-unlink');
    }
  }

  if (includeGroups && leadClip.linkedGroupId) {
    const groupClips = input.clips.filter(clip => clip.linkedGroupId === leadClip.linkedGroupId && clip.id !== leadClip.id);
    const groupClipIds = groupClips.map(clip => clip.id);
    const groupIds = [leadClip.linkedGroupId];
    const leadDraft = drafts.get(leadClip.id);
    if (leadDraft) {
      leadDraft.linkedGroup = createGroupResolution(true, groupIds, [leadClip.id, ...groupClipIds]);
    }
    for (const groupClip of groupClips) {
      if (drafts.has(groupClip.id)) {
        const existing = drafts.get(groupClip.id);
        if (existing) {
          existing.linkedGroup = createGroupResolution(true, groupIds, [leadClip.id, ...groupClipIds]);
        }
        continue;
      }
      addDraft(drafts, {
        clip: groupClip,
        requestedStartTime: groupClip.startTime + requestedTimelineDelta,
        requestedTrackId: groupClip.trackId,
        isLeadClip: false,
        linked: createLinkedResolution(includeLinked, [], []),
        linkedGroup: createGroupResolution(true, groupIds, [leadClip.id, ...groupClipIds]),
        selectedLinkedPair: createSelectedPairResolution(),
      });
    }
  } else if (!includeGroups && leadClip.linkedGroupId) {
    const groupClipIds = input.clips
      .filter(clip => clip.linkedGroupId === leadClip.linkedGroupId && clip.id !== leadClip.id)
      .map(clip => clip.id);
    const leadDraft = drafts.get(leadClip.id);
    if (leadDraft) {
      leadDraft.linkedGroup = createGroupResolution(false, [leadClip.linkedGroupId], [], groupClipIds);
    }
  }

  return [...drafts.values()];
}

function validateMoveDrafts(
  input: ResolveClipMoveRequestInput,
  drafts: readonly MoveDraft[],
  warnings: TimelineEditWarning[],
): boolean {
  for (const draft of drafts) {
    const targetTrackId = draft.requestedTrackId ?? draft.clip.trackId;
    const targetTrack = input.tracks.find(track => track.id === targetTrackId);
    if (draft.isLeadClip && input.requestedNewTrackType) {
      if (isTrackLocked(input.tracks, draft.clip.trackId)) {
        warnings.push({
          code: 'track-locked',
          message: 'Cannot move clips from or into locked tracks.',
          clipId: draft.clip.id,
          trackId: targetTrackId,
        });
        return false;
      }
      if (!isNewTrackTypeCompatible(draft.clip, input.requestedNewTrackType)) {
        warnings.push({
          code: 'unsupported',
          message: 'Target track type is incompatible with the clip source.',
          clipId: draft.clip.id,
          trackId: targetTrackId,
        });
        return false;
      }
      continue;
    }
    if (!targetTrack || isTrackLocked(input.tracks, draft.clip.trackId) || isTrackLocked(input.tracks, targetTrackId)) {
      warnings.push({
        code: 'track-locked',
        message: 'Cannot move clips from or into locked tracks.',
        clipId: draft.clip.id,
        trackId: targetTrackId,
      });
      return false;
    }
    if (!isTrackCompatible(draft.clip, targetTrack)) {
      warnings.push({
        code: 'unsupported',
        message: 'Target track type is incompatible with the clip source.',
        clipId: draft.clip.id,
        trackId: targetTrackId,
      });
      return false;
    }
  }
  return true;
}

function createResolvedMove(
  input: ResolveClipMoveRequestInput,
  draft: MoveDraft,
  lead: ResolvedLeadMove,
  timelineDelta: number,
  excludeClipIds: readonly string[],
): ResolvedClipMove {
  const rawResolvedStartTime = draft.isLeadClip
    ? lead.startTime
    : Math.max(0, draft.clip.startTime + timelineDelta);
  const resolvedTrackId = draft.isLeadClip
    ? lead.trackId
    : draft.requestedTrackId ?? draft.clip.trackId;
  const followerResistanceResult = draft.isLeadClip
    ? undefined
    : input.getPositionWithResistance?.(
      draft.clip.id,
      rawResolvedStartTime,
      resolvedTrackId,
      draft.clip.duration,
      excludeClipIds,
    );
  const resolvedStartTime = Math.max(0, followerResistanceResult?.startTime ?? rawResolvedStartTime);
  const resistance = draft.isLeadClip
    ? lead.resistance
    : createResistance(followerResistanceResult, rawResolvedStartTime);

  return {
    clipId: draft.clip.id,
    originalStartTime: draft.clip.startTime,
    originalTrackId: draft.clip.trackId,
    requestedStartTime: draft.requestedStartTime,
    requestedTrackId: draft.requestedTrackId,
    resolvedStartTime,
    resolvedTrackId,
    timelineDelta: resolvedStartTime - draft.clip.startTime,
    isLeadClip: draft.isLeadClip,
    snapping: draft.isLeadClip ? lead.snapping : createNoSnap(draft.requestedStartTime),
    resistance,
    fallbackTrack: draft.isLeadClip ? lead.fallbackTrack : createFallbackTrackResolution(),
    overlap: draft.isLeadClip ? lead.overlap : createOverlapResolution(resistance.forcingOverlap === true),
    linked: draft.linked,
    linkedGroup: draft.linkedGroup,
    selectedLinkedPair: draft.selectedLinkedPair,
  };
}

function resolveOverlapForMove(
  input: ResolveClipMoveRequestInput,
  move: ResolvedClipMove,
  movingClipIds: ReadonlySet<string>,
  excludeClipIds: readonly string[],
): ClipMoveOverlapTrimResolution {
  if (move.resistance.forcingOverlap !== true) {
    return createOverlapResolution(false);
  }

  const clip = input.clips.find(candidate => candidate.id === move.clipId);
  if (!clip) return createOverlapResolution(true);

  const excludeSet = new Set([...excludeClipIds, ...movingClipIds]);
  if (clip.linkedClipId) excludeSet.add(clip.linkedClipId);
  const overlappedClipIds: string[] = [];
  const trimClipIds = new Set<string>();
  const deleteClipIds = new Set<string>();

  for (const candidate of input.clips) {
    if (
      candidate.trackId !== move.resolvedTrackId ||
      excludeSet.has(candidate.id) ||
      candidate.id === clip.id ||
      candidate.linkedClipId === clip.id
    ) {
      continue;
    }
    if (!doTimeRangesOverlap(move.resolvedStartTime, clip.duration, candidate.startTime, candidate.duration)) {
      continue;
    }

    overlappedClipIds.push(candidate.id);
    const candidateIsCovered = isCoveredByRange(candidate, move.resolvedStartTime, clip.duration);
    if (candidateIsCovered) {
      deleteClipIds.add(candidate.id);
    } else {
      trimClipIds.add(candidate.id);
    }

    if (candidate.linkedClipId && !excludeSet.has(candidate.linkedClipId)) {
      if (candidateIsCovered) {
        deleteClipIds.add(candidate.linkedClipId);
      } else {
        trimClipIds.add(candidate.linkedClipId);
      }
    }
  }

  return createOverlapResolution(
    true,
    overlappedClipIds,
    [...trimClipIds],
    [...deleteClipIds],
  );
}

function annotateResolvedMoveOverlaps(
  input: ResolveClipMoveRequestInput,
  resolvedMoves: readonly ResolvedClipMove[],
  excludeClipIds: readonly string[],
): ResolvedClipMove[] {
  const movingClipIds = new Set(resolvedMoves.map(move => move.clipId));
  return resolvedMoves.map(move => ({
    ...move,
    overlap: resolveOverlapForMove(input, move, movingClipIds, excludeClipIds),
  }));
}

export function resolvedClipMovesToMoveClipsOperation(
  id: string,
  resolvedMoves: readonly ResolvedClipMove[],
): MoveClipsOperation {
  return {
    id,
    type: 'move-clips',
    includeLinked: false,
    moves: resolvedMoves.map<TimelineClipMove>(move => ({
      clipId: move.clipId,
      startTime: move.resolvedStartTime,
      trackId: move.resolvedTrackId,
    })),
  };
}

export function createResolvedClipMoveOperationPlan(
  id: string,
  resolvedMoves: readonly ResolvedClipMove[],
  warnings: readonly TimelineEditWarning[] = [],
): ResolvedClipMoveOperationPlan {
  const blockedReasons = new Set<ResolvedClipMoveOperationBlockReason>();
  if (resolvedMoves.length === 0) blockedReasons.add('empty');
  if (warnings.length > 0) blockedReasons.add('warnings');
  if (resolvedMoves.some(move => move.fallbackTrack.createFallbackTrack)) {
    blockedReasons.add('fallback-track');
  }
  if (resolvedMoves.some(move => move.overlap.mode !== 'none')) {
    blockedReasons.add('overlap-trim');
  }
  if (resolvedMoves.some(move => move.selectedLinkedPair.preservedOffsets)) {
    blockedReasons.add('selected-linked-pair');
  }

  return {
    operation: resolvedClipMovesToMoveClipsOperation(id, resolvedMoves),
    canApplyWithMoveClipsOperation: blockedReasons.size === 0,
    blockedReasons: [...blockedReasons],
  };
}

export function materializeResolvedClipMoveFallbackTracks(
  id: string,
  resolvedMoves: readonly ResolvedClipMove[],
  allocateTrackId: (type: 'video' | 'audio') => string,
): MaterializedResolvedClipMoveOperation {
  const warnings: TimelineEditWarning[] = [];
  const materializedByProvisionalId = new Map<string, MaterializedResolvedClipMoveFallbackTrack>();

  for (const move of resolvedMoves) {
    const { fallbackTrack } = move;
    if (!fallbackTrack.createFallbackTrack) continue;

    const provisionalTrackId = fallbackTrack.provisionalTrackId;
    const type = fallbackTrack.fallbackTrackType ?? fallbackTrack.requestedNewTrackType ?? null;
    if (!provisionalTrackId || !type) {
      warnings.push({
        code: 'unsupported',
        message: 'Resolved move fallback track is missing a provisional id or track type.',
        clipId: move.clipId,
        trackId: provisionalTrackId,
      });
      continue;
    }

    if (!materializedByProvisionalId.has(provisionalTrackId)) {
      materializedByProvisionalId.set(provisionalTrackId, {
        provisionalTrackId,
        trackId: allocateTrackId(type),
        type,
      });
    }
  }

  const operation = resolvedClipMovesToMoveClipsOperation(id, resolvedMoves);
  const materializedFallbackTracks = [...materializedByProvisionalId.values()];
  if (materializedFallbackTracks.length === 0) {
    return { operation, materializedFallbackTracks, warnings };
  }

  return {
    operation: {
      ...operation,
      moves: operation.moves.map(move => {
        const trackId = move.trackId
          ? materializedByProvisionalId.get(move.trackId)?.trackId ?? move.trackId
          : move.trackId;
        return { ...move, trackId };
      }),
    },
    materializedFallbackTracks,
    warnings,
  };
}

export function resolveClipMoveRequest(
  input: ResolveClipMoveRequestInput,
): ResolveClipMoveRequestResult {
  const warnings: TimelineEditWarning[] = [];
  const leadClip = input.clips.find(clip => clip.id === input.clipId);
  if (!leadClip) {
    warnings.push({ code: 'clip-not-found', message: 'Clip not found for move resolution.', clipId: input.clipId });
    return {
      id: input.id,
      requestedClipIds: [input.clipId],
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }

  const requestedNewTrackType = input.requestedNewTrackType ?? null;
  const targetTrackId = requestedNewTrackType
    ? createFallbackTrackProvisionalId(requestedNewTrackType)
    : input.requestedTrackId ?? leadClip.trackId;
  const targetTrack = input.tracks.find(track => track.id === targetTrackId);
  if (isTrackLocked(input.tracks, leadClip.trackId) || (!requestedNewTrackType && isTrackLocked(input.tracks, targetTrackId))) {
    warnings.push({ code: 'track-locked', message: 'Cannot move clips from or into locked tracks.', clipId: leadClip.id, trackId: targetTrackId });
    return {
      id: input.id,
      requestedClipIds: [leadClip.id],
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }
  if (requestedNewTrackType && !isNewTrackTypeCompatible(leadClip, requestedNewTrackType)) {
    warnings.push({ code: 'unsupported', message: 'Target track type is incompatible with the clip source.', clipId: leadClip.id, trackId: targetTrackId });
    return {
      id: input.id,
      requestedClipIds: [leadClip.id],
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }
  if (!requestedNewTrackType && !isTrackCompatible(leadClip, targetTrack)) {
    warnings.push({ code: 'unsupported', message: 'Target track type is incompatible with the clip source.', clipId: leadClip.id, trackId: targetTrackId });
    return {
      id: input.id,
      requestedClipIds: [leadClip.id],
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }

  const excludeClipIds = [...new Set(input.excludeClipIds ?? [])];
  const lead = resolveLeadMove(input, leadClip, targetTrackId, excludeClipIds);
  const trackTargets = resolveSelectedClipTrackTargets(
    input.tracks,
    input.clips,
    leadClip.id,
    lead.trackId,
    input.selectedClipIds,
  );
  if (trackTargets.invalidClipIds.length > 0) {
    warnings.push({
      code: 'unsupported',
      message: 'The selected clips cannot preserve their relative track positions at this destination.',
      clipId: trackTargets.invalidClipIds[0],
      trackId: targetTrackId,
    });
    return {
      id: input.id,
      requestedClipIds: [...trackTargets.targetTrackIdByClipId.keys()],
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }
  const timelineDelta = lead.startTime - leadClip.startTime;
  const drafts = collectMoveDrafts(
    input,
    leadClip,
    input.requestedStartTime,
    targetTrackId,
    trackTargets.targetTrackIdByClipId,
  );
  if (!validateMoveDrafts(input, drafts, warnings)) {
    return {
      id: input.id,
      requestedClipIds: drafts.map(draft => draft.clip.id),
      resolvedMoves: [],
      operation: resolvedClipMovesToMoveClipsOperation(input.id, []),
      warnings,
      parity: RESOLVED_MOVE_PARITY_REQUIRED,
    };
  }
  const resolvedMoves = annotateResolvedMoveOverlaps(
    input,
    drafts.map(draft => createResolvedMove(input, draft, lead, timelineDelta, excludeClipIds)),
    excludeClipIds,
  );

  return {
    id: input.id,
    requestedClipIds: drafts.map(draft => draft.clip.id),
    resolvedMoves,
    operation: resolvedClipMovesToMoveClipsOperation(input.id, resolvedMoves),
    warnings,
    parity: RESOLVED_MOVE_PARITY_REQUIRED,
  };
}
