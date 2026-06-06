import { endBatch, startBatch } from '../../historyStore';
import type { Keyframe, TimelineClip, TimelineTrack } from '../../../types';
import type { SliceCreator, TimelineEditOperationActions } from '../types';
import { cleanupDeletedClipResources } from '../deletedClipResources';
import { createTimelineTrackForType, insertTimelineTrack } from '../trackSlice';
import { applyDeleteClipsOperation } from './deleteOperations';
import { applyMoveClipsOperation } from './moveOperations';
import { applyResolvedMoveOverlapTrims } from './moveOverlapTrim';
import { applyRangeEditOperation } from './rangeOperations';
import { selectClipsFromTimeOperation } from './selectionOperations';
import { applyPlaceTimelineRangeOperation } from './placementOperations';
import { applySplitAtTimesOperation } from './splitBatchOperations';
import { applyMergeMidiClipsOperation } from './mergeOperations';
import { generateMidiClipId, generateMidiNoteId } from '../helpers/idGenerator';
import { resolveSplitAllAtTimeTargets, resolveSplitAtTimeTargets } from './splitOperations';
import { applyDeleteAllGapsOperation, applyDeleteGapAtTimeOperation, applyRippleDeleteSelectionOperation } from './rippleOperations';
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
import {
  applyTransitionApplyOperation,
  applyTransitionRemoveOperation,
  applyTransitionUpdateDurationOperation,
} from './transitionOperations';
import {
  materializeResolvedClipMoveFallbackTracks,
  resolvedClipMovesToMoveClipsOperation,
} from './moveResolution';
import { getKeyframeAtTime } from '../../../utils/keyframeInterpolation';

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

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function isClipTrackLocked(clips: readonly TimelineClip[], tracks: readonly TimelineTrack[], clipId: string): boolean {
  const clip = clips.find(candidate => candidate.id === clipId);
  if (!clip) return false;
  return tracks.find(track => track.id === clip.trackId)?.locked === true;
}

function findKeyframeOwner(
  clipKeyframes: Map<string, Keyframe[]>,
  keyframeId: string,
): { clipId: string; keyframe: Keyframe } | null {
  for (const [clipId, keyframes] of clipKeyframes) {
    const keyframe = keyframes.find(candidate => candidate.id === keyframeId);
    if (keyframe) return { clipId, keyframe };
  }
  return null;
}

function keyframeSnapshot(clipKeyframes: Map<string, Keyframe[]>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const [clipId, keyframes] of clipKeyframes) {
    snapshot.set(clipId, JSON.stringify(keyframes.map(keyframe => ({
      id: keyframe.id,
      property: keyframe.property,
      time: keyframe.time,
      value: keyframe.value,
      pathValue: keyframe.pathValue,
      easing: keyframe.easing,
      handleIn: keyframe.handleIn,
      handleOut: keyframe.handleOut,
      rotationInterpolation: keyframe.rotationInterpolation,
    }))));
  }
  return snapshot;
}

function changedKeyframeClipIds(before: Map<string, string>, after: Map<string, Keyframe[]>): string[] {
  const clipIds = new Set([...before.keys(), ...after.keys()]);
  return [...clipIds].filter((clipId) => before.get(clipId) !== keyframeSnapshot(new Map([[clipId, after.get(clipId) ?? []]])).get(clipId));
}

function clonePathKeyframeValue(pathValue: NonNullable<Keyframe['pathValue']>): NonNullable<Keyframe['pathValue']> {
  return structuredClone(pathValue);
}

function createPathValueKeyframeId(): string {
  return `kf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function applyKeyframeSelection(
  currentSelection: Set<string>,
  selectedKeyframeIds: readonly string[],
  mode: 'replace' | 'add' | 'remove' | 'toggle' | 'clear',
): Set<string> {
  if (mode === 'clear') return new Set();

  const nextSelection = mode === 'replace' ? new Set<string>() : new Set(currentSelection);
  for (const keyframeId of selectedKeyframeIds) {
    if (mode === 'remove') {
      nextSelection.delete(keyframeId);
    } else if (mode === 'toggle') {
      if (nextSelection.has(keyframeId)) {
        nextSelection.delete(keyframeId);
      } else {
        nextSelection.add(keyframeId);
      }
    } else {
      nextSelection.add(keyframeId);
    }
  }
  return nextSelection;
}

const FADE_DURATION_EPSILON = 0.01;
const FADE_TIME_TOLERANCE = 0.01;

function nearlyEquals(left: number, right: number, tolerance = FADE_TIME_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance;
}

function clampFadeDuration(duration: number, clipDuration: number): number {
  return Math.max(0, Math.min(duration, clipDuration * 0.5));
}

function sanitizeKeyframeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function createStableFadeKeyframeId(
  operationId: string,
  clipId: string,
  edge: 'left' | 'right',
  point: 'zero' | 'one',
  existingIds: Set<string>,
): string {
  const base = `kf_fade_${sanitizeKeyframeIdPart(clipId)}_${edge}_${point}_${sanitizeKeyframeIdPart(operationId)}`;
  if (!existingIds.has(base)) return base;

  let index = 1;
  while (existingIds.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function findFadePair(
  keyframes: readonly Keyframe[],
  property: string,
  edge: 'left' | 'right',
  clipDuration: number,
): { zeroKeyframe?: Keyframe; oneKeyframe?: Keyframe } {
  const propertyKeyframes = keyframes
    .filter(keyframe => keyframe.property === property)
    .toSorted((left, right) => left.time - right.time);

  if (edge === 'left') {
    const zeroKeyframe = propertyKeyframes.find(keyframe =>
      nearlyEquals(keyframe.time, 0) && nearlyEquals(keyframe.value, 0)
    );
    const oneKeyframe = propertyKeyframes.find(keyframe =>
      keyframe.value >= 0.99 &&
      keyframe.time > FADE_TIME_TOLERANCE &&
      keyframe.time <= Math.max(clipDuration * 0.5, FADE_TIME_TOLERANCE)
    );
    return { zeroKeyframe, oneKeyframe };
  }

  const zeroKeyframe = propertyKeyframes.find(keyframe =>
    nearlyEquals(keyframe.time, clipDuration) && nearlyEquals(keyframe.value, 0)
  );
  const oneKeyframe = propertyKeyframes.findLast(keyframe =>
    keyframe.value >= 0.99 &&
    keyframe.time >= Math.min(clipDuration * 0.5, clipDuration - FADE_TIME_TOLERANCE) &&
    keyframe.time < clipDuration - FADE_TIME_TOLERANCE
  );
  return { zeroKeyframe, oneKeyframe };
}

function resolveFadeKeyframePair(
  keyframes: readonly Keyframe[],
  property: string,
  edge: 'left' | 'right',
  clipDuration: number,
  zeroKeyframeId?: string,
  oneKeyframeId?: string,
): { zeroKeyframe?: Keyframe; oneKeyframe?: Keyframe } {
  const keyframesById = new Map(keyframes.map(keyframe => [keyframe.id, keyframe]));
  const inferred = findFadePair(keyframes, property, edge, clipDuration);
  return {
    zeroKeyframe: zeroKeyframeId ? keyframesById.get(zeroKeyframeId) ?? inferred.zeroKeyframe : inferred.zeroKeyframe,
    oneKeyframe: oneKeyframeId ? keyframesById.get(oneKeyframeId) ?? inferred.oneKeyframe : inferred.oneKeyframe,
  };
}

function upsertFadeKeyframe(
  existingKeyframe: Keyframe | undefined,
  fallbackId: string,
  clipId: string,
  property: Keyframe['property'],
  time: number,
  value: number,
  easing: Keyframe['easing'],
): Keyframe {
  if (existingKeyframe) {
    return {
      ...existingKeyframe,
      clipId,
      property,
      time,
      value,
    };
  }

  return {
    id: fallbackId,
    clipId,
    property,
    time,
    value,
    easing,
  };
}

function applyFadeKeyframePlan(
  operationId: string,
  clip: TimelineClip,
  keyframePlan: {
    property: Keyframe['property'];
    edge: 'left' | 'right';
    duration: number;
    zeroKeyframeId?: string;
    oneKeyframeId?: string;
    createdKeyframeIds?: readonly string[];
    removedKeyframeIds?: readonly string[];
  },
  requestedDuration: number,
  clipKeyframes: Map<string, Keyframe[]>,
): { clipKeyframes: Map<string, Keyframe[]>; changed: boolean; removedKeyframeIds: string[] } {
  const existingKeyframes = clipKeyframes.get(clip.id) ?? [];
  const existingIds = new Set(existingKeyframes.map(keyframe => keyframe.id));
  const resolvedDuration = clampFadeDuration(requestedDuration, clip.duration);
  const pair = resolveFadeKeyframePair(
    existingKeyframes,
    keyframePlan.property,
    keyframePlan.edge,
    clip.duration,
    keyframePlan.zeroKeyframeId,
    keyframePlan.oneKeyframeId,
  );
  const removableIds = uniqueIds([
    pair.zeroKeyframe?.id,
    pair.oneKeyframe?.id,
    ...(keyframePlan.removedKeyframeIds ?? []),
  ].filter((keyframeId): keyframeId is string => Boolean(keyframeId)));

  let nextKeyframes = existingKeyframes.filter(keyframe => !removableIds.includes(keyframe.id));

  if (resolvedDuration > FADE_DURATION_EPSILON) {
    const zeroTime = keyframePlan.edge === 'left' ? 0 : clip.duration;
    const oneTime = keyframePlan.edge === 'left' ? resolvedDuration : clip.duration - resolvedDuration;
    const plannedZeroId = keyframePlan.zeroKeyframeId ?? keyframePlan.createdKeyframeIds?.[0];
    const plannedOneId = keyframePlan.oneKeyframeId ?? keyframePlan.createdKeyframeIds?.[1];
    const zeroId = plannedZeroId && !existingIds.has(plannedZeroId)
      ? plannedZeroId
      : pair.zeroKeyframe?.id ?? createStableFadeKeyframeId(operationId, clip.id, keyframePlan.edge, 'zero', existingIds);
    existingIds.add(zeroId);
    const oneId = plannedOneId && !existingIds.has(plannedOneId)
      ? plannedOneId
      : pair.oneKeyframe?.id ?? createStableFadeKeyframeId(operationId, clip.id, keyframePlan.edge, 'one', existingIds);

    nextKeyframes = [
      ...nextKeyframes,
      upsertFadeKeyframe(
        pair.zeroKeyframe,
        zeroId,
        clip.id,
        keyframePlan.property,
        zeroTime,
        0,
        keyframePlan.edge === 'left' ? 'ease-out' : 'linear',
      ),
      upsertFadeKeyframe(
        pair.oneKeyframe,
        oneId,
        clip.id,
        keyframePlan.property,
        oneTime,
        1,
        keyframePlan.edge === 'left' ? 'linear' : 'ease-in',
      ),
    ];
  }

  nextKeyframes = nextKeyframes.toSorted((left, right) => left.time - right.time);
  const changed = JSON.stringify(existingKeyframes) !== JSON.stringify(nextKeyframes);
  if (!changed) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }
  const nextKeyframeIds = new Set(nextKeyframes.map(keyframe => keyframe.id));
  const removedKeyframeIds = existingKeyframes
    .filter(keyframe => !nextKeyframeIds.has(keyframe.id))
    .map(keyframe => keyframe.id);

  const nextMap = new Map(clipKeyframes);
  if (nextKeyframes.length > 0) {
    nextMap.set(clip.id, nextKeyframes);
  } else {
    nextMap.delete(clip.id);
  }

  return { clipKeyframes: nextMap, changed: true, removedKeyframeIds };
}

function applyFadeCancel(
  clipId: string,
  discardKeyframeIds: readonly string[],
  clipKeyframes: Map<string, Keyframe[]>,
): { clipKeyframes: Map<string, Keyframe[]>; changed: boolean; removedKeyframeIds: string[] } {
  if (discardKeyframeIds.length === 0) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }

  const discardIds = new Set(discardKeyframeIds);
  const existingKeyframes = clipKeyframes.get(clipId) ?? [];
  const nextKeyframes = existingKeyframes.filter(keyframe => !discardIds.has(keyframe.id));
  const removedKeyframeIds = existingKeyframes
    .filter(keyframe => discardIds.has(keyframe.id))
    .map(keyframe => keyframe.id);
  if (removedKeyframeIds.length === 0) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }

  const nextMap = new Map(clipKeyframes);
  if (nextKeyframes.length > 0) {
    nextMap.set(clipId, nextKeyframes);
  } else {
    nextMap.delete(clipId);
  }
  return { clipKeyframes: nextMap, changed: true, removedKeyframeIds };
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

    if (
      operation.type === 'fade-transaction-begin' ||
      operation.type === 'fade-transaction-update' ||
      operation.type === 'fade-transaction-commit' ||
      operation.type === 'fade-transaction-cancel'
    ) {
      const clip = get().clips.find(candidate => candidate.id === operation.clipId);
      if (!clip) {
        return resultFromWarnings(operationId, [{
          code: 'clip-not-found',
          message: `Fade transaction clip not found: ${operation.clipId}`,
          clipId: operation.clipId,
        }]);
      }
      if (isClipTrackLocked(get().clips, get().tracks, operation.clipId)) {
        return resultFromWarnings(operationId, [{
          code: 'track-locked',
          message: `Fade transaction clip is on a locked track: ${operation.clipId}`,
          clipId: operation.clipId,
          trackId: clip.trackId,
        }]);
      }

      if (operation.type === 'fade-transaction-begin') {
        return {
          success: true,
          operationId,
          changedClipIds: [],
          warnings: [],
        };
      }

      const appliedFade = operation.type === 'fade-transaction-cancel'
        ? applyFadeCancel(operation.clipId, operation.discardKeyframeIds, get().clipKeyframes)
        : applyFadeKeyframePlan(
            operation.id,
            clip,
            operation.keyframePlan,
            operation.type === 'fade-transaction-update'
              ? operation.resolvedFadeDuration
              : operation.finalFadeDuration,
            get().clipKeyframes,
          );

      if (!appliedFade.changed && operation.type !== 'fade-transaction-commit') {
        return resultFromWarnings(operationId, [{
          code: 'no-op',
          message: 'No fade keyframes changed.',
          clipId: operation.clipId,
        }]);
      }

      const removedKeyframeIds = new Set(appliedFade.removedKeyframeIds);
      const selectedKeyframeIds = new Set(
        [...get().selectedKeyframeIds].filter(keyframeId => !removedKeyframeIds.has(keyframeId)),
      );

      const applyFadeState = () => {
        if (!appliedFade.changed) return;
        set({
          clipKeyframes: appliedFade.clipKeyframes,
          selectedKeyframeIds,
        });
        get().invalidateCache();
      };

      if (operation.type === 'fade-transaction-update') {
        startBatch(options.historyLabel ?? 'Edit clip fade');
        try {
          applyFadeState();
        } finally {
          if (!options.deferHistoryCommit) endBatch();
        }
      } else if (operation.type === 'fade-transaction-commit') {
        startBatch(options.historyLabel ?? 'Edit clip fade');
        try {
          applyFadeState();
        } finally {
          endBatch();
        }
      } else {
        try {
          applyFadeState();
        } finally {
          endBatch();
        }
      }

      return {
        success: true,
        operationId,
        changedClipIds: appliedFade.changed ? [operation.clipId] : [],
        warnings: [],
      };
    }

    if (
      operation.type === 'keyframe-transaction-begin' ||
      operation.type === 'keyframe-transaction-update' ||
      operation.type === 'keyframe-transaction-commit' ||
      operation.type === 'keyframe-transaction-cancel'
    ) {
      const clip = get().clips.find(candidate => candidate.id === operation.clipId);
      if (!clip) {
        return resultFromWarnings(operationId, [{
          code: 'clip-not-found',
          message: `Keyframe transaction clip not found: ${operation.clipId}`,
          clipId: operation.clipId,
        }]);
      }
      if (isClipTrackLocked(get().clips, get().tracks, operation.clipId)) {
        return resultFromWarnings(operationId, [{
          code: 'track-locked',
          message: `Keyframe transaction clip is on a locked track: ${operation.clipId}`,
          clipId: operation.clipId,
          trackId: clip.trackId,
        }]);
      }

      if (operation.type === 'keyframe-transaction-begin') {
        return {
          success: true,
          operationId,
          changedClipIds: [],
          warnings: [],
        };
      }

      const beforeKeyframes = keyframeSnapshot(get().clipKeyframes);
      const beforeSelection = new Set(get().selectedKeyframeIds);
      const warnings: TimelineEditWarning[] = [];
      const deferHistoryCommit = operation.type === 'keyframe-transaction-update' && options.deferHistoryCommit === true;

      startBatch(options.historyLabel ?? 'Edit keyframes');
      try {
        const operations = operation.type === 'keyframe-transaction-cancel'
          ? operation.discardKeyframeIds.map(keyframeId => ({
              type: 'keyframe-remove' as const,
              keyframeId,
              clipId: operation.clipId,
              property: operation.property ?? 'opacity',
            }))
          : operation.operations;

        for (const keyframeOperation of operations) {
          if (keyframeOperation.type === 'keyframe-create') {
            const targetClip = get().clips.find(candidate => candidate.id === keyframeOperation.clipId);
            if (!targetClip) {
              warnings.push({
                code: 'clip-not-found',
                message: `Keyframe create clip not found: ${keyframeOperation.clipId}`,
                clipId: keyframeOperation.clipId,
              });
              continue;
            }
            if (isClipTrackLocked(get().clips, get().tracks, keyframeOperation.clipId)) {
              warnings.push({
                code: 'track-locked',
                message: `Keyframe create clip is on a locked track: ${keyframeOperation.clipId}`,
                clipId: keyframeOperation.clipId,
                trackId: targetClip.trackId,
              });
              continue;
            }
            if (typeof keyframeOperation.value.value === 'number') {
              get().addKeyframe(
                keyframeOperation.clipId,
                keyframeOperation.property,
                keyframeOperation.value.value,
                keyframeOperation.time,
                keyframeOperation.easing,
              );
              continue;
            }
            if (keyframeOperation.value.pathValue) {
              const clampedTime = Math.max(0, Math.min(keyframeOperation.time, targetClip.duration));
              const existingKeyframes = get().clipKeyframes.get(keyframeOperation.clipId) ?? [];
              const existingAtTime = getKeyframeAtTime(
                existingKeyframes,
                keyframeOperation.property,
                clampedTime,
              );
              const pathValue = clonePathKeyframeValue(keyframeOperation.value.pathValue);
              const nextKeyframes = existingAtTime
                ? existingKeyframes.map((keyframe) => (
                    keyframe.id === existingAtTime.id
                      ? {
                          ...keyframe,
                          value: 0,
                          pathValue,
                          easing: keyframeOperation.easing,
                        }
                      : keyframe
                  ))
                : [
                    ...existingKeyframes,
                    {
                      id: createPathValueKeyframeId(),
                      clipId: keyframeOperation.clipId,
                      time: clampedTime,
                      property: keyframeOperation.property,
                      value: 0,
                      pathValue,
                      easing: keyframeOperation.easing,
                    },
                  ].sort((left, right) => left.time - right.time);
              const nextMap = new Map(get().clipKeyframes);
              nextMap.set(keyframeOperation.clipId, nextKeyframes);
              set({ clipKeyframes: nextMap });
              get().invalidateCache();
              continue;
            }
            warnings.push({
              code: 'unsupported',
              message: 'Keyframe create operation did not include a supported value payload.',
              clipId: keyframeOperation.clipId,
            });
            continue;
          }

          if (keyframeOperation.type === 'keyframe-select') {
            set({
              selectedKeyframeIds: applyKeyframeSelection(
                get().selectedKeyframeIds,
                keyframeOperation.selectedKeyframeIds,
                keyframeOperation.mode,
              ),
            });
            continue;
          }

          const owner = findKeyframeOwner(get().clipKeyframes, keyframeOperation.keyframeId);
          if (!owner) {
            warnings.push({
              code: 'keyframe-not-found',
              message: `Keyframe not found: ${keyframeOperation.keyframeId}`,
            });
            continue;
          }
          if (isClipTrackLocked(get().clips, get().tracks, owner.clipId)) {
            const ownerClip = get().clips.find(candidate => candidate.id === owner.clipId);
            warnings.push({
              code: 'track-locked',
              message: `Keyframe ${keyframeOperation.keyframeId} clip is on a locked track: ${owner.clipId}`,
              clipId: owner.clipId,
              trackId: ownerClip?.trackId,
            });
            continue;
          }

          if (keyframeOperation.type === 'keyframe-move') {
            get().moveKeyframe(keyframeOperation.keyframeId, keyframeOperation.resolvedTime);
          } else if (keyframeOperation.type === 'keyframe-update-value') {
            if (typeof keyframeOperation.value.value === 'number') {
              get().updateKeyframe(keyframeOperation.keyframeId, { value: keyframeOperation.value.value });
            } else if (keyframeOperation.value.pathValue) {
              get().updateKeyframe(keyframeOperation.keyframeId, { pathValue: keyframeOperation.value.pathValue });
            } else {
              warnings.push({
                code: 'unsupported',
                message: `Keyframe ${keyframeOperation.keyframeId} update-value operation did not include a supported value payload.`,
                clipId: owner.clipId,
              });
            }
          } else if (keyframeOperation.type === 'keyframe-remove') {
            get().removeKeyframe(keyframeOperation.keyframeId);
          } else if (keyframeOperation.type === 'keyframe-update-easing') {
            get().updateKeyframe(keyframeOperation.keyframeId, { easing: keyframeOperation.easing });
          } else if (keyframeOperation.type === 'keyframe-update-bezier-handle') {
            get().updateBezierHandle(keyframeOperation.keyframeId, keyframeOperation.handle, keyframeOperation.position);
          } else if (keyframeOperation.type === 'keyframe-update-rotation-interpolation') {
            get().updateKeyframe(keyframeOperation.keyframeId, {
              rotationInterpolation: keyframeOperation.rotationInterpolation,
            });
          }
        }
      } finally {
        if (!deferHistoryCommit) endBatch();
      }

      const changedClipIds = changedKeyframeClipIds(beforeKeyframes, get().clipKeyframes);
      const selectionChanged = JSON.stringify([...beforeSelection].sort()) !== JSON.stringify([...get().selectedKeyframeIds].sort());
      if (changedClipIds.length === 0 && !selectionChanged) {
        return resultFromWarnings(operationId, warnings.length > 0 ? warnings : [{
          code: 'no-op',
          message: 'No keyframes changed.',
        }]);
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings,
      };
    }

    if (operation.type === 'transition-preview-drop') {
      const junction = operation.junction;
      const halfDuration = Math.max(0, operation.requestedDuration * 0.5);
      set({
        timelineToolPreview: junction
          ? {
              toolId: 'select',
              plane: 'section-scrolled',
              trackId: junction.trackId,
              trackIds: [junction.trackId],
              time: junction.junctionTime,
              startTime: Math.max(0, junction.junctionTime - halfDuration),
              endTime: junction.junctionTime + halfDuration,
              label: operation.transitionType,
              ghostRanges: [{
                id: `${operation.id}:transition-preview`,
                trackId: junction.trackId,
                startTime: Math.max(0, junction.junctionTime - halfDuration),
                endTime: junction.junctionTime + halfDuration,
                label: operation.transitionType,
                variant: 'transition-drop',
              }],
              zIndex: 16,
            }
          : {
              toolId: 'select',
              plane: 'section-scrolled',
              label: operation.transitionType,
              blocked: true,
              message: 'No transition junction at the current drop target.',
              zIndex: 16,
            },
      });

      return {
        success: true,
        operationId,
        changedClipIds: [],
        warnings: junction ? [] : [{
          code: 'invalid-range',
          message: 'No transition junction at the current drop target.',
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
      const result = applySplitAtTimesOperation(
        operation,
        get().clips,
        get().tracks,
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

    if (operation.type === 'keyboard-delete-command') {
      const shouldDeleteKeyframes = operation.priority !== 'clips-only' && operation.keyframeIds.length > 0;
      if (!shouldDeleteKeyframes) {
        if (operation.priority === 'keyframes-only' || operation.clipIds.length === 0) {
          return resultFromWarnings(operationId, [{
            code: 'no-op',
            message: 'No keyboard delete targets were provided.',
          }]);
        }

        const result = applyDeleteClipsOperation(
          {
            id: operation.id,
            type: 'delete-clips',
            clipIds: [...operation.clipIds],
            includeLinked: operation.includeLinked,
          },
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

      const requestedKeyframeIds = uniqueIds(operation.keyframeIds);
      const keyframeClipIds = new Map<string, string>();
      get().clipKeyframes.forEach((keyframes, clipId) => {
        keyframes.forEach((keyframe) => {
          if (requestedKeyframeIds.includes(keyframe.id)) {
            keyframeClipIds.set(keyframe.id, clipId);
          }
        });
      });

      const warnings: TimelineEditWarning[] = [];
      const deletableKeyframeIds: string[] = [];
      for (const keyframeId of requestedKeyframeIds) {
        const clipId = keyframeClipIds.get(keyframeId);
        if (!clipId) {
          warnings.push({
            code: 'keyframe-not-found',
            message: `Keyframe not found: ${keyframeId}`,
          });
          continue;
        }
        if (isClipTrackLocked(get().clips, get().tracks, clipId)) {
          warnings.push({
            code: 'track-locked',
            message: 'Cannot delete keyframes on locked tracks.',
            clipId,
          });
          continue;
        }
        deletableKeyframeIds.push(keyframeId);
      }

      if (deletableKeyframeIds.length === 0) {
        return resultFromWarnings(operationId, warnings.length > 0 ? warnings : [{
          code: 'no-op',
          message: 'No matching keyframes to delete.',
        }]);
      }

      startBatch(options.historyLabel ?? 'Delete keyframes');
      try {
        for (const keyframeId of deletableKeyframeIds) {
          get().removeKeyframe(keyframeId);
        }
      } finally {
        endBatch();
      }

      const remainingKeyframeIds = new Set<string>();
      get().clipKeyframes.forEach((keyframes) => {
        keyframes.forEach((keyframe) => remainingKeyframeIds.add(keyframe.id));
      });
      const deletedKeyframeIds = deletableKeyframeIds.filter(keyframeId => !remainingKeyframeIds.has(keyframeId));
      const changedClipIds = uniqueIds(
        deletedKeyframeIds
          .map(keyframeId => keyframeClipIds.get(keyframeId))
          .filter((clipId): clipId is string => Boolean(clipId)),
      );

      if (changedClipIds.length === 0) {
        return resultFromWarnings(operationId, warnings.length > 0 ? warnings : [{
          code: 'no-op',
          message: 'No matching keyframes to delete.',
        }]);
      }

      return {
        success: true,
        operationId,
        changedClipIds,
        warnings,
      };
    }

    if (operation.type === 'keyboard-cycle-blend-mode-command') {
      const requestedClipIds = uniqueIds(operation.clipIds);
      if (requestedClipIds.length === 0) {
        return resultFromWarnings(operationId, [{
          code: 'no-op',
          message: 'No clips were requested for blend mode update.',
        }]);
      }

      const warnings: TimelineEditWarning[] = [];
      const targetClipIds: string[] = [];
      for (const clipId of requestedClipIds) {
        const clip = get().clips.find(candidate => candidate.id === clipId);
        if (!clip) {
          warnings.push({
            code: 'clip-not-found',
            clipId,
            message: `Clip not found: ${clipId}`,
          });
          continue;
        }
        if (isClipTrackLocked(get().clips, get().tracks, clipId)) {
          warnings.push({
            code: 'track-locked',
            clipId,
            trackId: clip.trackId,
            message: 'Cannot update blend mode on locked tracks.',
          });
          continue;
        }
        if ((clip.transform?.blendMode ?? 'normal') !== operation.nextBlendMode) {
          targetClipIds.push(clipId);
        }
      }

      if (targetClipIds.length === 0) {
        return resultFromWarnings(operationId, warnings.length > 0 ? warnings : [{
          code: 'no-op',
          message: 'Selected clips already use the requested blend mode.',
        }]);
      }

      const targetClipIdSet = new Set(targetClipIds);
      startBatch(options.historyLabel ?? 'Set clip blend mode');
      try {
        set({
          clips: get().clips.map(clip => targetClipIdSet.has(clip.id)
            ? {
                ...clip,
                transform: {
                  ...clip.transform,
                  blendMode: operation.nextBlendMode,
                },
              }
            : clip),
        });
        get().invalidateCache();
      } finally {
        endBatch();
      }

      return {
        success: true,
        operationId,
        changedClipIds: targetClipIds,
        warnings,
      };
    }

    if (
      operation.type === 'transition-apply' ||
      operation.type === 'transition-remove' ||
      operation.type === 'transition-update-duration'
    ) {
      const result =
        operation.type === 'transition-apply'
          ? applyTransitionApplyOperation(operation, get().clips, get().tracks)
          : operation.type === 'transition-remove'
            ? applyTransitionRemoveOperation(operation, get().clips, get().tracks)
            : applyTransitionUpdateDurationOperation(operation, get().clips, get().tracks);

      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      const historyLabel =
        operation.type === 'transition-apply'
          ? 'Apply transition'
          : operation.type === 'transition-remove'
            ? 'Remove transition'
            : 'Update transition duration';

      startBatch(options.historyLabel ?? historyLabel);
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

    if (operation.type === 'delete-all-gaps') {
      const result = applyDeleteAllGapsOperation(operation, get().clips, get().tracks);
      if (result.changedClipIds.length === 0 || hasOnlyNoopWarnings(result.warnings)) {
        return resultFromWarnings(operationId, result.warnings);
      }

      startBatch(options.historyLabel ?? 'Delete all gaps');
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

    if (operation.type === 'move-clips-resolved') {
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
        const moveOperation = resolvedClipMovesToMoveClipsOperation(operation.id, operation.resolvedMoves);
        const moveResult = applyMoveClipsOperation(moveOperation, get().clips, get().tracks);
        if (moveResult.changedClipIds.length === 0 || hasOnlyNoopWarnings(moveResult.warnings)) {
          return resultFromWarnings(operationId, moveResult.warnings);
        }

        const trimResult = applyResolvedMoveOverlapTrims(moveResult.clips, operation.resolvedMoves);
        const changedClipIds = uniqueIds([
          ...moveResult.changedClipIds,
          ...trimResult.changedClipIds,
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
            clips: trimResult.clips,
            selectedClipIds,
            primarySelectedClipId,
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

      const moveResult = applyMoveClipsOperation(materialized.operation, get().clips, plannedTracks);
      if (moveResult.changedClipIds.length === 0 || hasOnlyNoopWarnings(moveResult.warnings)) {
        return resultFromWarnings(operationId, moveResult.warnings);
      }

      const trimResult = applyResolvedMoveOverlapTrims(moveResult.clips, operation.resolvedMoves);
      const changedClipIds = uniqueIds([
        ...moveResult.changedClipIds,
        ...trimResult.changedClipIds,
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
          clips: trimResult.clips,
          selectedClipIds,
          primarySelectedClipId,
        });
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
