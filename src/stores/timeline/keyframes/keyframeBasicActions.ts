import type { Keyframe, KeyframeActions, SliceCreator, TimelineClip } from '../types';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { getKeyframeAtTime, hasKeyframesForProperty } from '../../../utils/keyframeInterpolation';
import { normalizeEasingType } from '../../../utils/easing';
import { isVectorAnimationSourceType, parseVectorAnimationStateProperty } from '../../../types/vectorAnimation';
import { clearProcessedAudioAnalysisRefsForKeyframeTargets, type AudioKeyframeInvalidationTarget } from './audioEffectKeyframeValues';
import { findClipById, isAnyKeyframeOnLockedTrack, isClipOnLockedTrack } from './keyframeClipLookup';
import { normalizeVectorAnimationStateKeyframeValue } from './vectorAnimationKeyframeValues';
import {
  CLIP_SPEED_MAX_MULTIPLIER,
  CLIP_SPEED_MIN_MULTIPLIER,
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
  resolveSpeedMutationTarget,
  synchronizeAllFollowingAudioSpeedKeyframes,
} from '../helpers/linkedClipSpeed';

type KeyframeBasicActions = Pick<
  KeyframeActions,
  | 'addKeyframe'
  | 'removeKeyframe'
  | 'updateKeyframe'
  | 'moveKeyframe'
  | 'moveKeyframes'
  | 'getClipKeyframes'
  | 'hasKeyframes'
  | 'toggleKeyframeRecording'
  | 'isRecording'
  | 'updateBezierHandle'
>;

function followingAudioSpeedInvalidationTargets(
  clips: readonly TimelineClip[],
): AudioKeyframeInvalidationTarget[] {
  return clips.flatMap(clip => {
    if (clip.source?.type !== 'video') return [];
    const pair = resolveLinkedVideoAudioPair(clips, clip.id);
    return pair && isLinkedAudioFollowingVideo(pair)
      ? [{ clipId: pair.audio.id, property: 'speed' as const }]
      : [];
  });
}

export const createKeyframeBasicActions: SliceCreator<KeyframeBasicActions> = (set, get) => ({
  addKeyframe: (clipId, property, value, time, easing = 'linear') => {
    const { clips, tracks, playheadPosition, clipKeyframes, invalidateCache } = get();
    if (property === 'speed') {
      const magnitude = Math.abs(value);
      if (
        !Number.isFinite(value) ||
        magnitude < CLIP_SPEED_MIN_MULTIPLIER ||
        magnitude > CLIP_SPEED_MAX_MULTIPLIER
      ) return;
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
    const normalizedEasing = normalizeEasingType(easing, 'linear');
    const vectorAnimationState = parseVectorAnimationStateProperty(property);
    const keyframeValue = vectorAnimationState && isVectorAnimationSourceType(clip.source?.type)
      ? normalizeVectorAnimationStateKeyframeValue(clip, vectorAnimationState.stateMachineName, value)
      : value;

    const clipLocalTime = time ?? (playheadPosition - clip.startTime);
    const clampedTime = Math.max(0, Math.min(clipLocalTime, clip.duration));
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const existingAtTime = getKeyframeAtTime(existingKeyframes, property, clampedTime);

    let newKeyframes: Keyframe[];

    if (existingAtTime) {
      newKeyframes = existingKeyframes.map(k =>
        k.id === existingAtTime.id ? { ...k, value: keyframeValue, easing: normalizedEasing } : k
      );
    } else {
      const newKeyframe: Keyframe = {
        id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        clipId,
        time: clampedTime,
        property,
        value: keyframeValue,
        easing: normalizedEasing,
      };
      newKeyframes = [...existingKeyframes, newKeyframe].sort((a, b) => a.time - b.time);
    }

    const newMap = new Map(clipKeyframes);
    newMap.set(clipId, newKeyframes);
    const synchronizedMap = property === 'speed'
      ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
      : newMap;
    const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
      clips,
      [
        { clipId, property },
        ...(property === 'speed' ? followingAudioSpeedInvalidationTargets(clips) : []),
      ],
    );
    set(nextClips === clips
      ? { clipKeyframes: synchronizedMap }
      : { clipKeyframes: synchronizedMap, clips: nextClips });

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

    const speedChanged = invalidationTargets.some(target => target.property === 'speed');
    const synchronizedMap = speedChanged
      ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
      : newMap;
    const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
      clips,
      [
        ...invalidationTargets,
        ...(speedChanged ? followingAudioSpeedInvalidationTargets(clips) : []),
      ],
    );
    set(nextClips === clips
      ? { clipKeyframes: synchronizedMap, selectedKeyframeIds: newSelection }
      : { clipKeyframes: synchronizedMap, selectedKeyframeIds: newSelection, clips: nextClips });
    invalidateCache();
  },

  updateKeyframe: (keyframeId, updates) => {
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, [keyframeId])) return;
    const newMap = new Map<string, Keyframe[]>();
    const { easing, ...restUpdates } = updates;
    const baseNormalizedUpdates = easing !== undefined
      ? { ...restUpdates, easing: normalizeEasingType(easing, 'linear') }
      : restUpdates;
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = findClipById(clips, clipId);
      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) {
          return k;
        }
        const nextProperty = baseNormalizedUpdates.property ?? k.property;
        const nextValue = baseNormalizedUpdates.value ?? k.value;
        if (
          nextProperty === 'speed' &&
          (
            !Number.isFinite(nextValue) ||
            Math.abs(nextValue) < CLIP_SPEED_MIN_MULTIPLIER ||
            Math.abs(nextValue) > CLIP_SPEED_MAX_MULTIPLIER
          )
        ) return k;
        invalidationTargets.push({ clipId, property: k.property });
        if (baseNormalizedUpdates.property) {
          invalidationTargets.push({ clipId, property: baseNormalizedUpdates.property });
        }

        const vectorAnimationState = parseVectorAnimationStateProperty(k.property);
        const normalizedUpdates = vectorAnimationState && isVectorAnimationSourceType(clip?.source?.type) && baseNormalizedUpdates.value !== undefined
          ? {
              ...baseNormalizedUpdates,
              value: normalizeVectorAnimationStateKeyframeValue(
                clip,
                vectorAnimationState.stateMachineName,
                baseNormalizedUpdates.value,
              ),
            }
          : baseNormalizedUpdates;
        return { ...k, ...normalizedUpdates };
      }));
    });

    const speedChanged = invalidationTargets.some(target => target.property === 'speed');
    const synchronizedMap = speedChanged
      ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
      : newMap;
    const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
      clips,
      [
        ...invalidationTargets,
        ...(speedChanged ? followingAudioSpeedInvalidationTargets(clips) : []),
      ],
    );
    set(nextClips === clips
      ? { clipKeyframes: synchronizedMap }
      : { clipKeyframes: synchronizedMap, clips: nextClips });
    invalidateCache();
  },

  moveKeyframe: (keyframeId, newTime) => {
    const { clipKeyframes, clips, tracks, invalidateCache } = get();
    if (isAnyKeyframeOnLockedTrack(clipKeyframes, clips, tracks, [keyframeId])) return;
    const newMap = new Map<string, Keyframe[]>();
    const invalidationTargets: AudioKeyframeInvalidationTarget[] = [];

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = clips.find(c => c.id === clipId);
      const maxTime = clip?.duration ?? 999;
      const clampedTime = Math.max(0, Math.min(newTime, maxTime));

      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        if (k.time !== clampedTime) {
          invalidationTargets.push({ clipId, property: k.property });
        }
        return { ...k, time: clampedTime };
      }).sort((a, b) => a.time - b.time));
    });

    const speedChanged = invalidationTargets.some(target => target.property === 'speed');
    const synchronizedMap = speedChanged
      ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
      : newMap;
    const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
      clips,
      [
        ...invalidationTargets,
        ...(speedChanged ? followingAudioSpeedInvalidationTargets(clips) : []),
      ],
    );
    set(nextClips === clips
      ? { clipKeyframes: synchronizedMap }
      : { clipKeyframes: synchronizedMap, clips: nextClips });
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
        if (k.time === clampedTime) return k;
        clipChanged = true;
        changed = true;
        invalidationTargets.push({ clipId, property: k.property });
        return { ...k, time: clampedTime };
      });

      newMap.set(
        clipId,
        clipChanged
          ? nextKeyframes.sort((a, b) => a.time - b.time)
          : keyframes
      );
    });

    if (!changed) return;

    const speedChanged = invalidationTargets.some(target => target.property === 'speed');
    const synchronizedMap = speedChanged
      ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
      : newMap;
    const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
      clips,
      [
        ...invalidationTargets,
        ...(speedChanged ? followingAudioSpeedInvalidationTargets(clips) : []),
      ],
    );
    set(nextClips === clips
      ? { clipKeyframes: synchronizedMap }
      : { clipKeyframes: synchronizedMap, clips: nextClips });
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
    const { clipKeyframes, clips, invalidateCache } = get();
    const newMap = new Map<string, Keyframe[]>();
    let speedChanged = false;

    clipKeyframes.forEach((keyframes, clipId) => {
      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        speedChanged = k.property === 'speed';
        return {
          ...k,
          easing: 'bezier' as const,
          [handle === 'in' ? 'handleIn' : 'handleOut']: position,
        };
      }));
    });

    set({
      clipKeyframes: speedChanged
        ? synchronizeAllFollowingAudioSpeedKeyframes(clips, newMap)
        : newMap,
    });
    invalidateCache();
  },
});
