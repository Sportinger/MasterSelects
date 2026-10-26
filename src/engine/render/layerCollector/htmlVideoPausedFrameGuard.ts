import { SCRUB_CACHE_FPS } from '../../texture/scrubbingCache/cacheKeys';
import { getVideoSourceFrameRate } from '../../../services/videoSourceFrameRate';

// A paused preview shows the target's own frame only: frame k covers [k/fps, (k+1)/fps). Held and
// cached frames are judged by frame index, never by a distance that also admits a neighbour (a full
// 1/30 s back used to pass the previous frame off as the target's). A label may start up to 2 % of a
// frame early: cached frames report their 3-decimal slot key, WebM timestamps are whole milliseconds.
const LABEL_FRAME_EPSILON = 0.02;
const TARGET_FRAME_EPSILON = 1e-6;

export function shouldGuardPausedHtmlTargetFrames(options: {
  isPlaying: boolean;
  isDragging: boolean;
  isExporting?: boolean;
}): boolean {
  return !options.isPlaying && !options.isDragging && !options.isExporting;
}

/**
 * The frame grid a paused HTML frame is judged on: the source's own frames, but never finer than
 * the scrub cache's 1/30 s slots, whose entries carry only their slot start.
 */
export function pausedHtmlTargetFrameRate(video?: object | null): number {
  const sourceFps = getVideoSourceFrameRate(video);
  return sourceFps ? Math.min(sourceFps, SCRUB_CACHE_FPS) : SCRUB_CACHE_FPS;
}

export function isPausedHtmlTargetFrameUsable(
  frame: { mediaTime?: number } | null | undefined,
  targetTime: number,
  frameRate: number = SCRUB_CACHE_FPS
): boolean {
  const mediaTime = frame?.mediaTime;
  if (typeof mediaTime !== 'number' || !Number.isFinite(mediaTime) || !Number.isFinite(targetTime)) {
    return false;
  }
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : SCRUB_CACHE_FPS;
  return Math.floor(mediaTime * fps + LABEL_FRAME_EPSILON) === Math.floor(targetTime * fps + TARGET_FRAME_EPSILON);
}

export function isPausedHtmlTargetMediaTimeUsable(
  mediaTime: number | undefined,
  targetTime: number,
  frameRate?: number
): boolean {
  return isPausedHtmlTargetFrameUsable(
    typeof mediaTime === 'number' ? { mediaTime } : null,
    targetTime,
    frameRate
  );
}

export function filterPausedHtmlTargetFrame<T extends { mediaTime?: number } | null | undefined>(
  frame: T,
  targetTime: number,
  shouldGuard: boolean,
  frameRate?: number
): T | null {
  if (!shouldGuard || isPausedHtmlTargetFrameUsable(frame, targetTime, frameRate)) {
    return frame ?? null;
  }
  return null;
}
