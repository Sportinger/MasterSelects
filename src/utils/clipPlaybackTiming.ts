import type { TimelineClip } from '../types/timeline';

const MIN_TIMING_RATE = 0.0001;

export interface ClipPlaybackTimingWindow extends Pick<
  TimelineClip,
  'duration' | 'inPoint' | 'outPoint'
> {
  speed?: number;
}

/**
 * Returns how many source seconds the clip consumes per timeline second.
 *
 * The source-window/timeline-duration ratio is authoritative because it also
 * preserves the effective timing of clips whose duration was produced by a
 * speed ramp. The static speed is only a fallback for incomplete legacy data.
 */
export function getClipSourceRate(window: ClipPlaybackTimingWindow): number {
  const sourceDuration = Math.abs(window.outPoint - window.inPoint);
  const timelineDuration = Math.abs(window.duration);
  if (
    Number.isFinite(sourceDuration) &&
    Number.isFinite(timelineDuration) &&
    sourceDuration > MIN_TIMING_RATE &&
    timelineDuration > MIN_TIMING_RATE
  ) {
    return sourceDuration / timelineDuration;
  }

  const speed = Math.abs(window.speed ?? 1);
  return Number.isFinite(speed) && speed > MIN_TIMING_RATE ? speed : 1;
}

export function timelineDeltaToSourceDelta(
  window: ClipPlaybackTimingWindow,
  timelineDelta: number,
): number {
  return timelineDelta * getClipSourceRate(window);
}

export function getTimelineDurationForSourceWindow(
  window: ClipPlaybackTimingWindow,
  inPoint: number,
  outPoint: number,
): number {
  return (outPoint - inPoint) / getClipSourceRate(window);
}
