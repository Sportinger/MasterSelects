import type { TimelineClip } from '../../../types/timeline';
import type { FlockProgram } from '../compiler/flockProgramTypes';

/**
 * FlockTimeMapper — the single mapping from composition/clip time to flock
 * simulation source time, shared by preview, nested rendering, thumbnails,
 * export and keyframe authoring.
 *
 * Clip playback semantics (in/out, speed keyframes, reverse, transition source
 * maps) are resolved by the existing clip timing path (getClipTimeInfo /
 * getClipSourceWindowTime). This module adds the flock-specific parts: loop
 * reset, fixed-step sampling, and the inverse map for source-time keyframes.
 */

export interface FlockStepSample {
  /** Completed step whose state is at or before the requested time. */
  step: number;
  /** Interpolation factor toward step + 1. */
  alpha: number;
  /** Source time after loop mapping. */
  sourceTime: number;
}

export function applyFlockLoop(program: Pick<FlockProgram, 'loopSeconds'>, sourceTime: number): number {
  const time = Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : 0;
  if (program.loopSeconds > 0) {
    return time % program.loopSeconds;
  }
  return time;
}

export function flockStepForSourceTime(
  program: Pick<FlockProgram, 'loopSeconds' | 'stepRate' | 'simulation'>,
  sourceTime: number,
): FlockStepSample {
  const mapped = applyFlockLoop(program, sourceTime);
  const exact = mapped * program.stepRate + program.simulation.warmupSteps;
  const step = Math.floor(exact + 1e-7);
  return { step, alpha: Math.min(1, Math.max(0, exact - step)), sourceTime: mapped };
}

/** Nested clips have no timeline FrameContext; mirror the model/splat nested mapping. */
export function nestedFlockSourceTime(clip: Pick<TimelineClip, 'reversed' | 'inPoint' | 'outPoint'>, clipLocalTime: number): number {
  return clip.reversed ? clip.outPoint - clipLocalTime : clipLocalTime + clip.inPoint;
}

export interface FlockClipTimeMap {
  toSourceTime(clipLocalTime: number): number;
  /** Inverse map. Returns null when the source time is never shown by this clip's monotonic map. */
  toClipLocalTime(sourceTime: number): number | null;
}

/**
 * Builds a monotonic clip-local <-> source-time map from the clip's own source
 * offset function (speed keyframes / reverse). Positive speed curves and an
 * explicit reverse direction are supported; flat or non-monotonic maps return
 * null from the inverse so ambiguous conversions fail visibly.
 */
export function createFlockClipTimeMap(
  clip: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>,
  sourceOffsetAt?: (clipLocalTime: number) => number,
): FlockClipTimeMap {
  const speed = clip.speed ?? 1;
  // Negative speed carries its own direction (offsets are signed from outPoint);
  // the `reversed` flag mirrors the result inside the in/out window.
  const startPoint = speed < 0 ? clip.outPoint : clip.inPoint;
  const offsetAt = sourceOffsetAt ?? ((local: number) => local * speed);
  const mirror = (value: number) => (clip.reversed === true ? clip.inPoint + clip.outPoint - value : value);
  const inside = (clipLocalTime: number) => mirror(startPoint + offsetAt(clipLocalTime));

  const toSourceTime = (clipLocalTime: number): number => {
    const epsilon = Math.min(Math.max(clip.duration, 1e-6), 1e-3);
    if (clipLocalTime < 0) {
      const edge = inside(0);
      const slope = (inside(epsilon) - edge) / epsilon;
      return edge + slope * clipLocalTime;
    }
    if (clipLocalTime > clip.duration) {
      const end = inside(clip.duration);
      const slope = (end - inside(Math.max(0, clip.duration - epsilon))) / epsilon;
      return end + slope * (clipLocalTime - clip.duration);
    }
    return inside(clipLocalTime);
  };

  const toClipLocalTime = (sourceTime: number): number | null => {
    const a = toSourceTime(0);
    const b = toSourceTime(clip.duration);
    if (Math.abs(b - a) < 1e-9) return null;
    const increasing = b > a;
    // Extrapolate outside the visible window with the edge slope.
    const lowSource = increasing ? a : b;
    const highSource = increasing ? b : a;
    let lo = -1e6;
    let hi = clip.duration + 1e6;
    if (sourceTime >= lowSource && sourceTime <= highSource) {
      lo = 0;
      hi = clip.duration;
    }
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const mid = (lo + hi) / 2;
      const value = toSourceTime(mid);
      if ((value < sourceTime) === increasing) lo = mid; else hi = mid;
    }
    const result = (lo + hi) / 2;
    return Math.abs(toSourceTime(result) - sourceTime) < 1e-4 ? result : null;
  };

  return { toSourceTime, toClipLocalTime };
}
