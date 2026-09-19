import { endBatch, startBatch } from '../../historyStore';
import { clearMasterAudio, getPlayheadPosition, startInternalPosition } from '../../../services/layerBuilder/PlayheadState';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import type { DeleteAllGapsOperation, DeleteGapAtTimeOperation, TimelineEditResult } from './types';
import { hasOnlyNoopWarnings, resultFromWarnings, uniqueIds } from './editOperationResults';
import { applyDeleteAllGapsOperation, applyDeleteGapAtTimeOperation, type GapDeletionApplyResult } from './rippleOperations';
import { pruneInvalidClipTransitions } from './transitionOperations';
import { ensureTransitionCompositionsForChangedClips, setClipsAndCleanupTransitionComps } from './transitionCompositionMaintenance';

type GapDeletionOperation = DeleteGapAtTimeOperation | DeleteAllGapsOperation;

function remapGapDeletionPlayhead(
  position: number,
  ranges: GapDeletionApplyResult['removedTimeRanges'],
  preferredTrackId: string | undefined,
): number {
  // One global playhead follows one reference track; linked tracks must never
  // subtract the same gap twice. Map iteration follows the timeline track order.
  const referenceTrackId = preferredTrackId && ranges.has(preferredTrackId)
    ? preferredTrackId
    : ranges.keys().next().value;
  const removed = referenceTrackId ? ranges.get(referenceTrackId) ?? [] : [];
  return Math.max(0, position - removed.reduce((total, range) => (
    total + Math.max(0, Math.min(position, range.end) - range.start)
  ), 0));
}

export function applyGapDeletionOperation(
  operation: GapDeletionOperation,
  { set, get, options }: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const before = get();
  const previousClips = before.clips;
  const playheadPosition = getPlayheadPosition(before.playheadPosition);
  const result = operation.type === 'delete-gap-at-time'
    ? applyDeleteGapAtTimeOperation(operation, previousClips, before.tracks)
    : applyDeleteAllGapsOperation(operation, previousClips, before.tracks);
  if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
    return resultFromWarnings(operation.id, result.warnings);
  }

  const preferredTrackId = operation.trackIds?.length === 1
    ? operation.trackIds[0]
    : previousClips.find(clip => clip.id === before.primarySelectedClipId)?.trackId;
  const nextPosition = remapGapDeletionPlayhead(playheadPosition, result.removedTimeRanges, preferredTrackId);
  const prunedTransitions = pruneInvalidClipTransitions(result.clips);
  const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);
  const label = operation.type === 'delete-gap-at-time' ? 'Delete gap' : 'Delete all gaps';
  const historyBatch = startBatch(options.historyLabel ?? label);
  try {
    setClipsAndCleanupTransitionComps(set, previousClips, { clips: prunedTransitions.clips });
    ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
    get().updateDuration();
    if (nextPosition !== playheadPosition) {
      get().setPlayheadPosition(nextPosition);
      if (get().isPlaying) {
        // The old audio master still carries the clip's pre-edit timeline start.
        // Rebase the live clock until the updated audio route takes over.
        clearMasterAudio();
        startInternalPosition(get().playheadPosition, get().playbackSpeed);
      }
    }
    get().invalidateCache();
  } finally {
    if (historyBatch.opened) endBatch();
  }
  return { success: true, operationId: operation.id, changedClipIds, warnings: result.warnings };
}
