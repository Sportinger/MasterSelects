import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { getTimelinePlaybackWarmupVideo } from '../../services/timeline/timelinePlaybackWarmupRuntime';
import { hasWorkerGpuPlaybackStartVideoSource } from '../../services/timeline/workerGpuPlaybackStartWarmup';
import { renderHostPort } from '../../services/render/renderHostPort';
import { resolveTransitionSourceMapTime } from '../../services/timeline/transitionSourceMap';
import { getNestedClipSourceTiming } from '../../services/layerBuilder/layerBuilderNestedSourceTiming';
import { createTimelineTransitionMediaDurationResolver } from '../../services/timeline/timelineTransitionMediaDurations';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from './editOperations/transitionPlanner';
import type { PlaybackWarmupState } from './storeTypes/feedbackTypes';

type ReverseWorkerRuntimeModule = typeof import('../../services/layerBuilder/reverseWorkerWebCodecsRuntime');

export interface PlaybackWarmupVideo {
  readonly video: HTMLVideoElement;
  readonly targetTime?: number;
}

const PLAYBACK_WARMUP_TARGET_TOLERANCE_SECONDS = 0.04;
// Match the normal forward HTML playback's accepted startup drift. Within
// this window VideoSync can converge without a blocking pre-start seek, while
// the cached-frame hold prevents a transient transparent/black layer.
const PLAYBACK_WARMUP_REUSABLE_FRAME_TOLERANCE_SECONDS = 0.35;
const PLAYBACK_WARMUP_TIMEOUT_MS = 1_000;

let reverseWorkerRuntimeModulePromise: Promise<ReverseWorkerRuntimeModule> | null = null;

function getWarmupTimestamp(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createPlaybackWarmupState(input: Omit<PlaybackWarmupState, 'requestId' | 'startedAt'>): PlaybackWarmupState {
  return {
    requestId: `playback-warmup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    startedAt: getWarmupTimestamp(),
    ...input,
  };
}

export function waitForPlaybackWarmupFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = setTimeout(finish, 16);
      requestAnimationFrame(finish);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function getSafeWarmupTarget(video: HTMLVideoElement, targetTime: number): number {
  const nonNegativeTarget = Math.max(0, targetTime);
  if (!Number.isFinite(video.duration) || video.duration <= 0) return nonNegativeTarget;
  return Math.min(nonNegativeTarget, Math.max(0, video.duration - 0.001));
}

export function positionPlaybackWarmupVideo(entry: PlaybackWarmupVideo): void {
  if (entry.targetTime === undefined || !Number.isFinite(entry.targetTime) || entry.video.seeking) return;
  const targetTime = getSafeWarmupTarget(entry.video, entry.targetTime);
  if (Math.abs(entry.video.currentTime - targetTime) <= PLAYBACK_WARMUP_TARGET_TOLERANCE_SECONDS) return;
  try {
    entry.video.currentTime = targetTime;
  } catch {
    // A detached or not-yet-loaded element will be retried by the warm-up poll.
  }
}

export function isPlaybackWarmupVideoSettled(entry: PlaybackWarmupVideo): boolean {
  const lastPresentedTime = renderHostPort.getLastPresentedVideoTime(entry.video);
  if (
    entry.targetTime !== undefined &&
    Number.isFinite(entry.targetTime) &&
    typeof lastPresentedTime === 'number' &&
    Number.isFinite(lastPresentedTime)
  ) {
    const targetTime = getSafeWarmupTarget(entry.video, entry.targetTime);
    if (
      Math.abs(lastPresentedTime - targetTime) <=
      PLAYBACK_WARMUP_REUSABLE_FRAME_TOLERANCE_SECONDS
    ) {
      // The renderer already owns a target-adjacent GPU frame. Playback can
      // begin immediately while an in-flight HTML seek catches up behind the
      // per-layer stall hold, instead of blocking on the full warmup timeout.
      return true;
    }
  }
  if (entry.video.readyState < 2 || entry.video.seeking) return false;
  if (entry.targetTime === undefined || !Number.isFinite(entry.targetTime)) return true;
  const targetTime = getSafeWarmupTarget(entry.video, entry.targetTime);
  return Math.abs(entry.video.currentTime - targetTime) <= PLAYBACK_WARMUP_TARGET_TOLERANCE_SECONDS;
}

export function waitForPlaybackWarmupVideo(
  entry: PlaybackWarmupVideo,
  timeoutMs = PLAYBACK_WARMUP_TIMEOUT_MS,
): Promise<void> {
  positionPlaybackWarmupVideo(entry);
  if (isPlaybackWarmupVideoSettled(entry)) return Promise.resolve();

  return new Promise((resolve) => {
    let finished = false;
    let warmupPlaybackRequested = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const video = entry.video;
    const events = ['loadeddata', 'canplaythrough', 'seeked'] as const;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      if (pauseTimer) clearTimeout(pauseTimer);
      if (warmupPlaybackRequested) video.pause();
      if (typeof video.removeEventListener === 'function') {
        for (const event of events) video.removeEventListener(event, checkReady);
      }
      resolve();
    };
    const checkReady = () => {
      positionPlaybackWarmupVideo(entry);
      if (isPlaybackWarmupVideoSettled(entry)) finish();
    };

    if (typeof video.addEventListener === 'function') {
      for (const event of events) video.addEventListener(event, checkReady);
    }
    const pollTimer = setInterval(checkReady, 50);
    const timeoutTimer = setTimeout(finish, Math.max(0, timeoutMs));

    warmupPlaybackRequested = true;
    video.play().then(() => {
      if (finished) return;
      pauseTimer = setTimeout(() => {
        video.pause();
        warmupPlaybackRequested = false;
        checkReady();
      }, 50);
    }).catch(() => {
      // Event listeners and polling still cover autoplay-restricted browsers.
    });
  });
}

export function closeSourceMonitorForTimelinePlayback(input: {
  readonly sourceMonitorFileId: string | null;
  readonly setSourceMonitorFile: (fileId: string | null) => void;
}): void {
  if (input.sourceMonitorFileId) {
    input.setSourceMonitorFile(null);
  }
}

function getTransitionWarmupClipsAtTime(
  clips: readonly TimelineClip[],
  visibleVideoTrackIds: ReadonlySet<string>,
  time: number,
): TimelineClip[] {
  const clipsById = new Map<string, TimelineClip>();
  const getMediaDuration = createTimelineTransitionMediaDurationResolver();

  for (const outgoingClip of clips) {
    const transition = outgoingClip.transitionOut;
    if (!transition || !visibleVideoTrackIds.has(outgoingClip.trackId)) continue;

    const incomingClip = clips.find(clip => clip.id === transition.linkedClipId);
    if (!incomingClip || !visibleVideoTrackIds.has(incomingClip.trackId)) continue;

    const junctionTime = outgoingClip.startTime + outgoingClip.duration;
    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration,
    });
    if (!plan || time < plan.bodyStart || time >= plan.bodyEnd) continue;

    clipsById.set(outgoingClip.id, createTransitionSourceClip(outgoingClip, plan.outgoing, time));
    clipsById.set(incomingClip.id, createTransitionSourceClip(incomingClip, plan.incoming, time));
  }

  return [...clipsById.values()];
}

function getVisibleVideoTrackIds(tracks: readonly TimelineTrack[]): Set<string> {
  return new Set(
    tracks
      .filter((track) => track.type === 'video' && track.visible !== false)
      .map((track) => track.id)
  );
}

function getPlaybackWarmupTargetTime(
  clip: TimelineClip,
  timelineTime: number,
  getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number,
  getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number,
): number | undefined {
  const clipLocalTime = timelineTime - clip.startTime;
  const mappedTime = resolveTransitionSourceMapTime(clip.transitionSourceMap, clipLocalTime);
  if (mappedTime) return mappedTime.sourceTime;
  if (Number.isFinite(clip.transitionSourceTimeOverride)) {
    return clip.transitionSourceTimeOverride;
  }

  const inPoint = Number.isFinite(clip.inPoint) ? clip.inPoint : 0;
  const outPoint = Number.isFinite(clip.outPoint)
    ? clip.outPoint
    : inPoint + Math.max(0, Number.isFinite(clip.duration) ? clip.duration : 0);
  const initialSpeed = clip.transitionSourceHold
    ? 1
    : getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? inPoint : outPoint;
  const sourceOffset = getSourceTimeForClip(clip.id, clipLocalTime);
  const sourceTime = startPoint + sourceOffset;
  return Number.isFinite(sourceTime)
    ? Math.max(inPoint, Math.min(outPoint, sourceTime))
    : undefined;
}

function getReversePrimeClipsAtTime(
  clips: readonly TimelineClip[],
  visibleVideoTrackIds: ReadonlySet<string>,
  time: number,
): TimelineClip[] {
  const clipsAtPlayhead = clips.filter(clip => {
    if (!visibleVideoTrackIds.has(clip.trackId)) return false;
    const isAtPlayhead = time >= clip.startTime &&
                         time < clip.startTime + clip.duration;
    const hasVideo = getTimelinePlaybackWarmupVideo(clip.source) !== null;
    return isAtPlayhead && hasVideo;
  });
  const transitionClipsAtPlayhead = getTransitionWarmupClipsAtTime(
    clips,
    visibleVideoTrackIds,
    time,
  ).filter(clip => getTimelinePlaybackWarmupVideo(clip.source) !== null);
  return [...clipsAtPlayhead, ...transitionClipsAtPlayhead];
}

function hasNegativeTransitionSourceRateAtTime(clip: TimelineClip, time: number): boolean {
  const mappedTime = resolveTransitionSourceMapTime(
    clip.transitionSourceMap,
    time - clip.startTime,
  );
  return mappedTime ? mappedTime.sourceRate < 0 : false;
}

function loadReverseWorkerRuntimeModule(): Promise<ReverseWorkerRuntimeModule> {
  reverseWorkerRuntimeModulePromise ??= import('../../services/layerBuilder/reverseWorkerWebCodecsRuntime');
  return reverseWorkerRuntimeModulePromise;
}

if (typeof window !== 'undefined' && import.meta.env?.MODE !== 'test') {
  void loadReverseWorkerRuntimeModule().catch(() => {
    reverseWorkerRuntimeModulePromise = null;
  });
}

function primeReverseWorkerWebCodecsPlayback(input: {
  readonly clips: readonly TimelineClip[];
  readonly playbackSpeed: number;
  readonly playheadPosition: number;
  readonly getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  readonly getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
}): Promise<number> {
  if (
    input.playbackSpeed >= 0 &&
    !input.clips.some((clip) =>
      clip.reversed === true || hasNegativeTransitionSourceRateAtTime(clip, input.playheadPosition)
    )
  ) {
    return Promise.resolve(0);
  }
  return loadReverseWorkerRuntimeModule()
    .then(({ primeReverseWorkerRuntimeSourcesForPlayback }) => {
      return primeReverseWorkerRuntimeSourcesForPlayback({
        clips: input.clips,
        playheadPosition: input.playheadPosition,
        playbackSpeed: input.playbackSpeed,
        getSourceTimeForClip: input.getSourceTimeForClip,
        getInterpolatedSpeed: input.getInterpolatedSpeed,
      });
    })
    .catch(() => {
      reverseWorkerRuntimeModulePromise = null;
      return 0;
    });
}

export function preparePlaybackStartWarmup(input: {
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly playbackSpeed: number;
  readonly playheadPosition: number;
  readonly getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  readonly getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
}): {
  readonly videosToCheck: readonly PlaybackWarmupVideo[];
  readonly hasWorkerGpuStartVideo: boolean;
  readonly reverseWorkerPrimeReady: Promise<number>;
} {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(input.tracks);
  const visibleClipsAtPlaybackStart = input.clips.filter(clip => {
    if (!visibleVideoTrackIds.has(clip.trackId)) return false;
    return input.playheadPosition >= clip.startTime &&
      input.playheadPosition < clip.startTime + clip.duration;
  });
  const clipsAtPlayhead = visibleClipsAtPlaybackStart.filter(
    clip => getTimelinePlaybackWarmupVideo(clip.source) !== null,
  );
  const transitionWarmupClipsAtPlayhead = getTransitionWarmupClipsAtTime(
    input.clips,
    visibleVideoTrackIds,
    input.playheadPosition,
  );
  const transitionClipsAtPlayhead = transitionWarmupClipsAtPlayhead.filter(
    clip => getTimelinePlaybackWarmupVideo(clip.source) !== null,
  );
  const hasTopLevelWorkerGpuStartVideo = [
    ...visibleClipsAtPlaybackStart,
    ...transitionWarmupClipsAtPlayhead,
  ].some(hasWorkerGpuPlaybackStartVideoSource);
  const reverseWorkerPrimeReady = primeReverseWorkerWebCodecsPlayback({
    clips: [...clipsAtPlayhead, ...transitionClipsAtPlayhead],
    playbackSpeed: input.playbackSpeed,
    playheadPosition: input.playheadPosition,
    getSourceTimeForClip: input.getSourceTimeForClip,
    getInterpolatedSpeed: input.getInterpolatedSpeed,
  });
  const warmupVideos = new Map<HTMLVideoElement, PlaybackWarmupVideo>();
  const rememberWarmupVideo = (video: HTMLVideoElement, targetTime?: number) => {
    const existing = warmupVideos.get(video);
    if (!existing || targetTime !== undefined) {
      warmupVideos.set(video, targetTime === undefined ? { video } : { video, targetTime });
    }
  };

  for (const clip of [...clipsAtPlayhead, ...transitionClipsAtPlayhead]) {
    const video = getTimelinePlaybackWarmupVideo(clip.source);
    if (video) {
      rememberWarmupVideo(
        video,
        getPlaybackWarmupTargetTime(
          clip,
          input.playheadPosition,
          input.getSourceTimeForClip,
          input.getInterpolatedSpeed,
        ),
      );
    }
  }

  for (const clip of input.clips) {
    if (clip.isComposition && clip.nestedClips && visibleVideoTrackIds.has(clip.trackId)) {
      const isAtPlayhead = input.playheadPosition >= clip.startTime &&
        input.playheadPosition < clip.startTime + clip.duration;
      if (isAtPlayhead) {
        const compLocalTime = input.playheadPosition - clip.startTime;
        const mappedCompTime = resolveTransitionSourceMapTime(clip.transitionSourceMap, compLocalTime);
        const compTime = mappedCompTime?.sourceTime ?? compLocalTime + clip.inPoint;
        for (const nestedClip of clip.nestedClips) {
          const warmupVideo = getTimelinePlaybackWarmupVideo(nestedClip.source);
          if (warmupVideo) {
            const isNestedAtTime = compTime >= nestedClip.startTime &&
              compTime < nestedClip.startTime + nestedClip.duration;
            if (isNestedAtTime) {
              const timing = getNestedClipSourceTiming(
                nestedClip,
                compTime - nestedClip.startTime,
              );
              rememberWarmupVideo(warmupVideo, timing.sourceTime);
            }
          }
        }
      }
    }
  }

  return {
    videosToCheck: [...warmupVideos.values()],
    hasWorkerGpuStartVideo: hasTopLevelWorkerGpuStartVideo ||
      [...warmupVideos.values()].some(entry => entry.targetTime !== undefined),
    reverseWorkerPrimeReady,
  };
}

export function primeReverseWorkerWebCodecsPlaybackForState(input: {
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly playbackSpeed: number;
  readonly playheadPosition: number;
  readonly getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  readonly getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
}): Promise<number> {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(input.tracks);
  const primeTimes = input.playbackSpeed < 0
    ? [input.playheadPosition, input.playheadPosition - 0.35, input.playheadPosition - 0.75]
    : [input.playheadPosition];
  const clipsById = new Map<string, TimelineClip>();
  for (const time of primeTimes) {
    for (const clip of getReversePrimeClipsAtTime(input.clips, visibleVideoTrackIds, time)) {
      clipsById.set(clip.id, clip);
    }
  }
  return primeReverseWorkerWebCodecsPlayback({
    clips: [...clipsById.values()],
    playbackSpeed: input.playbackSpeed,
    playheadPosition: input.playheadPosition,
    getSourceTimeForClip: input.getSourceTimeForClip,
    getInterpolatedSpeed: input.getInterpolatedSpeed,
  });
}
