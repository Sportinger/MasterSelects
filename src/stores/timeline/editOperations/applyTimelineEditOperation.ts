import { endBatch, startBatch } from '../../historyStore';
import type { TimelineClip } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { vectorAnimationRuntimeManager } from '../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { blobUrlManager } from '../helpers/blobUrlManager';
import type { SliceCreator, TimelineEditOperationActions } from '../types';
import { applyDeleteClipsOperation } from './deleteOperations';
import { applyMoveClipsOperation } from './moveOperations';
import { applyRangeEditOperation } from './rangeOperations';
import { selectClipsFromTimeOperation } from './selectionOperations';
import { applyPlaceTimelineRangeOperation } from './placementOperations';
import { applySplitAtTimesOperation } from './splitBatchOperations';
import { resolveSplitAllAtTimeTargets, resolveSplitAtTimeTargets } from './splitOperations';
import { applyDeleteGapAtTimeOperation, applyRippleDeleteSelectionOperation } from './rippleOperations';
import {
  applyRateStretchClipOperation,
  applyRippleTrimEdgeToTimeOperation,
  applyRollingEditOperation,
  applySlideClipOperation,
  applySlipClipOperation,
  applyTrimClipOperation,
  applyTrimEdgeToTimeOperation,
} from './trimOperations';
import type { TimelineEditOperation, TimelineEditResult, TimelineEditWarning } from './types';

function blockedByExport(operationId: string): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings: [{
      code: 'export-locked',
      message: 'Timeline edits are locked during export.',
    }],
  };
}

function aborted(operationId: string): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings: [{
      code: 'no-op',
      message: 'Timeline edit operation was aborted before it ran.',
    }],
  };
}

function hasOnlyNoopWarnings(warnings: TimelineEditWarning[]): boolean {
  return warnings.length > 0 && warnings.every((warning) => warning.code === 'no-op');
}

function resultFromWarnings(operationId: string, warnings: TimelineEditWarning[]): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings,
  };
}

function cleanupDeletedClipResources(deletedClips: TimelineClip[]): void {
  for (const clip of deletedClips) {
    if (clip.source?.type === 'video' && clip.source.videoElement) {
      const video = clip.source.videoElement;
      video.pause();
      video.src = '';
      video.load();
      import('../../../engine/WebGPUEngine').then(({ engine }) => engine.cleanupVideo(video));
    }
    if (clip.source?.type === 'audio' && clip.source.audioElement) {
      const audio = clip.source.audioElement;
      audio.pause();
      audio.src = '';
      audio.load();
    }
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
    }
    blobUrlManager.revokeAll(clip.id);
  }
}

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

      startBatch(options.historyLabel ?? 'Timeline split');
      try {
        for (const clipId of resolved.clipIds) {
          get().splitClip(clipId, operation.time);
        }
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

    if (operation.type === 'split-at-times') {
      const result = applySplitAtTimesOperation(
        operation,
        get().clips,
        get().tracks,
        (clipId, mixdownBuffer) => {
          import('../../../services/compositionAudioMixer').then(({ compositionAudioMixer }) => {
            const newAudio = compositionAudioMixer.createAudioElement(mixdownBuffer);
            const { clips } = get();
            set({
              clips: clips.map((clip) => {
                if (clip.id !== clipId || !clip.source) return clip;
                return { ...clip, source: { ...clip.source, audioElement: newAudio } };
              }),
            });
          });
        },
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);

      startBatch(options.historyLabel ?? 'Timeline split');
      try {
        set({
          clips: result.clips,
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
        changedClipIds: result.changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'ripple-delete-selection') {
      const result = applyRippleDeleteSelectionOperation(
        operation,
        get().clips,
        get().tracks,
        get().selectedClipIds,
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);

      startBatch(options.historyLabel ?? 'Ripple delete');
      try {
        set({
          clips: result.clips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: null,
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
        selectedClipIds: [],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'delete-clips') {
      const result = applyDeleteClipsOperation(
        operation,
        get().clips,
        get().tracks,
        get().selectedClipIds,
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);

      startBatch(options.historyLabel ?? 'Delete clips');
      try {
        cleanupDeletedClipResources(result.deletedClips);
        set({
          clips: result.clips,
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
        changedClipIds: result.changedClipIds,
        selectedClipIds: [...result.selectedClipIds],
        warnings: result.warnings,
      };
    }

    if (operation.type === 'delete-gap-at-time') {
      const result = applyDeleteGapAtTimeOperation(operation, get().clips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? 'Delete gap');
      try {
        set({ clips: result.clips });
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

    if (operation.type === 'move-clips') {
      const result = applyMoveClipsOperation(operation, get().clips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? 'Move clips');
      try {
        set({ clips: result.clips });
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

    if (operation.type === 'lift-range' || operation.type === 'extract-range') {
      const result = applyRangeEditOperation(
        operation,
        get().clips,
        get().tracks,
        get().selectedClipIds,
        get().timelineRangeSelection,
      );
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? (operation.type === 'extract-range' ? 'Extract range' : 'Lift range'));
      try {
        cleanupDeletedClipResources(result.deletedClips);
        set({
          clips: result.clips,
          selectedClipIds: result.selectedClipIds,
          primarySelectedClipId: [...result.selectedClipIds][0] ?? null,
          timelineRangeSelection: null,
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

    if (
      operation.type === 'trim-clip' ||
      operation.type === 'trim-edge-to-time' ||
      operation.type === 'ripple-trim-edge-to-time' ||
      operation.type === 'rolling-edit' ||
      operation.type === 'slip-clip' ||
      operation.type === 'slide-clip' ||
      operation.type === 'rate-stretch-clip'
    ) {
      const result =
        operation.type === 'trim-clip'
          ? applyTrimClipOperation(operation, get().clips, get().tracks)
          : operation.type === 'trim-edge-to-time'
            ? applyTrimEdgeToTimeOperation(operation, get().clips, get().tracks, get().selectedClipIds)
            : operation.type === 'ripple-trim-edge-to-time'
              ? applyRippleTrimEdgeToTimeOperation(operation, get().clips, get().tracks, get().selectedClipIds)
              : operation.type === 'rolling-edit'
                ? applyRollingEditOperation(operation, get().clips, get().tracks)
                : operation.type === 'slip-clip'
                  ? applySlipClipOperation(operation, get().clips, get().tracks)
                  : operation.type === 'slide-clip'
                    ? applySlideClipOperation(operation, get().clips, get().tracks)
                    : applyRateStretchClipOperation(operation, get().clips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? (
        operation.type === 'ripple-trim-edge-to-time' ? 'Ripple trim' :
          operation.type === 'rolling-edit' ? 'Rolling edit' :
            operation.type === 'slip-clip' ? 'Slip clip' :
              operation.type === 'slide-clip' ? 'Slide clip' :
                operation.type === 'rate-stretch-clip' ? 'Rate stretch clip' :
                  'Trim clips'
      ));
      try {
        set({ clips: result.clips });
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

    if (operation.type === 'place-timeline-range') {
      const result = applyPlaceTimelineRangeOperation(operation, get().clips, get().tracks);
      const hasMutation = result.changedClipIds.length > 0 || result.deletedClips.length > 0;

      if (!hasMutation && hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      if (hasMutation) {
        startBatch(options.historyLabel ?? (
          operation.mode === 'insert' ? 'Insert placement range' :
            operation.mode === 'ripple-overwrite' ? 'Ripple overwrite placement range' :
              operation.mode === 'replace' ? 'Replace placement range' :
                operation.mode === 'fit-to-fill' ? 'Fit to fill placement range' :
                  'Overwrite placement range'
        ));
        try {
          cleanupDeletedClipResources(result.deletedClips);
          set({ clips: result.clips });
          get().updateDuration();
          get().invalidateCache();
        } finally {
          endBatch();
        }
      }

      return {
        success: true,
        operationId,
        changedClipIds: result.changedClipIds,
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

  deleteGapAtTime: (time, trackIds) => get().applyTimelineEditOperation({
    id: `delete-gap-at-time:${time}`,
    type: 'delete-gap-at-time',
    time,
    trackIds,
  }, { source: 'ui', historyLabel: 'Delete gap' }),

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
