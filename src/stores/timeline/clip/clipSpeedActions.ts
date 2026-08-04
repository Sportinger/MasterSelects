import { endBatch, startBatch } from '../../historyStore';
import { Logger } from '../../../services/logger';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { calculateTimelineDuration } from '../../../utils/speedIntegration';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import {
  CLIP_SPEED_MAX_MULTIPLIER,
  CLIP_SPEED_MIN_MULTIPLIER,
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
  resolveSpeedMutationTarget,
  synchronizeFollowerSpeedKeyframes,
} from '../helpers/linkedClipSpeed';
import type { SetClipSpeedOptions } from '../storeTypes/clipSpeedActionTypes';
import type { ClipActionContext } from './clipActionContext';

const log = Logger.create('ClipSpeedActions');

function isClipOnLockedTrack(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
): boolean {
  const clip = clips.find(candidate => candidate.id === clipId);
  return !!clip && tracks.find(track => track.id === clip.trackId)?.locked === true;
}

export function toggleClipReverseAction(
  { set, get }: ClipActionContext,
  id: string,
): void {
  const { clips, tracks, invalidateCache } = get();
  const clip = clips.find(candidate => candidate.id === id);
  if (!clip) return;
  const pair = resolveLinkedVideoAudioPair(clips, id);
  const affectedIds = pair ? [pair.video.id, pair.audio.id] : [id];
  if (affectedIds.some(clipId => isClipOnLockedTrack(clips, tracks, clipId))) {
    log.warn('Cannot reverse clip on locked track', { id });
    return;
  }
  const reversed = !clip.reversed;
  set({
    clips: clips.map(candidate => affectedIds.includes(candidate.id)
      ? { ...clearProcessedAudioAnalysisRefs(candidate), reversed }
      : candidate),
  });
  invalidateCache();
}

export function setClipSpeedAction(
  { set, get }: ClipActionContext,
  clipId: string,
  speed: number,
  options: SetClipSpeedOptions = {},
): boolean {
  const magnitude = Math.abs(speed);
  if (
    !Number.isFinite(speed) ||
    magnitude < CLIP_SPEED_MIN_MULTIPLIER ||
    magnitude > CLIP_SPEED_MAX_MULTIPLIER
  ) {
    log.warn('Clip speed is outside the supported range', { clipId, speed });
    return false;
  }

  const initialState = get();
  const target = resolveSpeedMutationTarget(initialState.clips, clipId);
  if (!target) return false;
  const affectedIds = [target.leader.id, ...(target.follower ? [target.follower.id] : [])];
  if (affectedIds.some(id => isClipOnLockedTrack(initialState.clips, initialState.tracks, id))) {
    log.warn('Cannot update linked clip speed on a locked track', { clipId, affectedIds });
    return false;
  }

  const historyBatch = startBatch(target.follower ? 'Change linked clip speed' : 'Change clip speed');
  try {
    const propertyHasKeyframes = initialState.hasKeyframes(target.leader.id, 'speed');
    const shouldWriteKeyframe = initialState.isRecording(target.leader.id, 'speed') || propertyHasKeyframes;
    if (shouldWriteKeyframe) {
      get().addKeyframe(target.leader.id, 'speed', speed);
    }

    const currentState = get();
    const currentLeader = currentState.clips.find(candidate => candidate.id === target.leader.id);
    if (!currentLeader) return false;
    const sourceDuration = currentLeader.outPoint - currentLeader.inPoint;
    const leaderKeyframes = currentState.clipKeyframes.get(currentLeader.id) ?? [];
    const speedKeyframes = leaderKeyframes.filter(keyframe => keyframe.property === 'speed');
    const hasForwardSpeed = speedKeyframes.some(keyframe => keyframe.value > 0);
    const hasReverseSpeed = speedKeyframes.some(keyframe => keyframe.value < 0);
    const changesDirection = hasForwardSpeed && hasReverseSpeed;
    const duration = shouldWriteKeyframe
      ? changesDirection
        // Direction-changing curves are non-monotonic, so source time has no
        // unique inverse. Preserve the authored clip length for those ramps.
        ? currentLeader.duration
        : calculateTimelineDuration(leaderKeyframes, sourceDuration, speed)
      : sourceDuration / magnitude;

    let nextKeyframes = new Map(currentState.clipKeyframes);
    if (target.follower && target.pair) {
      nextKeyframes = synchronizeFollowerSpeedKeyframes(nextKeyframes, target.pair);
    }

    const nextClips = currentState.clips.map(candidate => {
      const isLeader = candidate.id === currentLeader.id;
      const isFollower = target.follower?.id === candidate.id;
      if (!isLeader && !isFollower) return candidate;
      return clearProcessedAudioAnalysisRefs({
        ...candidate,
        speed,
        duration,
        ...(options.preservesPitch !== undefined
          ? { preservesPitch: options.preservesPitch }
          : {}),
      });
    });
    set({ clips: nextClips, clipKeyframes: nextKeyframes });
    get().updateDuration();
    get().invalidateCache();
    return true;
  } finally {
    if (historyBatch.opened) endBatch();
  }
}

export function setLinkedClipSpeedEnabledAction(
  { set, get }: ClipActionContext,
  clipId: string,
  enabled: boolean,
): boolean {
  const initialState = get();
  const pair = resolveLinkedVideoAudioPair(initialState.clips, clipId);
  if (!pair) return false;
  if ([pair.video.id, pair.audio.id].some(id => (
    isClipOnLockedTrack(initialState.clips, initialState.tracks, id)
  ))) {
    log.warn('Cannot change linked speed setting on a locked track', { clipId });
    return false;
  }
  if (isLinkedAudioFollowingVideo(pair) === enabled) return true;

  const historyBatch = startBatch(enabled ? 'Link audio speed' : 'Unlink audio speed');
  try {
    const nextKeyframes = enabled
      ? synchronizeFollowerSpeedKeyframes(initialState.clipKeyframes, pair)
      : new Map(initialState.clipKeyframes);
    const nextClips = initialState.clips.map(candidate => {
      if (candidate.id !== pair.audio.id) return candidate;
      return clearProcessedAudioAnalysisRefs({
        ...candidate,
        followsLinkedVideoSpeed: enabled ? undefined : false,
        ...(enabled ? {
          speed: pair.video.speed,
          duration: pair.video.duration,
        } : {}),
      });
    });
    set({ clips: nextClips, clipKeyframes: nextKeyframes });
    get().updateDuration();
    get().invalidateCache();
    return true;
  } finally {
    if (historyBatch.opened) endBatch();
  }
}

export function setClipPreservesPitchAction(
  { set, get }: ClipActionContext,
  clipId: string,
  preservesPitch: boolean,
): void {
  const { clips, tracks } = get();
  const pair = resolveLinkedVideoAudioPair(clips, clipId);
  const targetClipId = pair && pair.video.id === clipId && isLinkedAudioFollowingVideo(pair)
    ? pair.audio.id
    : clipId;
  if (isClipOnLockedTrack(clips, tracks, targetClipId)) {
    log.warn('Cannot update clip pitch on locked track', { clipId });
    return;
  }
  set({
    clips: get().clips.map(candidate => candidate.id === targetClipId
      ? clearProcessedAudioAnalysisRefs({ ...candidate, preservesPitch })
      : candidate),
  });
}
