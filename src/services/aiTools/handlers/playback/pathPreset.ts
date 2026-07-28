import { clampPlaybackTime, type TimelineStore } from './runtime';
import { computeTimelineOccupancy } from '../../../timeline/timelineOccupancy';

export type PlaybackPathPreset = 'play_scrub_stress_v1';

export type PlaybackPathStep =
  | {
    kind: 'play';
    label: string;
    durationMs: number;
    pauseAtEnd: boolean;
    playableEndTime: number;
  }
  | {
    kind: 'scrub';
    label: string;
    durationMs: number;
    targetTime: number;
    unclampedTargetTime: number;
    beginWhilePlaying: boolean;
    pauseOnRelease: boolean;
  };

export interface PlaybackPathAnchor {
  clipStartTime: number;
  playableEndTime: number;
  clipId?: string;
  clipName?: string;
}

export function findPlaybackPathAnchor(timelineStore: TimelineStore): PlaybackPathAnchor {
  // occupiedEnd: agent playback paths exclude UI-only trailing timeline padding.
  const occupiedEnd = computeTimelineOccupancy(
    timelineStore.clips,
    timelineStore.tracks,
  ).occupied?.endSeconds ?? 0;
  const videoTrackIds = new Set(
    timelineStore.tracks
      .filter((track) => track.type === 'video')
      .map((track) => track.id)
  );
  const videoClips = timelineStore.clips
    .filter((clip) => videoTrackIds.has(clip.trackId))
    .sort((a, b) => a.startTime - b.startTime);
  const activeClip = videoClips.find((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return timelineStore.playheadPosition >= clip.startTime && timelineStore.playheadPosition < clipEnd;
  }) ?? videoClips[0];

  if (!activeClip) {
    return {
      clipStartTime: clampPlaybackTime(timelineStore.playheadPosition, occupiedEnd),
      playableEndTime: occupiedEnd,
    };
  }

  return {
    clipStartTime: activeClip.startTime,
    playableEndTime: occupiedEnd,
    clipId: activeClip.id,
    clipName: activeClip.name,
  };
}

function clampPlaybackPathTargetTime(
  targetTime: number,
  anchor: PlaybackPathAnchor,
  followingPlaySeconds = 0
): number {
  const endMargin = Math.max(0.5, followingPlaySeconds + 0.5);
  const latestTarget = Math.max(anchor.clipStartTime, anchor.playableEndTime - endMargin);
  return Math.min(Math.max(anchor.clipStartTime, targetTime), latestTarget);
}

function createPlaybackPathPlayStep(
  label: string,
  durationMs: number,
  pauseAtEnd: boolean,
  anchor: PlaybackPathAnchor
): Extract<PlaybackPathStep, { kind: 'play' }> {
  return {
    kind: 'play',
    label,
    durationMs,
    pauseAtEnd,
    playableEndTime: anchor.playableEndTime,
  };
}

function createPlaybackPathScrubStep(
  label: string,
  durationMs: number,
  targetTime: number,
  followingPlaySeconds: number,
  anchor: PlaybackPathAnchor
): Extract<PlaybackPathStep, { kind: 'scrub' }> {
  return {
    kind: 'scrub',
    label,
    durationMs,
    targetTime: clampPlaybackPathTargetTime(targetTime, anchor, followingPlaySeconds),
    unclampedTargetTime: targetTime,
    beginWhilePlaying: true,
    pauseOnRelease: true,
  };
}

export function buildPlaybackPathPreset(
  preset: PlaybackPathPreset,
  anchor: PlaybackPathAnchor
): PlaybackPathStep[] {
  const clipStartTime = anchor.clipStartTime;
  switch (preset) {
    case 'play_scrub_stress_v1':
    default:
      return [
        createPlaybackPathPlayStep('play_1s_from_clip_start', 1000, false, anchor),
        createPlaybackPathScrubStep('scrub_while_playing_to_30s_in_1s', 1000, clipStartTime + 30, 1, anchor),
        createPlaybackPathPlayStep('play_1s_after_30s_scrub', 1000, false, anchor),
        createPlaybackPathScrubStep('scrub_while_playing_to_3m_in_2s', 2000, clipStartTime + 180, 2, anchor),
        createPlaybackPathPlayStep('play_2s_after_3m_scrub', 2000, false, anchor),
        createPlaybackPathScrubStep('scrub_while_playing_back_to_10s_in_1s', 1000, clipStartTime + 10, 5, anchor),
        createPlaybackPathPlayStep('play_5s_after_return_to_10s', 5000, true, anchor),
      ];
  }
}
