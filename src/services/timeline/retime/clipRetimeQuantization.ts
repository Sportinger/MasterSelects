import type { ClipTimeRemap } from '../../../types/timeline';
import { quantizeClipStartTime, quantizeFrameLockedClipTiming, quantizeTimeToFrame,
  sanitizeTimelineFrameRate } from '../../../utils/timelineFrameQuantization';

export { quantizeTimeToFrame } from '../../../utils/timelineFrameQuantization';
type RetimeFrameClip = Parameters<typeof quantizeFrameLockedClipTiming>[0] & { timeRemap?: ClipTimeRemap };

/** Freeze/Loop output grids cannot be reconstructed from their retained source windows.
 * Used at both the edit and project hydration boundaries, including linked audio.
 */
export function quantizeRetimeClipTiming<T extends RetimeFrameClip>(clip: T, frameRate?: number | null): T {
  if (clip.timeRemap?.kind !== 'freeze' && clip.timeRemap?.kind !== 'loop' && clip.timeRemap?.kind !== 'warp') return quantizeFrameLockedClipTiming(clip, frameRate);
  const fps = sanitizeTimelineFrameRate(frameRate);
  const duration = Math.max(1 / fps, quantizeTimeToFrame(clip.duration, fps));
  const startTime = quantizeClipStartTime(clip, clip.startTime, fps);
  return duration === clip.duration && startTime === clip.startTime ? clip : { ...clip, duration, startTime };
}

export function quantizeRetimeClipTimings<T extends RetimeFrameClip>(clips: readonly T[], frameRate?: number | null): T[] {
  return clips.map(clip => quantizeRetimeClipTiming(clip, frameRate));
}
