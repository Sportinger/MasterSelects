import { cameraOrbitKeyframeFields } from '../../../services/cameraOrbitCapture';
import type { Keyframe } from '../../../types/keyframes';
import type { KeyframeActions } from '../storeTypes/utilityActionTypes';
import type { SliceCreator } from '../storeTypes/timelineStoreTypes';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { getKeyframeAtTime, hasKeyframesForProperty } from '../../../utils/keyframeInterpolation';
import { isHoldEasing, normalizeEasingType } from '../../../utils/easing';
import { isVectorAnimationSourceType, parseVectorAnimationStateProperty } from '../../../types/vectorAnimation';
import type { AudioKeyframeInvalidationTarget } from './audioEffectKeyframeValues';
import { findClipById, isAnyKeyframeOnLockedTrack, isClipOnLockedTrack } from './keyframeClipLookup';
import { normalizeVectorAnimationStateKeyframeValue } from './vectorAnimationKeyframeValues';
import {
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
  resolveSpeedMutationTarget,
  synchronizeAllFollowingAudioSpeedKeyframes,
} from '../helpers/linkedClipSpeed';
import { finalizeLinkedSpeedKeyframeMutation, isValidSpeedKeyframeValue } from './linkedSpeedKeyframeState';
import { normalizeTimelinePropertyValue } from './keyframePropertyValue';
import { clipLocalToKeyframeTime } from '../../../services/flock/time/flockKeyframeTime';
import { applyEasingCurveToKeyframes } from './keyframeEasingCurves';

type KeyframeBasicActions = Pick<
  KeyframeActions,
  | 'addKeyframe'
  | 'removeKeyframe'
  | 'updateKeyframe'
  | 'updateKeyframes'
  | 'moveKeyframe'
  | 'moveKeyframes'
  | 'getClipKeyframes'
  | 'hasKeyframes'
  | 'toggleKeyframeRecording'
  | 'isRecording'
  | 'updateBezierHandle'
  | 'applyKeyframeEasingCurve'
>;

export const createKeyframeBasicActions: SliceCreator<KeyframeBasicActions> = (set, get) => ({
  addKeyframe: (clipId, property, value, time, easing) => {
    const { clips, tracks, playheadPosition, clipKeyframes, invalidateCache } = get();
    if (property === 'speed') {
      if (!isValidSpeedKeyframeValue(value)) return;
      const speedTarget = resolveSpeedMutationTarget(clips, clipId);
      if (speedTarget && speedTarget.leader.id !== clipId) {
        get().addKeyframe(speedTarget.leader.id, property, value, time, easing);
        return;
      }
      const pair = resolveLinkedVideoAudioPair(clips, clipId);
      if (
        pair &&
        isLinkedAudioFollowingVideo(pair) &&
        isClipOnLockedTrack(clips, tracks, pair.audio.id)
      ) return;
    }
    if (isClipOnLockedTrack(clips, tracks, clipId)) return;
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const easingFields = { easing: normalizeEasingType(easing, 'linear'), hold: isHoldEasing(easing) || undefined };
    const vectorAnimationState = parseVectorAnimationStateProperty(property);
    const normalizedPropertyValue = normalizeTimelinePropertyValue(property, value);
    const keyframeValue = vectorAnimationState && isVectorAnimationSourceType(clip.source?.type)
      ? normalizeVectorAnimationStateKeyframeValue(clip, vectorAnimationState.stateMachineName, normalizedPropertyValue)
      : normalizedPropertyValue;

    const clipLocalTime = time ?? (playheadPosition - clip.startTime);
    const visibleTime = Math.max(0, Math.min(clipLocalTime, clip.duration));
    // Flock graph parameters store keyframes in simulation source seconds.
    const clampedTime = clipLocalToKeyframeTime(clip, property, visibleTime, get().getSourceTimeForClip);
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const existingAtTime = getKeyframeAtTime(existingKeyframes, property, clampedTime);

    const orbitFields = clip.source?.type === 'camera' && (property.startsWith('position.') || property.startsWith('rotation.'))
      ? cameraOrbitKeyframeFields(clipId, visibleTime) : undefined;
    let newKeyframes: Keyframe[];

    if (existingAtTime) {
      newKeyframes = existingKeyframes.map(k =>
        // Recording/inspector edits change the value, not the authored interpolation.
        k.id === existingAtTime.id ? { ...k, value: keyframeValue, ...(easing === undefined ? {} : easingFields), ...orbitFields } : k
      );
    } else {
      const newKeyframe: Keyframe = {
        id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        clipId,
        time: clampedTime,
        property,
        value: keyframeValue,
        ...easingFields,
        ...orbitFields,
      };
      newKeyframes = [...existingKeyframes, newKeyframe].sort((a, b) => a.time - b.time);
    }

    if (orbitFields) newKeyframes = newKeyframes.map(key => Math.abs(key.time - clampedTime) < 1e-6
      && (key.property.startsWith('position.') || key.property.startsWith('rotation.')) ? { ...key, ...orbitFields } : key);
    const newMap = new Map(clipKeyframes);
    newMap.set(clipId, newKeyframes);
    set(finalizeLinkedSpeedKeyframeMutation(clips, newMap, [{ clipId, property }]));

    invalidateCache();
    renderHostPort.requestRender();
  },

  removeKeyframe: (keyframeId) => {
    const { clipKeyframes, clips, tracks, invalidateCache, selectedKeyframeIds } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, [keyframeId])) return;
    const newMap = new Map<string, Keyframe[]>();
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      const removed = keyframes.find(k => k.id === keyframeId);
      if (removed) {
        invalidationTargets.push({ clipId, property: removed.property });
      }
      const filtered = keyframes.filter(k => k.id !== keyframeId);
      if (filtered.length > 0) {
        newMap.set(clipId, filtered);
      }
    });

    const newSelection = new Set(selectedKeyframeIds);
    newSelection.delete(keyframeId);

    set({
      ...finalizeLinkedSpeedKeyframeMutation(clips, newMap, invalidationTargets),
      selectedKeyframeIds: newSelection,
    });
    invalidateCache();
  },

  updateKeyframe: (keyframeId, updates) => get().updateKeyframes([keyframeId], updates),

  updateKeyframes: (keyframeIds, updates) => {
    if (!keyframeIds.length) return;
    const targets = new Set(keyframeIds);
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, keyframeIds)) return;
    const newMap = new Map<string, Keyframe[]>();
    const { easing, ...restUpdates } = updates;
    const baseNormalizedUpdates = easing !== undefined
      ? { ...restUpdates, easing: normalizeEasingType(easing, 'linear') }
      : restUpdates;
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      if (!keyframes.some(key => targets.has(key.id))) { newMap.set(clipId, keyframes); return; }
      const clip = findClipById(clips, clipId);
      newMap.set(clipId, keyframes.map(k => {
        if (!targets.has(k.id)) {
          return k;
        }
        const nextProperty = baseNormalizedUpdates.property ?? k.property;
        const nextValue = baseNormalizedUpdates.value === undefined
          ? k.value
          : normalizeTimelinePropertyValue(nextProperty, baseNormalizedUpdates.value);
        if (nextProperty === 'speed' && !isValidSpeedKeyframeValue(nextValue)) return k;
        const effective = { ...baseNormalizedUpdates, ...(baseNormalizedUpdates.value === undefined ? {} : { value: nextValue }) };
        if (Object.entries(effective).every(([key, value]) => Object.is(k[key as keyof Keyframe], value))) return k;
        invalidationTargets.push({ clipId, property: k.property });
        if (baseNormalizedUpdates.property) {
          invalidationTargets.push({ clipId, property: baseNormalizedUpdates.property });
        }

        const propertyNormalizedUpdates = baseNormalizedUpdates.value === undefined
          ? baseNormalizedUpdates
          : { ...baseNormalizedUpdates, value: nextValue };
        const vectorAnimationState = parseVectorAnimationStateProperty(nextProperty);
        const normalizedUpdates = vectorAnimationState && isVectorAnimationSourceType(clip?.source?.type) && propertyNormalizedUpdates.value !== undefined
          ? {
              ...propertyNormalizedUpdates,
              value: normalizeVectorAnimationStateKeyframeValue(
                clip,
                vectorAnimationState.stateMachineName,
                propertyNormalizedUpdates.value,
              ),
            }
          : propertyNormalizedUpdates;
        return { ...k, ...normalizedUpdates };
      }));
    });

    if (!invalidationTargets.length) return;
    set(finalizeLinkedSpeedKeyframeMutation(clips, newMap, invalidationTargets));
    invalidateCache();
  },

  moveKeyframe: (keyframeId, newTime) => {
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, [keyframeId])) return;
    const newMap = new Map<string, Keyframe[]>();
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      if (!keyframes.some(key => key.id === keyframeId)) { newMap.set(clipId, keyframes); return; }
      const clip = clips.find(c => c.id === clipId);
      const maxTime = clip?.duration ?? 999;
      const clampedTime = Math.max(0, Math.min(newTime, maxTime));

      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        const nextTime = clip ? clipLocalToKeyframeTime(clip, k.property, clampedTime, get().getSourceTimeForClip) : clampedTime;
        if (k.time === nextTime) return k;
        invalidationTargets.push({ clipId, property: k.property });
        return { ...k, time: nextTime };
      }).sort((a, b) => a.time - b.time));
    });

    if (!invalidationTargets.length) return;
    set(finalizeLinkedSpeedKeyframeMutation(clips, newMap, invalidationTargets));
    invalidateCache();
  },

  moveKeyframes: (keyframeIds, newTime) => {
    if (keyframeIds.length === 0) return;

    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, keyframeIds)) return;
    const targetIds = new Set(keyframeIds);
    const newMap = new Map<string, Keyframe[]>();
    let changed = false;
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = clips.find(c => c.id === clipId);
      const maxTime = clip?.duration ?? 999;
      const clampedTime = Math.max(0, Math.min(newTime, maxTime));
      let clipChanged = false;

      const nextKeyframes = keyframes.map(k => {
        if (!targetIds.has(k.id)) return k;
        const nextTime = clip ? clipLocalToKeyframeTime(clip, k.property, clampedTime, get().getSourceTimeForClip) : clampedTime;
        if (k.time === nextTime) return k;
        clipChanged = true;
        changed = true;
        invalidationTargets.push({ clipId, property: k.property });
        return { ...k, time: nextTime };
      });

      newMap.set(
        clipId,
        clipChanged
          ? nextKeyframes.sort((a, b) => a.time - b.time)
          : keyframes
      );
    });

    if (!changed) return;

    set(finalizeLinkedSpeedKeyframeMutation(clips, newMap, invalidationTargets));
    invalidateCache();
  },

  getClipKeyframes: (clipId) => {
    const { clipKeyframes } = get();
    return clipKeyframes.get(clipId) || [];
  },

  hasKeyframes: (clipId, property) => {
    const { clipKeyframes } = get();
    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) return false;
    if (!property) return true;
    return hasKeyframesForProperty(keyframes, property);
  },

  toggleKeyframeRecording: (clipId, property) => {
    const { keyframeRecordingEnabled } = get();
    const key = `${clipId}:${property}`;
    const newSet = new Set(keyframeRecordingEnabled);

    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }

    set({ keyframeRecordingEnabled: newSet });
  },

  isRecording: (clipId, property) => {
    const { keyframeRecordingEnabled } = get();
    return keyframeRecordingEnabled.has(`${clipId}:${property}`);
  },

  updateBezierHandle: (keyframeId, handle, position) => {
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, [keyframeId])) return;
    let changed = false;
    const newMap = new Map<string, Keyframe[]>();
    let speedChanged = false;

    clipKeyframes.forEach((keyframes, clipId) => {
      if (!keyframes.some(key => key.id === keyframeId)) { newMap.set(clipId, keyframes); return; }
      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        const previous = handle === 'in' ? k.handleIn : k.handleOut;
        if (k.easing === 'bezier' && previous?.x === position.x && previous?.y === position.y) return k;
        changed = true;
        speedChanged = k.property === 'speed';
        return {
          ...k,
          easing: 'bezier' as const,
          [handle === 'in' ? 'handleIn' : 'handleOut']: position,
        };
      }));
    });

    if (!changed) return;
    set({
      clipKeyframes: speedChanged
        ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
        : newMap,
    });
    invalidateCache();
  },

  applyKeyframeEasingCurve: (keyframeIds, curve, easing) => {
    if (keyframeIds.length === 0) return;
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, keyframeIds)) return;
    const targets = new Set(keyframeIds);
    const newMap = new Map<string, Keyframe[]>();
    let speedChanged = false;
    clipKeyframes.forEach((keyframes, clipId) => {
      if (!keyframes.some(key => targets.has(key.id))) { newMap.set(clipId, keyframes); return; }
      speedChanged ||= keyframes.some(key => targets.has(key.id) && key.property === 'speed');
      newMap.set(clipId, applyEasingCurveToKeyframes(keyframes, targets, curve, easing)
        .sort((a, b) => a.time - b.time));
    });
    set({ clipKeyframes: speedChanged ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap) : newMap });
    invalidateCache();
  },
});
