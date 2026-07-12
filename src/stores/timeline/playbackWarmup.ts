import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { getTimelinePlaybackWarmupVideo } from '../../services/timeline/timelinePlaybackWarmupRuntime';
import { hasWorkerGpuPlaybackStartVideoSource } from '../../services/timeline/workerGpuPlaybackStartWarmup';
import { resolveTransitionSourceMapTime } from '../../services/timeline/transitionSourceMap';
import { createTimelineTransitionMediaDurationResolver } from '../../services/timeline/timelineTransitionMediaDurations';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from './editOperations/transitionPlanner';
import type { PlaybackWarmupState } from './storeTypes/feedbackTypes';

type ReverseWorkerRuntimeModule = typeof import('../../services/layerBuilder/reverseWorkerWebCodecsRuntime');

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
  readonly videosToCheck: readonly HTMLVideoElement[];
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
  const nestedVideos: HTMLVideoElement[] = [];

  for (const clip of input.clips) {
    if (clip.isComposition && clip.nestedClips && visibleVideoTrackIds.has(clip.trackId)) {
      const isAtPlayhead = input.playheadPosition >= clip.startTime &&
        input.playheadPosition < clip.startTime + clip.duration;
      if (isAtPlayhead) {
        const compTime = input.playheadPosition - clip.startTime + clip.inPoint;
        for (const nestedClip of clip.nestedClips) {
          const warmupVideo = getTimelinePlaybackWarmupVideo(nestedClip.source);
          if (warmupVideo) {
            const isNestedAtTime = compTime >= nestedClip.startTime &&
              compTime < nestedClip.startTime + nestedClip.duration;
            if (isNestedAtTime) {
              nestedVideos.push(warmupVideo);
            }
          }
        }
      }
    }
  }

  return {
    videosToCheck: Array.from(new Set([
      ...clipsAtPlayhead.flatMap((clip) => {
        const warmupVideo = getTimelinePlaybackWarmupVideo(clip.source);
        return warmupVideo ? [warmupVideo] : [];
      }),
      ...transitionClipsAtPlayhead.flatMap((clip) => {
        const warmupVideo = getTimelinePlaybackWarmupVideo(clip.source);
        return warmupVideo ? [warmupVideo] : [];
      }),
      ...nestedVideos,
    ])),
    hasWorkerGpuStartVideo: hasTopLevelWorkerGpuStartVideo || nestedVideos.length > 0,
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
