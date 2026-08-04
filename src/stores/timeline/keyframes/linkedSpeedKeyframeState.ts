import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import {
  CLIP_SPEED_MAX_MULTIPLIER,
  CLIP_SPEED_MIN_MULTIPLIER,
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
  synchronizeAllFollowingAudioSpeedKeyframes,
} from '../helpers/linkedClipSpeed';
import {
  clearProcessedAudioAnalysisRefsForKeyframeTargets,
  type AudioKeyframeInvalidationTarget,
} from './audioEffectKeyframeValues';

interface LinkedSpeedKeyframeMutationState {
  clipKeyframes: Map<string, Keyframe[]>;
  clips?: TimelineClip[];
}

export function isValidSpeedKeyframeValue(value: number): boolean {
  const magnitude = Math.abs(value);
  return Number.isFinite(value) &&
    magnitude >= CLIP_SPEED_MIN_MULTIPLIER &&
    magnitude <= CLIP_SPEED_MAX_MULTIPLIER;
}

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

export function finalizeLinkedSpeedKeyframeMutation(
  clips: TimelineClip[],
  keyframes: Map<string, Keyframe[]>,
  invalidationTargets: readonly AudioKeyframeInvalidationTarget[],
): LinkedSpeedKeyframeMutationState {
  const speedChanged = invalidationTargets.some(target => target.property === 'speed');
  const synchronizedKeyframes = speedChanged
    ? synchronizeAllFollowingAudioSpeedKeyframes(clips, keyframes)
    : keyframes;
  const nextClips = clearProcessedAudioAnalysisRefsForKeyframeTargets(
    clips,
    [
      ...invalidationTargets,
      ...(speedChanged ? followingAudioSpeedInvalidationTargets(clips) : []),
    ],
  );
  return nextClips === clips
    ? { clipKeyframes: synchronizedKeyframes }
    : { clipKeyframes: synchronizedKeyframes, clips: nextClips };
}
