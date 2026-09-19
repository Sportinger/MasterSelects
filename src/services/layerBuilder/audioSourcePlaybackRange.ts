import type { TimelineClip } from '../../types';

const AUDIO_SOURCE_END_EPSILON_SECONDS = 0.0001;

/**
 * A timeline clip can temporarily outlive its remaining source range after
 * trims, splits, or linked-clip edits. Audio at the clamped source end must be
 * treated as exhausted; restarting it would repeatedly re-elect a stationary
 * audio master clock and stall the timeline.
 */
export function hasRemainingForwardAudioSource(
  clip: TimelineClip,
  sourceTime: number,
): boolean {
  if (!Number.isFinite(sourceTime)) return false;
  if (!Number.isFinite(clip.outPoint)) return true;
  return sourceTime < clip.outPoint - AUDIO_SOURCE_END_EPSILON_SECONDS;
}
