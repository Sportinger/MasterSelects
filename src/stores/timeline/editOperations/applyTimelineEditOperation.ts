import { endBatch, startBatch } from '../../historyStore';
import type { SliceCreator, TimelineEditOperationActions } from '../types';
import { cleanupDeletedClipResources } from '../deletedClipResources';
import { applyDeleteClipsOperation } from './deleteOperations';
import { applyMoveClipsOperation } from './moveOperations';
import { applyRangeEditOperation } from './rangeOperations';
import { selectClipsFromTimeOperation } from './selectionOperations';
import { applyPlaceTimelineRangeOperation } from './placementOperations';
import { applySplitAtTimesOperation } from './splitBatchOperations';
import { applyMergeMidiClipsOperation } from './mergeOperations';
import { generateMidiClipId, generateMidiNoteId } from '../helpers/idGenerator';
import { resolveSplitAllAtTimeTargets, resolveSplitAtTimeTargets } from './splitOperations';
import { applyDeleteAllGapsOperation, applyDeleteGapAtTimeOperation, applyRippleDeleteSelectionOperation } from './rippleOperations';
import { applyRateStretchClipOperation, applyRippleTrimEdgeToTimeOperation, applyRollingEditOperation, applySlideClipOperation, applySlipClipOperation, applyTrimClipOperation, applyTrimEdgeToTimeOperation } from './trimOperations';
import type { TimelineEditOperation, TimelineEditResult } from './types';
import {
  applyTransitionApplyOperation,
  pruneInvalidClipTransitions,
  applyTransitionRemoveOperation,
  applyTransitionUpdateDurationOperation,
  applyTransitionUpdateOffsetOperation,
  applyTransitionUpdateTypeOperation,
  applyTransitionUpdateParamsOperation,
  shouldClearTransitionPropertiesSelection,
} from './transitionOperations';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from './transitionPlanner';
import { buildTransitionToolPreviewGhostRanges } from './transitionToolPreview';
import { createTimelineTransitionMediaDurationResolver } from '../../../services/timeline/timelineTransitionMediaDurations';
import { aborted, blockedByExport, hasOnlyNoopWarnings, resultFromWarnings, uniqueIds } from './editOperationResults';
import { applyFadeTransactionOperation, isFadeTransactionOperation } from './fadeTransactionOperations';
import { applyKeyframeTransactionOperation, isKeyframeTransactionOperation } from './keyframeTransactionOperations';
import { applyKeyboardEditCommandOperation, isKeyboardEditCommandOperation } from './keyboardEditCommandOperations';
import { applyResolvedMoveClipsOperation } from './resolvedMoveApplyOperation';
import { ensureTransitionCompositionsForChangedClips, getChangedClipIdsAfterReplacement, removeDetachedTransitionCompositions, setClipsAndCleanupTransitionComps } from './transitionCompositionMaintenance';
export const createTimelineEditOperationSlice: SliceCreator<TimelineEditOperationActions> = (set, get) => ({
  applyTimelineEditOperation: (operation: TimelineEditOperation, options): TimelineEditResult => {
    const operationId = operation.id;

    if (options.signal?.aborted) return aborted(operationId);
    if (get().isExporting && operation.type !== 'select-clips-from-time') {
      return blockedByExport(operationId);
    }
    if (options.previewOnly) {
      return {
        success: true,
        operationId,
        changedClipIds: [],
        warnings: [],
      };
    }

    if (isFadeTransactionOperation(operation)) {
      return applyFadeTransactionOperation(operation, { set, get, options });
    }

    if (isKeyframeTransactionOperation(operation)) {
      return applyKeyframeTransactionOperation(operation, { set, get, options });
    }

    if (operation.type === 'transition-preview-drop') {
      const junction = operation.junction;
      const clipA = junction ? get().clips.find(clip => clip.id === junction.clipAId) : undefined;
      const clipB = junction ? get().clips.find(clip => clip.id === junction.clipBId) : undefined;
      const getMediaDuration = createTimelineTransitionMediaDurationResolver();
      const plan = clipA && clipB
        ? planTransition({
            outgoingClip: clipA,
            incomingClip: clipB,
            transitionType: operation.transitionType,
            requestedDuration: operation.requestedDuration,
            placement: DEFAULT_TRANSITION_PLACEMENT,
            edgePolicy: 'hold',
            junctionTime: junction?.junctionTime,
            getMediaDuration,
          })
        : null;
      const ghostRanges = plan
        ? buildTransitionToolPreviewGhostRanges(plan, operation.id, operation.transitionType)
        : [];
      set({
        timelineToolPreview: junction && plan
          ? {
              toolId: 'select',
              plane: 'section-scrolled',
              trackId: junction.trackId,
              trackIds: [junction.trackId],
              time: junction.junctionTime,
              startTime: plan.bodyStart,
              endTime: plan.bodyEnd,
              label: operation.transitionType,
              ghostRanges,
              zIndex: 16,
            }
          : {
              toolId: 'select',
              plane: 'section-scrolled',
              label: operation.transitionType,
              blocked: true,
              message: junction ? 'Transition cannot be planned for the current drop target.' : 'No transition junction at the current drop target.',
              zIndex: 16,
            },
      });

      return {
        success: true,
        operationId,
        changedClipIds: [],
        warnings: junction && plan ? [] : [{
          code: 'invalid-range',
          message: junction ? 'Transition cannot be planned for the current drop target.' : 'No transition junction at the current drop target.',
        }],
      };
    }

    if (operation.type === 'transition-clear-preview') {
      set({ timelineToolPreview: null });
      return {
        success: true,
        operationId,
        changedClipIds: [],
        warnings: [],
      };
    }

    if (operation.type === 'select-clips-from-time') {
      const { selectedClipIds, warnings } = selectClipsFromTimeOperation(operation, get().clips, get().tracks);
      set({
        selectedClipIds: new Set(selectedClipIds),
        primarySelectedClipId: selectedClipIds[0] ?? null,
      });
      return {
        success: selectedClipIds.length > 0,
        operationId,
        changedClipIds: [],
        selectedClipIds,
        warnings,
      };
    }

    if (operation.type === 'split-at-time' || operation.type === 'split-all-at-time') {
      const resolved = operation.type === 'split-at-time'
        ? resolveSplitAtTimeTargets(operation, get().clips, get().tracks)
        : resolveSplitAllAtTimeTargets(operation, get().clips, get().tracks);
      if (resolved.clipIds.length === 0) return resultFromWarnings(operationId, resolved.warnings);

      const previousClips = get().clips;
      startBatch(options.historyLabel ?? 'Timeline split');
      try {
        for (const clipId of resolved.clipIds) {
          get().splitClip(clipId, operation.time);
        }
        const nextClips = get().clips;
        removeDetachedTransitionCompositions(previousClips, nextClips);
        ensureTransitionCompositionsForChangedClips(set, get, uniqueIds(getChangedClipIdsAfterReplacement(previousClips, nextClips, resolved.clipIds)), previousClips);
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds: resolved.clipIds,
        warnings: resolved.warnings,
      };
    }

    if (operation.type === 'merge-midi-clips') {
      const result = applyMergeMidiClipsOperation(
        operation,
        get().clips,
        get().tracks,
        generateMidiNoteId,
        generateMidiClipId,
      );
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? 'Glue MIDI clips');
      try {
        set({
          clips: result.clips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: result.mergedClipId,
        });
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds: result.changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'split-at-times') {
      const previousClips = get().clips;
      const result = applySplitAtTimesOperation(
        operation,
        previousClips,
        get().tracks,
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);

      startBatch(options.historyLabel ?? 'Timeline split');
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: result.clips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: [...result.selectedClipIds][0] ?? null,
        });
        ensureTransitionCompositionsForChangedClips(set, get, result.changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds: result.changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'ripple-delete-selection') {
      const previousClips = get().clips;
      const result = applyRippleDeleteSelectionOperation(
        operation,
        previousClips,
        get().tracks,
        get().selectedClipIds,
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? 'Ripple delete');
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: nextClips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: null,
        });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        selectedClipIds: [],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'delete-clips') {
      const previousClips = get().clips;
      const result = applyDeleteClipsOperation(
        operation,
        previousClips,
        get().tracks,
        get().selectedClipIds,
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? 'Delete clips');
      try {
        cleanupDeletedClipResources(result.deletedClips);
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: nextClips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: [...result.selectedClipIds][0] ?? null,
        });
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (isKeyboardEditCommandOperation(operation)) {
      return applyKeyboardEditCommandOperation(operation, { set, get, options });
    }

    if (
      operation.type === 'transition-apply' ||
      operation.type === 'transition-remove' ||
      operation.type === 'transition-update-duration' ||
      operation.type === 'transition-update-offset' ||
      operation.type === 'transition-update-type' ||
      operation.type === 'transition-update-params'
    ) {
      const getMediaDuration = createTimelineTransitionMediaDurationResolver();
      const previousClips = get().clips;
      const result =
        operation.type === 'transition-apply'
          ? applyTransitionApplyOperation(operation, get().clips, get().tracks, getMediaDuration)
          : operation.type === 'transition-remove'
            ? applyTransitionRemoveOperation(operation, get().clips, get().tracks)
            : operation.type === 'transition-update-duration'
              ? applyTransitionUpdateDurationOperation(operation, get().clips, get().tracks, getMediaDuration)
              : operation.type === 'transition-update-offset'
                ? applyTransitionUpdateOffsetOperation(operation, get().clips, get().tracks, getMediaDuration)
                : operation.type === 'transition-update-type'
                  ? applyTransitionUpdateTypeOperation(operation, get().clips, get().tracks, getMediaDuration)
                  : applyTransitionUpdateParamsOperation(operation, get().clips, get().tracks);

      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      const historyLabel =
        operation.type === 'transition-apply'
          ? 'Apply transition'
          : operation.type === 'transition-remove'
            ? 'Remove transition'
            : operation.type === 'transition-update-duration'
              ? 'Update transition duration'
              : operation.type === 'transition-update-offset'
                ? 'Move transition'
                : operation.type === 'transition-update-type'
                  ? 'Change transition type'
                  : 'Update transition parameters';

      startBatch(options.historyLabel ?? historyLabel);
      try {
        set({
          clips: result.clips,
          ...(shouldClearTransitionPropertiesSelection(get().propertiesSelection, result.clips)
            ? { propertiesSelection: null }
            : {}),
        });
        removeDetachedTransitionCompositions(previousClips, result.clips);

        if (operation.type !== 'transition-remove') {
          ensureTransitionCompositionsForChangedClips(set, get, result.changedClipIds, previousClips);
        }
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds: result.changedClipIds,
        warnings: result.warnings,
      };
    }

    if (operation.type === 'delete-gap-at-time') {
      const previousClips = get().clips;
      const result = applyDeleteGapAtTimeOperation(operation, previousClips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? 'Delete gap');
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, { clips: nextClips });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings: result.warnings,
      };
    }

    if (operation.type === 'delete-all-gaps') {
      const previousClips = get().clips;
      const result = applyDeleteAllGapsOperation(operation, previousClips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? 'Delete all gaps');
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, { clips: nextClips });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings: result.warnings,
      };
    }

    if (operation.type === 'move-clips') {
      const previousClips = get().clips;
      const result = applyMoveClipsOperation(operation, previousClips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? 'Move clips');
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: nextClips,
          ...(shouldClearTransitionPropertiesSelection(get().propertiesSelection, nextClips)
            ? { propertiesSelection: null }
            : {}),
        });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings: result.warnings,
      };
    }

    if (operation.type === 'move-clips-resolved') {
      return applyResolvedMoveClipsOperation(operation, { set, get, options });
    }

    if (operation.type === 'lift-range' || operation.type === 'extract-range') {
      const previousClips = get().clips;
      const result = applyRangeEditOperation(
        operation,
        previousClips,
        get().tracks,
        get().selectedClipIds,
        get().timelineRangeSelection,
      );
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? (operation.type === 'extract-range' ? 'Extract range' : 'Lift range'));
      try {
        cleanupDeletedClipResources(result.deletedClips);
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: nextClips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: [...result.selectedClipIds][0] ?? null,
          timelineRangeSelection: null,
        });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (
      operation.type === 'trim-clip' ||
      operation.type === 'trim-edge-to-time' ||
      operation.type === 'ripple-trim-edge-to-time' ||
      operation.type === 'rolling-edit' ||
      operation.type === 'slip-clip' ||
      operation.type === 'slide-clip' ||
      operation.type === 'rate-stretch-clip'
    ) {
      const previousClips = get().clips;
      const result =
        operation.type === 'trim-clip'
          ? applyTrimClipOperation(operation, previousClips, get().tracks)
          : operation.type === 'trim-edge-to-time'
            ? applyTrimEdgeToTimeOperation(operation, previousClips, get().tracks, get().selectedClipIds)
            : operation.type === 'ripple-trim-edge-to-time'
              ? applyRippleTrimEdgeToTimeOperation(operation, previousClips, get().tracks, get().selectedClipIds)
              : operation.type === 'rolling-edit'
                ? applyRollingEditOperation(operation, previousClips, get().tracks)
                : operation.type === 'slip-clip'
                  ? applySlipClipOperation(operation, previousClips, get().tracks)
                  : operation.type === 'slide-clip'
                    ? applySlideClipOperation(operation, previousClips, get().tracks)
                    : applyRateStretchClipOperation(operation, previousClips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }
      const prunedTransitions = pruneInvalidClipTransitions(result.clips);
      const nextClips = prunedTransitions.clips;
      const changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);

      startBatch(options.historyLabel ?? (
        operation.type === 'ripple-trim-edge-to-time' ? 'Ripple trim' :
          operation.type === 'rolling-edit' ? 'Rolling edit' :
            operation.type === 'slip-clip' ? 'Slip clip' :
              operation.type === 'slide-clip' ? 'Slide clip' :
                operation.type === 'rate-stretch-clip' ? 'Rate stretch clip' :
                  'Trim clips'
      ));
      try {
        setClipsAndCleanupTransitionComps(set, previousClips, {
          clips: nextClips,
          ...(shouldClearTransitionPropertiesSelection(get().propertiesSelection, nextClips)
            ? { propertiesSelection: null }
            : {}),
        });
        ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
        get().updateDuration();
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings: result.warnings,
      };
    }

    if (operation.type === 'place-timeline-range') {
      const previousClips = get().clips;
      const result = applyPlaceTimelineRangeOperation(operation, previousClips, get().tracks);
      const hasMutation = result.changedClipIds.length > 0 || result.deletedClips.length > 0;

      if (!hasMutation && hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      let changedClipIds = result.changedClipIds;
      if (hasMutation) {
        const prunedTransitions = pruneInvalidClipTransitions(result.clips);
        const nextClips = prunedTransitions.clips;
        changedClipIds = uniqueIds([...result.changedClipIds, ...prunedTransitions.changedClipIds]);
        startBatch(options.historyLabel ?? (
          operation.mode === 'insert' ? 'Insert placement range' :
            operation.mode === 'ripple-overwrite' ? 'Ripple overwrite placement range' :
              operation.mode === 'replace' ? 'Replace placement range' :
                operation.mode === 'fit-to-fill' ? 'Fit to fill placement range' :
                  'Overwrite placement range'
        ));
        try {
          cleanupDeletedClipResources(result.deletedClips);
          setClipsAndCleanupTransitionComps(set, previousClips, { clips: nextClips });
          ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, previousClips);
          get().updateDuration();
          get().invalidateCache();
        } finally {
          endBatch();
        }
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings: result.warnings,
      };
    }

    const unsupportedOperation = operation as { type: string };
    return {
      success: false,
      operationId,
      changedClipIds: [],
      warnings: [{
        code: 'unsupported',
        message: `Unsupported timeline edit operation: ${unsupportedOperation.type}`,
      }],
    };
  },

  splitAllClipsAtTime: (time, trackIds) => get().applyTimelineEditOperation({
    id: `split-all-at-time:${time}`,
    type: 'split-all-at-time',
    time,
    trackIds,
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Split all clips at time' }),

  selectClipsFromTime: (time, options = {}) => get().applyTimelineEditOperation({
    id: `select-clips-from-time:${time}`,
    type: 'select-clips-from-time',
    time,
    direction: options.direction ?? 'forward',
    trackIds: options.trackIds,
    includeLinked: options.includeLinked ?? true,
  }, { source: 'ui', historyLabel: 'Select clips from time' }),

  rippleDeleteSelection: (clipIds) => get().applyTimelineEditOperation({
    id: `ripple-delete-selection:${Date.now()}`,
    type: 'ripple-delete-selection',
    clipIds,
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Ripple delete selection' }),

  deleteClipSelection: (clipIds) => get().applyTimelineEditOperation({
    id: `delete-clips:${Date.now()}`,
    type: 'delete-clips',
    clipIds: clipIds ?? [...get().selectedClipIds],
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Delete clips' }),

  deleteGapAtTime: (time, trackIds) => get().applyTimelineEditOperation({
    id: `delete-gap-at-time:${time}`,
    type: 'delete-gap-at-time',
    time,
    trackIds,
  }, { source: 'ui', historyLabel: 'Delete gap' }),

  deleteAllGaps: (trackIds, startTime) => get().applyTimelineEditOperation({
    id: `delete-all-gaps:${Date.now()}`,
    type: 'delete-all-gaps',
    trackIds,
    startTime,
  }, {
    source: 'ui',
    historyLabel: trackIds?.length === 1 && startTime !== undefined ? 'Delete all gaps in layer from time' : 'Delete all gaps',
  }),

  trimSelectedClipEdgeToPlayhead: (edge) => get().applyTimelineEditOperation({
    id: `trim-${edge}-to-playhead:${get().playheadPosition}`,
    type: 'trim-edge-to-time',
    edge,
    time: get().playheadPosition,
    includeLinked: true,
  }, { source: 'ui', historyLabel: edge === 'start' ? 'Trim start to playhead' : 'Trim end to playhead' }),

  rippleTrimSelectedClipEdgeToPlayhead: (edge) => get().applyTimelineEditOperation({
    id: `ripple-trim-${edge}-to-playhead:${get().playheadPosition}`,
    type: 'ripple-trim-edge-to-time',
    edge,
    time: get().playheadPosition,
    includeLinked: true,
  }, { source: 'ui', historyLabel: edge === 'start' ? 'Ripple trim start to playhead' : 'Ripple trim end to playhead' }),

  prepareTimelinePlacementRange: (mode, options) => get().applyTimelineEditOperation({
    id: `place-timeline-range:${mode}:${Date.now()}`,
    type: 'place-timeline-range',
    mode,
    trackIds: options.trackIds,
    startTime: options.startTime,
    duration: options.duration,
    targetClipId: options.targetClipId,
    includeLinked: options.includeLinked ?? true,
    rippleDelta: options.rippleDelta,
  }, { source: options.source ?? 'ui', historyLabel: options.historyLabel ?? 'Prepare timeline placement' }),

  liftTimelineRange: () => get().applyTimelineEditOperation({
    id: `lift-range:${Date.now()}`,
    type: 'lift-range',
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Lift range' }),

  extractTimelineRange: () => get().applyTimelineEditOperation({
    id: `extract-range:${Date.now()}`,
    type: 'extract-range',
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Extract range' }),
});
