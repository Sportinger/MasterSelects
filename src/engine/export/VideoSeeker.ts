// Video seeking and ready-state management for export

import { Logger } from '../../services/logger';
import type { ExportClipState, FrameContext } from './types';
import type { TimelineClip } from '../../stores/timeline/types';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { MAX_NESTING_DEPTH } from '../../stores/timeline/constants';
import { updateRuntimePlaybackTime } from '../../services/mediaRuntime/runtimePlayback';
import { getClipSourceWindowTime, getMappedClipSourceTime } from './layerBuilder/timing';

const log = Logger.create('VideoSeeker');
import { ParallelDecodeManager } from '../ParallelDecodeManager';

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
};

interface VideoSeekTarget {
  clip: TimelineClip;
  sourceTime: number;
}

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

/**
 * Seek all clips to the specified time for frame export.
 * Uses FrameContext for O(1) lookups instead of repeated getState() calls.
 */
export async function seekAllClipsToTime(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean
): Promise<void> {
  const { time } = ctx;

  // PARALLEL DECODE MODE - no HTMLVideoElement seeking needed!
  // ParallelDecoder provides VideoFrames directly, much faster than seeking videos
  if (useParallelDecode && parallelDecoder) {
    await parallelDecoder.prefetchFramesForTime(time);
    const transitionTargets = (ctx.transitionParticipantsByTrack?.size ?? 0) > 0
      ? getRenderableClips(ctx)
        .filter((clip) => {
          const track = ctx.trackMap.get(clip.trackId);
          return track?.visible && clip.source?.type === 'video';
        })
        .map((clip) => {
          const clipLocalTime = time - clip.startTime;
          return { clip, sourceTime: getClipSourceWindowTime(clip, clipLocalTime, ctx) };
        })
      : [];
    const mappedTargets = getMappedVideoSeekTargets(ctx);

    if (mappedTargets.length > 0) {
      parallelDecoder.advanceToTime(time);
    }
    const targetsByClipId = new Map<string, VideoSeekTarget>();
    for (const target of [...transitionTargets, ...mappedTargets]) {
      targetsByClipId.set(target.clip.id, target);
    }
    await Promise.all([...targetsByClipId.values()].map(({ clip, sourceTime }) =>
      parallelDecoder.prefetchFrameForClipSourceTime(clip.id, sourceTime)
    ));
    if (mappedTargets.length === 0) {
      parallelDecoder.advanceToTime(time);
    }
    return;
  }

  // SEQUENTIAL MODE (single clip only)
  await seekSequentialMode(ctx, clipStates);
}

function getExportVideoElement(
  clipId: string,
  clipStates: Map<string, ExportClipState>,
  fallbackVideo: HTMLVideoElement | undefined
): HTMLVideoElement | null {
  return clipStates.get(clipId)?.preciseVideoElement ?? fallbackVideo ?? null;
}

function getRenderableClips(ctx: FrameContext): TimelineClip[] {
  return ctx.renderClipsAtTime ?? ctx.clipsAtTime;
}

function getNestedVideoClipTime(clip: TimelineClip, nestedTime: number): number {
  const nestedLocalTime = nestedTime - clip.startTime;
  const mappedSourceTime = getMappedClipSourceTime(clip, nestedLocalTime);
  if (mappedSourceTime !== undefined) return mappedSourceTime;

  if (Number.isFinite(clip.transitionSourceTimeOverride)) {
    return clip.transitionSourceTimeOverride!;
  }
  if (clip.transitionSourceHold) return clip.inPoint ?? 0;
  return clip.reversed
    ? (clip.outPoint ?? clip.duration) - nestedLocalTime
    : nestedLocalTime + (clip.inPoint ?? 0);
}

function getRenderableNestedClips(clip: TimelineClip, nestedTime: number): TimelineClip[] {
  if (!clip.nestedClips || !clip.nestedTracks) return [];

  const renderable: TimelineClip[] = [];
  for (const track of clip.nestedTracks) {
    if (track.type !== 'video' || track.visible === false) continue;
    const transition = findActiveTransitionPlanForTrack({
      clips: clip.nestedClips,
      trackId: track.id,
      time: nestedTime,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
    });
    if (transition) {
      renderable.push(
        createTransitionSourceClip(transition.outgoingClip, transition.plan.outgoing, nestedTime),
        createTransitionSourceClip(transition.incomingClip, transition.plan.incoming, nestedTime),
      );
      continue;
    }

    const nestedClip = clip.nestedClips.find(candidate =>
      candidate.trackId === track.id &&
      nestedTime >= candidate.startTime &&
      nestedTime < candidate.startTime + candidate.duration
    );
    if (nestedClip) renderable.push(nestedClip);
  }
  return renderable;
}

function getNestedCompositionTime(clip: TimelineClip, parentTime: number): {
  time: number;
  isMapped: boolean;
} {
  const clipLocalTime = parentTime - clip.startTime;
  const mappedSourceTime = getMappedClipSourceTime(clip, clipLocalTime);
  return {
    time: mappedSourceTime ?? clipLocalTime + (clip.inPoint || 0),
    isMapped: mappedSourceTime !== undefined,
  };
}

function collectNestedVideoSeekTargets(
  compositionClip: TimelineClip,
  parentTime: number,
  targets: VideoSeekTarget[],
  mappedAncestor = false,
  mappedOnly = false,
  depth = 0,
): void {
  if (depth >= MAX_NESTING_DEPTH) return;

  const { time: nestedTime, isMapped } = getNestedCompositionTime(compositionClip, parentTime);
  const requiresMappedSourceTime = mappedAncestor || isMapped;

  for (const nestedClip of getRenderableNestedClips(compositionClip, nestedTime)) {
    if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedTracks) {
      collectNestedVideoSeekTargets(
        nestedClip,
        nestedTime,
        targets,
        requiresMappedSourceTime,
        mappedOnly,
        depth + 1,
      );
      continue;
    }
    if (nestedClip.source?.type !== 'video') continue;

    const nestedLocalTime = nestedTime - nestedClip.startTime;
    const mappedSourceTime = getMappedClipSourceTime(nestedClip, nestedLocalTime);
    if (!mappedOnly || requiresMappedSourceTime || mappedSourceTime !== undefined) {
      targets.push({
        clip: nestedClip,
        sourceTime: mappedSourceTime ?? getNestedVideoClipTime(nestedClip, nestedTime),
      });
    }
  }
}

function getMappedVideoSeekTargets(ctx: FrameContext): VideoSeekTarget[] {
  const targets: VideoSeekTarget[] = [];

  for (const clip of getRenderableClips(ctx)) {
    const track = ctx.trackMap.get(clip.trackId);
    if (!track?.visible) continue;

    if (clip.isComposition && clip.nestedClips && clip.nestedTracks) {
      collectNestedVideoSeekTargets(clip, ctx.time, targets);
      continue;
    }
    if (clip.source?.type !== 'video') continue;

    const clipLocalTime = ctx.time - clip.startTime;
    const mappedSourceTime = getMappedClipSourceTime(clip, clipLocalTime);
    if (mappedSourceTime !== undefined) {
      targets.push({ clip, sourceTime: mappedSourceTime });
    }
  }

  return targets;
}

async function seekSequentialMode(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>
): Promise<void> {
  const { time, trackMap } = ctx;
  const seekPromises: Promise<void>[] = [];

  for (const clip of getRenderableClips(ctx)) {
    const track = trackMap.get(clip.trackId);
    if (!track?.visible) continue;

    // Handle nested composition clips
    if (clip.isComposition && clip.nestedClips && clip.nestedTracks) {
      const nestedTargets: VideoSeekTarget[] = [];
      collectNestedVideoSeekTargets(clip, time, nestedTargets);

      for (const { clip: nestedClip, sourceTime: nestedClipTime } of nestedTargets) {
        if (nestedClip.source?.type === 'video') {
          const nestedState = clipStates.get(nestedClip.id);

          if (nestedState?.isSequential && nestedState.webCodecsPlayer) {
            seekPromises.push(nestedState.webCodecsPlayer.seekDuringExport(nestedClipTime).then(() => {
              updateRuntimePlaybackTime(nestedState?.runtimeSource, nestedClipTime, 'export');
            }));
            continue;
          }

          const nestedVideo = getExportVideoElement(
            nestedClip.id,
            clipStates,
            nestedClip.source?.videoElement
          );
          if (nestedVideo) {
            seekPromises.push(seekVideo(nestedVideo, nestedClipTime).then(() => {
              updateRuntimePlaybackTime(nestedState?.runtimeSource, nestedClipTime, 'export');
            }));
          }
        }
      }
      continue;
    }

    // Handle regular video clips
    if (clip.source?.type === 'video') {
      const clipLocalTime = time - clip.startTime;

      // Calculate clip time (handles speed keyframes and reversed clips)
      let clipTime: number;
      try {
        clipTime = getClipSourceWindowTime(clip, clipLocalTime, ctx);
      } catch {
        clipTime = clip.reversed
          ? clip.outPoint - clipLocalTime
          : clipLocalTime + clip.inPoint;
        clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, clipTime));
      }

      const clipState = clipStates.get(clip.id);

      if (clipState?.isSequential && clipState.webCodecsPlayer) {
        // FAST MODE: WebCodecs sequential decoding
        seekPromises.push(clipState.webCodecsPlayer.seekDuringExport(clipTime).then(() => {
          updateRuntimePlaybackTime(clipState.runtimeSource, clipTime, 'export');
        }));
        continue;
      }

      const exportVideo = getExportVideoElement(clip.id, clipStates, clip.source.videoElement);
      if (exportVideo) {
        // PRECISE MODE: HTMLVideoElement seeking
        seekPromises.push(seekVideo(exportVideo, clipTime).then(() => {
          updateRuntimePlaybackTime(clipState?.runtimeSource, clipTime, 'export');
        }));
      }
    }
  }

  if (seekPromises.length > 0) {
    await Promise.all(seekPromises);
  }
}

/**
 * Seek a video element to a specific time with frame-accurate waiting.
 */
function waitForVideoCondition(
  video: HTMLVideoElement,
  events: Array<'loadedmetadata' | 'loadeddata' | 'canplay' | 'canplaythrough' | 'seeked' | 'error'>,
  timeoutMs: number,
  ready: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(ready());
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      for (const eventName of events) {
        video.removeEventListener(eventName, onEvent);
      }
    };

    const onEvent = () => {
      if (!ready()) {
        return;
      }
      cleanup();
      resolve(true);
    };

    for (const eventName of events) {
      video.addEventListener(eventName, onEvent);
    }
  });
}

async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (hasVideoFrameCallback(video)) {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve();
      }, 120);

      video.requestVideoFrameCallback(() => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      setTimeout(resolve, 16);
    }, 16);
  });
}

async function ensureVideoReadyForExport(video: HTMLVideoElement, targetTime: number): Promise<void> {
  if (!video.src && !video.currentSrc) {
    return;
  }

  if (video.readyState < 1) {
    try {
      video.load();
    } catch {
      // Ignore load() failures on detached elements.
    }
    await waitForVideoCondition(
      video,
      ['loadedmetadata', 'error'],
      4000,
      () => video.readyState >= 1
    );
  }

  if (video.readyState < 2 && !video.seeking) {
    await waitForVideoCondition(
      video,
      ['loadeddata', 'canplay', 'canplaythrough', 'seeked', 'error'],
      1200,
      () => !video.seeking && video.readyState >= 2
    );
  }

  if (video.readyState < 2 && !video.seeking && video.muted) {
    try {
      await Promise.race([
        video.play().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 120)),
      ]);
      video.pause();
    } catch {
      // Ignore autoplay / play-pause warmup failures.
    }

    if (Math.abs(video.currentTime - targetTime) > 0.01) {
      try {
        video.currentTime = targetTime;
      } catch {
        // Ignore re-seek failures after warmup attempt.
      }
    }
  }

  if (!video.seeking && video.readyState >= 2) {
    await waitForVideoFrame(video);
  }
}

export async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const maxSeekTime = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  const targetTime = duration > 0
    ? Math.max(0, Math.min(time, maxSeekTime))
    : Math.max(0, time);

  if (Math.abs(video.currentTime - targetTime) < 0.01 && !video.seeking) {
    await ensureVideoReadyForExport(video, targetTime);
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    const timeoutId = setTimeout(() => {
      log.warn(
        `Seek timeout at ${targetTime} (readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(3)}, seeking=${video.seeking})`
      );
      finish();
    }, 2000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onReady);
    };

    const onReady = () => {
      if (!video.seeking && video.readyState >= 2) {
        finish();
      }
    };

    const onSeeked = () => {
      finish();
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onReady);

    try {
      video.currentTime = targetTime;
    } catch {
      finish();
    }
  });

  await ensureVideoReadyForExport(video, targetTime);
}

/**
 * Wait for all video clips at a given time to have their frames ready.
 * Uses FrameContext for O(1) lookups.
 */
export async function waitForAllVideosReady(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>,
  _parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean
): Promise<void> {
  // PARALLEL DECODE MODE - frames are already ready from prefetchFramesForTime
  // No need to wait for HTMLVideoElement
  if (useParallelDecode) {
    return;
  }

  // SEQUENTIAL MODE - wait for WebCodecs player (not HTMLVideoElement)
  const { trackMap } = ctx;

  const videoClips = getRenderableClips(ctx).filter(clip => {
    const track = trackMap.get(clip.trackId);
    return track?.visible && clip.source?.type === 'video';
  });

  if (videoClips.length === 0) return;

  // Only wait for sequential WebCodecs clips
  for (const clip of videoClips) {
    const clipState = clipStates.get(clip.id);
    if (clipState?.isSequential && clipState.webCodecsPlayer) {
      // WebCodecs player handles its own frame readiness
      continue;
    }
  }
}
