const PAUSED_TARGET_BACKWARD_TOLERANCE_SECONDS = 1 / 60;
const PAUSED_TARGET_FORWARD_TOLERANCE_SECONDS = 0.05;

export function shouldGuardPausedHtmlTargetFrames(options: {
  isPlaying: boolean;
  isDragging: boolean;
  isExporting?: boolean;
}): boolean {
  return !options.isPlaying && !options.isDragging && !options.isExporting;
}

export function isPausedHtmlTargetFrameUsable(
  frame: { mediaTime?: number } | null | undefined,
  targetTime: number
): boolean {
  const mediaTime = frame?.mediaTime;
  if (typeof mediaTime !== 'number' || !Number.isFinite(mediaTime)) {
    return false;
  }

  return mediaTime >= targetTime - PAUSED_TARGET_BACKWARD_TOLERANCE_SECONDS &&
    mediaTime <= targetTime + PAUSED_TARGET_FORWARD_TOLERANCE_SECONDS;
}

export function isPausedHtmlTargetMediaTimeUsable(
  mediaTime: number | undefined,
  targetTime: number
): boolean {
  return isPausedHtmlTargetFrameUsable(
    typeof mediaTime === 'number' ? { mediaTime } : null,
    targetTime
  );
}

export function filterPausedHtmlTargetFrame<T extends { mediaTime?: number } | null | undefined>(
  frame: T,
  targetTime: number,
  shouldGuard: boolean
): T | null {
  if (!shouldGuard || isPausedHtmlTargetFrameUsable(frame, targetTime)) {
    return frame ?? null;
  }
  return null;
}
