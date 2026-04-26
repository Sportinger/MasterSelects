// Video seeking and ready-state management for export

import { Logger } from '../../services/logger';
import type { ExportClipState, FrameContext } from './types';
import { updateRuntimePlaybackTime } from '../../services/mediaRuntime/runtimePlayback';

const log = Logger.create('VideoSeeker');
import { ParallelDecodeManager } from '../ParallelDecodeManager';

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: () => void) => number;
};

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
    parallelDecoder.advanceToTime(time);
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

async function seekSequentialMode(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>
): Promise<void> {
  const { time, clipsAtTime, trackMap, getSourceTimeForClip, getInterpolatedSpeed } = ctx;
  const seekPromises: Promise<void>[] = [];

  for (const clip of clipsAtTime) {
    const track = trackMap.get(clip.trackId);
    if (!track?.visible) continue;

    // Handle nested composition clips
    if (clip.isComposition && clip.nestedClips && clip.nestedTracks) {
      const clipLocalTime = time - clip.startTime;
      const nestedTime = clipLocalTime + (clip.inPoint || 0);

      for (const nestedClip of clip.nestedClips) {
        if (nestedTime >= nestedClip.startTime && nestedTime < nestedClip.startTime + nestedClip.duration) {
          const nestedVideo = getExportVideoElement(
            nestedClip.id,
            clipStates,
            nestedClip.source?.videoElement
          );
          if (nestedVideo) {
            const nestedLocalTime = nestedTime - nestedClip.startTime;
            const nestedSpeed = nestedClip.speed ?? 1;
            const speedAdjusted = nestedLocalTime * Math.abs(nestedSpeed);
            const nestedClipTime = (nestedClip.reversed !== (nestedSpeed < 0))
              ? nestedClip.outPoint - speedAdjusted
              : nestedClip.inPoint + speedAdjusted;
            const nestedState = clipStates.get(nestedClip.id);
            seekPromises.push(seekVideo(nestedVideo, nestedClipTime).then(() => {
              updateRuntimePlaybackTime(nestedState?.runtimeSource, nestedClipTime, 'export');
            }));
          }
        }
      }
      continue;
    }

    // Handle regular video clips
    const exportVideo = clip.source?.type === 'video'
      ? getExportVideoElement(clip.id, clipStates, clip.source.videoElement)
      : null;
    if (clip.source?.type === 'video' && exportVideo) {
      const clipLocalTime = time - clip.startTime;

      // Calculate clip time (handles speed keyframes and reversed clips)
      let clipTime: number;
      try {
        const sourceTime = getSourceTimeForClip(clip.id, clipLocalTime);
        const initialSpeed = getInterpolatedSpeed(clip.id, 0);
        const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
        clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
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
      } else {
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
  const { clipsAtTime, trackMap } = ctx;

  const videoClips = clipsAtTime.filter(clip => {
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
