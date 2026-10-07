import { createKeyframeBasicActions } from '../keyframes/keyframeBasicActions';
import type { TimelineStore } from '../types';
import type { Keyframe } from '../../../types/keyframes';
import { getKeyframeAtTime } from '../../../utils/keyframeInterpolation';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import {
  applyKeyframeSelection,
  clonePathKeyframeValue,
  createPathValueKeyframeId,
  findKeyframeOwner,
} from './keyframeTransactionHelpers';
import type { KeyframeEditOperation } from './transactionTypes';
import type { TimelineEditWarning } from './types';

/** Stage one pointer sample atomically; publication, subscribers and invalidation run once. */
export function applyKeyframeTransactionMutations(
  operations: readonly KeyframeEditOperation[],
  context: TimelineEditOperationApplyContext,
  warnings: TimelineEditWarning[],
): void {
  const before = context.get();
  let draft = before;
  let invalidated = false;
  const patch: Partial<TimelineStore> = {};
  const set: TimelineEditOperationApplyContext['set'] = partial => {
    const next = typeof partial === 'function' ? partial(draft) : partial;
    Object.assign(patch, next);
    draft = { ...draft, ...next };
  };
  const actions = createKeyframeBasicActions(set, () => draft);
  draft = { ...draft, ...actions, invalidateCache: () => { invalidated = true; } };
  const warningCount = warnings.length;
  applyKeyframeOperations(operations, { ...context, get: () => draft, set }, warnings);
  if (warnings.length !== warningCount) return;
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
    before[key as keyof TimelineStore] !== value)) as Partial<TimelineStore>;
  if (Object.keys(changed).length) context.set(changed);
  if (invalidated) context.get().invalidateCache();
}

function applyKeyframeOperations(
  operations: readonly KeyframeEditOperation[],
  context: TimelineEditOperationApplyContext,
  warnings: TimelineEditWarning[],
): void {
  const { get, set } = context;

  for (const keyframeOperation of operations) {
    if (keyframeOperation.type === 'keyframe-create') {
      const targetClip = get().clips.find(candidate => candidate.id === keyframeOperation.clipId);
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
      if (keyframeOperation.value.pathValue && targetClip) {
        const clampedTime = Math.max(0, Math.min(keyframeOperation.time, targetClip.duration));
        const existingKeyframes = get().clipKeyframes.get(keyframeOperation.clipId) ?? [];
        const existingAtTime = getKeyframeAtTime(
          existingKeyframes,
          keyframeOperation.property,
          clampedTime,
        );
        const pathValue = clonePathKeyframeValue(keyframeOperation.value.pathValue);
        const nextKeyframes: Keyframe[] = existingAtTime
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
      if (keyframeOperation.type !== 'keyframe-remove') {
        warnings.push({
          code: 'keyframe-not-found',
          message: `Keyframe not found: ${keyframeOperation.keyframeId}`,
          clipId: keyframeOperation.clipId,
        });
      }
      continue;
    }

    if (keyframeOperation.type === 'keyframe-move') {
      get().moveKeyframe(keyframeOperation.keyframeId, keyframeOperation.resolvedTime);
    } else if (keyframeOperation.type === 'keyframe-update-value') {
      if (typeof keyframeOperation.value.value === 'number') {
        get().updateKeyframe(keyframeOperation.keyframeId, { value: keyframeOperation.value.value });
      } else if (keyframeOperation.value.pathValue) {
        get().updateKeyframe(keyframeOperation.keyframeId, { pathValue: keyframeOperation.value.pathValue });
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
}
