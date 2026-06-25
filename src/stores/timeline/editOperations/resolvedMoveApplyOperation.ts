import { endBatch, startBatch } from '../../historyStore';
import { cleanupDeletedClipResources } from '../deletedClipResources';
import { createTimelineTrackForType, insertTimelineTrack } from '../trackSlice';
import { applyMoveClipsOperation } from './moveOperations';
import { applyResolvedMoveOverlapTrims } from './moveOverlapTrim';
import {
  materializeResolvedClipMoveFallbackTracks,
  resolvedClipMovesToMoveClipsOperation,
} from './moveResolution';
import {
  pruneInvalidClipTransitions,
  shouldClearTransitionPropertiesSelection,
} from './transitionOperations';
import {
  ensureTransitionCompositionsForChangedClips,
  removeDetachedTransitionCompositions,
} from './transitionCompositionMaintenance';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import { hasOnlyNoopWarnings, resultFromWarnings, uniqueIds } from './editOperationResults';
import type { MoveClipsResolvedApplyOperation, TimelineEditResult, TimelineEditWarning } from './types';

export function applyResolvedMoveClipsOperation(
  operation: MoveClipsResolvedApplyOperation,
  context: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const { get, options, set } = context;
  const operationId = operation.id;
  const hasFallbackTracks = operation.resolvedMoves.some(move => move.fallbackTrack.createFallbackTrack);
  const fallbackValidationWarnings = operation.resolvedMoves.flatMap<TimelineEditWarning>((move) => {
    if (!move.fallbackTrack.createFallbackTrack) return [];
    const trackType = move.fallbackTrack.fallbackTrackType ?? move.fallbackTrack.requestedNewTrackType ?? null;
    if (move.fallbackTrack.provisionalTrackId && trackType) return [];
    return [{
      code: 'unsupported',
      message: 'Resolved move fallback track is missing a provisional id or track type.',
      clipId: move.clipId,
      trackId: move.fallbackTrack.provisionalTrackId,
    }];
  });
  if (fallbackValidationWarnings.length > 0) {
    return resultFromWarnings(operationId, fallbackValidationWarnings);
  }

  if (!hasFallbackTracks) {
    const previousClips = get().clips;
    const moveOperation = resolvedClipMovesToMoveClipsOperation(operation.id, operation.resolvedMoves);
    const moveResult = applyMoveClipsOperation(moveOperation, previousClips, get().tracks);
    if (moveResult.changedClipIds.length === 0 || hasOnlyNoopWarnings(moveResult.warnings)) {
      return resultFromWarnings(operationId, moveResult.warnings);
    }

    const trimResult = applyResolvedMoveOverlapTrims(moveResult.clips, operation.resolvedMoves);
    const prunedTransitions = pruneInvalidClipTransitions(trimResult.clips);
    const changedClipIds = uniqueIds([
      ...moveResult.changedClipIds,
      ...trimResult.changedClipIds,
      ...prunedTransitions.changedClipIds,
    ]);
    if (changedClipIds.length === 0) {
      return resultFromWarnings(operationId, [{ code: 'no-op', message: 'No clips were moved.' }]);
    }
    const deletedClips = moveResult.clips.filter(clip => trimResult.deletedClipIds.includes(clip.id));
    const selectedClipIds = new Set(get().selectedClipIds);
    for (const clipId of trimResult.deletedClipIds) selectedClipIds.delete(clipId);
    const currentPrimarySelectedClipId = get().primarySelectedClipId;
    const primarySelectedClipId = currentPrimarySelectedClipId === null
      ? null
      : selectedClipIds.has(currentPrimarySelectedClipId)
      ? currentPrimarySelectedClipId
      : [...selectedClipIds][0] ?? null;

    startBatch(options.historyLabel ?? 'Move clips');
    try {
      cleanupDeletedClipResources(deletedClips);
      set({
        clips: prunedTransitions.clips,
        selectedClipIds,
        primarySelectedClipId,
        ...(shouldClearTransitionPropertiesSelection(get().propertiesSelection, prunedTransitions.clips)
          ? { propertiesSelection: null }
          : {}),
      });
      removeDetachedTransitionCompositions(previousClips, prunedTransitions.clips);
      ensureTransitionCompositionsForChangedClips(context.set, context.get, changedClipIds, previousClips);
      get().updateDuration();
      get().invalidateCache();
    } finally {
      endBatch();
    }

    return {
      success: true,
      operationId,
      changedClipIds,
      warnings: [...moveResult.warnings, ...trimResult.warnings],
    };
  }

  let plannedTracks = [...get().tracks];
  let plannedExpandedTracks = new Set(get().expandedTracks);
  const materialized = materializeResolvedClipMoveFallbackTracks(
    operation.id,
    operation.resolvedMoves,
    (type) => {
      const plannedTrack = createTimelineTrackForType(type, plannedTracks);
      const next = insertTimelineTrack(plannedTracks, plannedExpandedTracks, plannedTrack);
      plannedTracks = next.tracks;
      plannedExpandedTracks = next.expandedTracks;
      return plannedTrack.id;
    },
  );
  if (materialized.warnings.length > 0) {
    return resultFromWarnings(operationId, materialized.warnings);
  }

  const previousClips = get().clips;
  const moveResult = applyMoveClipsOperation(materialized.operation, previousClips, plannedTracks);
  if (moveResult.changedClipIds.length === 0 || hasOnlyNoopWarnings(moveResult.warnings)) {
    return resultFromWarnings(operationId, moveResult.warnings);
  }

  const trimResult = applyResolvedMoveOverlapTrims(moveResult.clips, operation.resolvedMoves);
  const prunedTransitions = pruneInvalidClipTransitions(trimResult.clips);
  const changedClipIds = uniqueIds([
    ...moveResult.changedClipIds,
    ...trimResult.changedClipIds,
    ...prunedTransitions.changedClipIds,
  ]);
  if (changedClipIds.length === 0) {
    return resultFromWarnings(operationId, [{ code: 'no-op', message: 'No clips were moved.' }]);
  }
  const deletedClips = moveResult.clips.filter(clip => trimResult.deletedClipIds.includes(clip.id));
  const selectedClipIds = new Set(get().selectedClipIds);
  for (const clipId of trimResult.deletedClipIds) selectedClipIds.delete(clipId);
  const currentPrimarySelectedClipId = get().primarySelectedClipId;
  const primarySelectedClipId = currentPrimarySelectedClipId === null
    ? null
    : selectedClipIds.has(currentPrimarySelectedClipId)
      ? currentPrimarySelectedClipId
      : [...selectedClipIds][0] ?? null;

  startBatch(options.historyLabel ?? 'Move clips');
  try {
    cleanupDeletedClipResources(deletedClips);
    set({
      tracks: plannedTracks,
      expandedTracks: plannedExpandedTracks,
      clips: prunedTransitions.clips,
      selectedClipIds,
      primarySelectedClipId,
      ...(shouldClearTransitionPropertiesSelection(get().propertiesSelection, prunedTransitions.clips)
        ? { propertiesSelection: null }
        : {}),
    });
    removeDetachedTransitionCompositions(previousClips, prunedTransitions.clips);
    ensureTransitionCompositionsForChangedClips(context.set, context.get, changedClipIds, previousClips);
    get().updateDuration();
    get().invalidateCache();

    return {
      success: true,
      operationId,
      changedClipIds,
      warnings: [...materialized.warnings, ...moveResult.warnings, ...trimResult.warnings],
    };
  } finally {
    endBatch();
  }
}
