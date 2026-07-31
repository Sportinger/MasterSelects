import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { getKeyframeAtTime } from '../../../utils/keyframeInterpolation';
import { isClipTrackLocked } from './editOperationResults';
import { findKeyframeOwner } from './keyframeTransactionHelpers';
import type {
  KeyframeEditOperation,
  KeyframeTransactionOperation,
} from './transactionTypes';
import type { TimelineEditWarning } from './types';

export interface KeyframeTransactionPreflightState {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  clipKeyframes: Map<string, Keyframe[]>;
}

export interface KeyframeTransactionTargetSnapshot {
  keyframesById: Map<string, Keyframe>;
  createdKeyframeIds: Set<string>;
}

function cloneKeyframe(keyframe: Keyframe): Keyframe {
  return structuredClone(keyframe);
}

function warningKey(warning: TimelineEditWarning): string {
  return `${warning.code}:${warning.clipId ?? ''}:${warning.trackId ?? ''}:${warning.message}`;
}

function uniqueWarnings(warnings: TimelineEditWarning[]): TimelineEditWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = warningKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateClipTarget(
  clipId: string,
  state: KeyframeTransactionPreflightState,
  warnings: TimelineEditWarning[],
): void {
  const clip = state.clips.find(candidate => candidate.id === clipId);
  if (!clip) {
    warnings.push({
      code: 'clip-not-found',
      message: `Keyframe transaction clip not found: ${clipId}`,
      clipId,
    });
    return;
  }
  if (isClipTrackLocked(state.clips, state.tracks, clipId)) {
    warnings.push({
      code: 'track-locked',
      message: `Keyframe transaction clip is on a locked track: ${clipId}`,
      clipId,
      trackId: clip.trackId,
    });
  }
}

function validateFiniteValue(
  value: number | undefined,
  message: string,
  clipId: string | undefined,
  warnings: TimelineEditWarning[],
): void {
  if (value === undefined || Number.isFinite(value)) return;
  warnings.push({
    code: 'invalid-time',
    message,
    clipId,
  });
}

function validateExistingKeyframeTarget(
  operation: Exclude<KeyframeEditOperation, { type: 'keyframe-create' | 'keyframe-select' }>,
  state: KeyframeTransactionPreflightState,
  knownTransactionKeyframeIds: ReadonlySet<string>,
  warnings: TimelineEditWarning[],
): void {
  const owner = findKeyframeOwner(state.clipKeyframes, operation.keyframeId);
  if (!owner) {
    // A remove can be repeated by the commit phase after the update phase has
    // already removed the keyframe. The transaction snapshot proves that this
    // was a real target rather than an arbitrary missing id.
    if (operation.type === 'keyframe-remove' && knownTransactionKeyframeIds.has(operation.keyframeId)) {
      return;
    }
    warnings.push({
      code: 'keyframe-not-found',
      message: `Keyframe not found: ${operation.keyframeId}`,
      clipId: operation.clipId,
    });
    return;
  }

  if (owner.clipId !== operation.clipId || owner.keyframe.property !== operation.property) {
    warnings.push({
      code: 'unsupported',
      message: `Keyframe target metadata does not match ${operation.keyframeId}.`,
      clipId: operation.clipId,
    });
    return;
  }

  validateClipTarget(owner.clipId, state, warnings);

  if (operation.type === 'keyframe-move') {
    validateFiniteValue(
      operation.requestedTime,
      `Keyframe ${operation.keyframeId} requested time must be finite.`,
      owner.clipId,
      warnings,
    );
    validateFiniteValue(
      operation.resolvedTime,
      `Keyframe ${operation.keyframeId} resolved time must be finite.`,
      owner.clipId,
      warnings,
    );
  } else if (operation.type === 'keyframe-update-value') {
    validateFiniteValue(
      operation.value.value,
      `Keyframe ${operation.keyframeId} value must be finite.`,
      owner.clipId,
      warnings,
    );
    if (operation.value.value === undefined && !operation.value.pathValue) {
      warnings.push({
        code: 'unsupported',
        message: `Keyframe ${operation.keyframeId} update-value operation did not include a supported value payload.`,
        clipId: owner.clipId,
      });
    }
  } else if (operation.type === 'keyframe-update-bezier-handle') {
    validateFiniteValue(
      operation.position.x,
      `Keyframe ${operation.keyframeId} handle time must be finite.`,
      owner.clipId,
      warnings,
    );
    validateFiniteValue(
      operation.position.y,
      `Keyframe ${operation.keyframeId} handle value must be finite.`,
      owner.clipId,
      warnings,
    );
  }
}

function validateEditOperation(
  operation: KeyframeEditOperation,
  state: KeyframeTransactionPreflightState,
  knownTransactionKeyframeIds: ReadonlySet<string>,
  warnings: TimelineEditWarning[],
): void {
  if (operation.type === 'keyframe-create') {
    validateClipTarget(operation.clipId, state, warnings);
    validateFiniteValue(
      operation.time,
      `Keyframe create time must be finite for ${operation.clipId}.`,
      operation.clipId,
      warnings,
    );
    validateFiniteValue(
      operation.value.value,
      `Keyframe create value must be finite for ${operation.clipId}.`,
      operation.clipId,
      warnings,
    );
    if (operation.value.value === undefined && !operation.value.pathValue) {
      warnings.push({
        code: 'unsupported',
        message: 'Keyframe create operation did not include a supported value payload.',
        clipId: operation.clipId,
      });
    }
    return;
  }

  if (operation.type === 'keyframe-select') {
    for (const keyframeId of operation.selectedKeyframeIds) {
      const owner = findKeyframeOwner(state.clipKeyframes, keyframeId);
      if (!owner && !knownTransactionKeyframeIds.has(keyframeId)) {
        warnings.push({
          code: 'keyframe-not-found',
          message: `Keyframe not found: ${keyframeId}`,
        });
      }
    }
    return;
  }

  validateExistingKeyframeTarget(
    operation,
    state,
    knownTransactionKeyframeIds,
    warnings,
  );
}

export function getKeyframeTransactionEditOperations(
  operation: KeyframeTransactionOperation,
): readonly KeyframeEditOperation[] {
  return operation.type === 'keyframe-transaction-update' || operation.type === 'keyframe-transaction-commit'
    ? operation.operations
    : [];
}

export function preflightKeyframeTransaction(
  operation: KeyframeTransactionOperation,
  state: KeyframeTransactionPreflightState,
  knownTransactionKeyframeIds: ReadonlySet<string> = new Set(),
): TimelineEditWarning[] {
  const warnings: TimelineEditWarning[] = [];
  validateClipTarget(operation.clipId, state, warnings);

  if (operation.type === 'keyframe-transaction-cancel') {
    return uniqueWarnings(warnings);
  }

  if (operation.type === 'keyframe-transaction-begin') {
    for (const keyframeId of operation.keyframeIds) {
      const owner = findKeyframeOwner(state.clipKeyframes, keyframeId);
      if (!owner) {
        warnings.push({
          code: 'keyframe-not-found',
          message: `Keyframe not found: ${keyframeId}`,
        });
        continue;
      }
      validateClipTarget(owner.clipId, state, warnings);
    }
    return uniqueWarnings(warnings);
  }

  for (const editOperation of getKeyframeTransactionEditOperations(operation)) {
    validateEditOperation(editOperation, state, knownTransactionKeyframeIds, warnings);
  }

  return uniqueWarnings(warnings);
}

export function rememberKeyframeTransactionTargets(
  snapshot: KeyframeTransactionTargetSnapshot,
  operation: KeyframeTransactionOperation,
  clipKeyframes: Map<string, Keyframe[]>,
): void {
  const remember = (keyframe: Keyframe | undefined) => {
    if (!keyframe || snapshot.keyframesById.has(keyframe.id)) return;
    snapshot.keyframesById.set(keyframe.id, cloneKeyframe(keyframe));
  };

  for (const keyframeId of operation.keyframeIds) {
    remember(findKeyframeOwner(clipKeyframes, keyframeId)?.keyframe);
  }

  for (const editOperation of getKeyframeTransactionEditOperations(operation)) {
    if (editOperation.type === 'keyframe-select') {
      editOperation.selectedKeyframeIds.forEach((keyframeId) => {
        remember(findKeyframeOwner(clipKeyframes, keyframeId)?.keyframe);
      });
      continue;
    }
    if (editOperation.type === 'keyframe-create') {
      const existingAtTime = getKeyframeAtTime(
        clipKeyframes.get(editOperation.clipId) ?? [],
        editOperation.property,
        editOperation.time,
      );
      remember(existingAtTime);
      continue;
    }
    remember(findKeyframeOwner(clipKeyframes, editOperation.keyframeId)?.keyframe);
  }
}

export function collectKeyframeIds(clipKeyframes: Map<string, Keyframe[]>): Set<string> {
  const ids = new Set<string>();
  clipKeyframes.forEach((keyframes) => {
    keyframes.forEach((keyframe) => ids.add(keyframe.id));
  });
  return ids;
}

export function recordCreatedKeyframeIds(
  snapshot: KeyframeTransactionTargetSnapshot,
  beforeIds: ReadonlySet<string>,
  clipKeyframes: Map<string, Keyframe[]>,
): void {
  clipKeyframes.forEach((keyframes) => {
    keyframes.forEach((keyframe) => {
      if (!beforeIds.has(keyframe.id)) {
        snapshot.createdKeyframeIds.add(keyframe.id);
      }
    });
  });
}

export function restoreKeyframeTransactionTargets(
  snapshot: KeyframeTransactionTargetSnapshot,
  clipKeyframes: Map<string, Keyframe[]>,
  explicitDiscardKeyframeIds: readonly string[] = [],
): Map<string, Keyframe[]> {
  const discardIds = new Set([
    ...snapshot.createdKeyframeIds,
    ...explicitDiscardKeyframeIds,
  ]);
  const restoreIds = new Set(snapshot.keyframesById.keys());
  const next = new Map<string, Keyframe[]>();

  clipKeyframes.forEach((keyframes, clipId) => {
    const retained = keyframes.filter((keyframe) => (
      !discardIds.has(keyframe.id) && !restoreIds.has(keyframe.id)
    ));
    if (retained.length > 0) {
      next.set(clipId, retained.map(cloneKeyframe));
    }
  });

  snapshot.keyframesById.forEach((keyframe) => {
    if (discardIds.has(keyframe.id)) return;
    const keyframes = next.get(keyframe.clipId) ?? [];
    next.set(
      keyframe.clipId,
      [...keyframes, cloneKeyframe(keyframe)].sort((left, right) => left.time - right.time),
    );
  });

  return next;
}
