import { endBatch, startBatch } from '../../historyStore';
import { cleanupDeletedClipResources } from '../deletedClipResources';
import { applyDeleteClipsOperation } from './deleteOperations';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import { isClipTrackLocked, resultFromWarnings, uniqueIds } from './editOperationResults';
import type { KeyboardEditCommandOperation } from './transactionTypes';
import type { TimelineEditOperation, TimelineEditResult, TimelineEditWarning } from './types';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';

export function isKeyboardEditCommandOperation(operation: TimelineEditOperation): operation is KeyboardEditCommandOperation {
  return operation.type === 'keyboard-delete-command' || operation.type === 'keyboard-cycle-blend-mode-command';
}

export function applyKeyboardEditCommandOperation(
  operation: KeyboardEditCommandOperation,
  context: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const { get, options, set } = context;
  const operationId = operation.id;

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
        {
          clipKeyframes: get().clipKeyframes,
          timelineTime: getPlayheadPosition(get().playheadPosition),
        },
      );
      if (result.changedClipIds.length === 0) return resultFromWarnings(operationId, result.warnings);

      startBatch(options.historyLabel ?? 'Delete clips');
      try {
        cleanupDeletedClipResources(result.deletedClips);
        set({
          clips: result.clips,
          ...(result.clipKeyframes ? { clipKeyframes: result.clipKeyframes } : {}),
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
