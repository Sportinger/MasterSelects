import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';

export const CLIP_SPEED_MIN_MULTIPLIER = 0.1;
export const CLIP_SPEED_MAX_MULTIPLIER = 10;
export const CLIP_SPEED_MIN_SIGNED_MULTIPLIER = -CLIP_SPEED_MAX_MULTIPLIER;
export const CLIP_SPEED_MIN_PERCENT = CLIP_SPEED_MIN_SIGNED_MULTIPLIER * 100;
export const CLIP_SPEED_MAX_PERCENT = CLIP_SPEED_MAX_MULTIPLIER * 100;

export interface LinkedVideoAudioPair {
  video: TimelineClip;
  audio: TimelineClip;
}

function isVideoClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'video';
}

function isAudioClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio';
}

/**
 * Resolve a reciprocal video/audio link from either half of the pair.
 * A reverse lookup keeps legacy projects working when only one side retained
 * its linkedClipId.
 */
export function resolveLinkedVideoAudioPair(
  clips: readonly TimelineClip[],
  clipId: string,
): LinkedVideoAudioPair | null {
  const clip = clips.find(candidate => candidate.id === clipId);
  if (!clip) return null;

  const linked = clip.linkedClipId
    ? clips.find(candidate => candidate.id === clip.linkedClipId)
    : clips.find(candidate => candidate.linkedClipId === clip.id);
  if (!linked) return null;

  if (isVideoClip(clip) && isAudioClip(linked)) {
    return { video: clip, audio: linked };
  }
  if (isAudioClip(clip) && isVideoClip(linked)) {
    return { video: linked, audio: clip };
  }
  return null;
}

/** Undefined is intentionally the legacy-safe default: linked audio follows. */
export function isLinkedAudioFollowingVideo(pair: LinkedVideoAudioPair): boolean {
  return pair.audio.followsLinkedVideoSpeed !== false;
}

export function resolveSpeedMutationTarget(
  clips: readonly TimelineClip[],
  clipId: string,
): { leader: TimelineClip; follower: TimelineClip | null; pair: LinkedVideoAudioPair | null } | null {
  const clip = clips.find(candidate => candidate.id === clipId);
  if (!clip) return null;

  const pair = resolveLinkedVideoAudioPair(clips, clipId);
  if (!pair || !isLinkedAudioFollowingVideo(pair)) {
    return { leader: clip, follower: null, pair };
  }
  return { leader: pair.video, follower: pair.audio, pair };
}

export function cloneLinkedSpeedKeyframes(
  leaderKeyframes: readonly Keyframe[],
  followerId: string,
): Keyframe[] {
  return leaderKeyframes
    .filter(keyframe => keyframe.property === 'speed')
    .map(keyframe => ({
      ...structuredClone(keyframe),
      id: `linked-speed:${keyframe.id}:${followerId}`,
      clipId: followerId,
    }));
}

export function synchronizeFollowerSpeedKeyframes(
  keyframes: ReadonlyMap<string, readonly Keyframe[]>,
  pair: LinkedVideoAudioPair,
): Map<string, Keyframe[]> {
  const next = new Map<string, Keyframe[]>();
  keyframes.forEach((items, id) => next.set(id, [...items]));

  const followerOtherKeyframes = (keyframes.get(pair.audio.id) ?? [])
    .filter(keyframe => keyframe.property !== 'speed');
  const followerSpeedKeyframes = cloneLinkedSpeedKeyframes(
    keyframes.get(pair.video.id) ?? [],
    pair.audio.id,
  );
  const followerKeyframes = [...followerOtherKeyframes, ...followerSpeedKeyframes]
    .sort((left, right) => left.time - right.time);

  if (followerKeyframes.length > 0) {
    next.set(pair.audio.id, followerKeyframes);
  } else {
    next.delete(pair.audio.id);
  }
  return next;
}

export function synchronizeAllFollowingAudioSpeedKeyframes(
  clips: readonly TimelineClip[],
  keyframes: ReadonlyMap<string, readonly Keyframe[]>,
): Map<string, Keyframe[]> {
  let next = new Map<string, Keyframe[]>();
  keyframes.forEach((items, id) => next.set(id, [...items]));

  for (const video of clips) {
    if (!isVideoClip(video)) continue;
    const pair = resolveLinkedVideoAudioPair(clips, video.id);
    if (!pair || !isLinkedAudioFollowingVideo(pair)) continue;
    next = synchronizeFollowerSpeedKeyframes(next, pair);
  }
  return next;
}

export function normalizeFollowingAudioSpeedState(
  clips: readonly TimelineClip[],
  keyframes: ReadonlyMap<string, readonly Keyframe[]>,
): { clips: TimelineClip[]; keyframes: Map<string, Keyframe[]>; changedAudioClipIds: string[] } {
  let nextClips = [...clips];
  let nextKeyframes = new Map<string, Keyframe[]>();
  keyframes.forEach((items, id) => nextKeyframes.set(id, [...items]));
  const changedAudioClipIds: string[] = [];

  for (const video of clips) {
    if (!isVideoClip(video)) continue;
    const pair = resolveLinkedVideoAudioPair(nextClips, video.id);
    if (!pair || !isLinkedAudioFollowingVideo(pair)) continue;

    const audioSpeedKeyframes = nextKeyframes.get(pair.audio.id) ?? [];
    const expectedSpeedKeyframes = cloneLinkedSpeedKeyframes(
      nextKeyframes.get(pair.video.id) ?? [],
      pair.audio.id,
    );
    const speedKeyframesMatch = JSON.stringify(
      audioSpeedKeyframes.filter(keyframe => keyframe.property === 'speed'),
    ) === JSON.stringify(expectedSpeedKeyframes);
    const timingMatches = pair.audio.speed === pair.video.speed && pair.audio.duration === pair.video.duration;
    if (speedKeyframesMatch && timingMatches) continue;

    nextClips = nextClips.map(candidate => candidate.id === pair.audio.id
      ? { ...candidate, speed: pair.video.speed, duration: pair.video.duration }
      : candidate);
    nextKeyframes = synchronizeFollowerSpeedKeyframes(nextKeyframes, pair);
    changedAudioClipIds.push(pair.audio.id);
  }

  return { clips: nextClips, keyframes: nextKeyframes, changedAudioClipIds };
}
