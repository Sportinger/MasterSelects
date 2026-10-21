import type { Keyframe, AnimatableProperty } from '../types';
import { interpolateKeyframes } from './keyframeInterpolation';

/**
 * Speed Integration Utility
 *
 * For variable speed playback with keyframes, we need to INTEGRATE the speed curve
 * to calculate the source time. This is different from normal interpolation.
 *
 * Example: If speed is 2x from t=0 to t=1, and 0.5x from t=1 to t=2:
 * - At timeline t=1: sourceTime = 1 * 2 = 2 seconds
 * - At timeline t=2: sourceTime = 2 + 1 * 0.5 = 2.5 seconds
 *
 * For keyframed speed, we use trapezoidal integration for smooth results.
 */

/**
 * Calculate the source time for a given timeline local time by integrating the speed curve.
 *
 * @param keyframes - All keyframes for the clip
 * @param clipLocalTime - Time within the clip (0 to clip.duration)
 * @param defaultSpeed - Default speed if no keyframes (usually clip.speed ?? 1)
 * @returns The source time to seek to
 */
export function calculateSourceTime(
  keyframes: Keyframe[],
  clipLocalTime: number,
  defaultSpeed: number
): number {
  // Filter speed keyframes and sort by time
  const speedKeyframes = keyframes
    .filter(k => k.property === 'speed')
    .sort((a, b) => a.time - b.time);

  // No speed keyframes - simple multiplication
  if (speedKeyframes.length === 0) {
    return clipLocalTime * defaultSpeed;
  }

  // Single keyframe - use that constant speed
  if (speedKeyframes.length === 1) {
    return clipLocalTime * speedKeyframes[0].value;
  }

  // Multiple keyframes - integrate using trapezoidal rule
  return integrateSpeedCurve(keyframes, speedKeyframes, clipLocalTime, defaultSpeed);
}

/**
 * Get the interpolated speed at a specific time.
 * Uses the same interpolation as other keyframed properties.
 */
export function getSpeedAtTime(
  keyframes: Keyframe[],
  clipLocalTime: number,
  defaultSpeed: number
): number {
  return interpolateKeyframes(keyframes, 'speed' as AnimatableProperty, clipLocalTime, defaultSpeed);
}

/**
 * Integrate the speed curve from 0 to endTime (see integrateKeyframedRate).
 */
function integrateSpeedCurve(
  keyframes: Keyframe[],
  speedKeyframes: Keyframe[],
  endTime: number,
  defaultSpeed: number
): number {
  return integrateRateSamples(keyframes, speedKeyframes, 'speed' as AnimatableProperty, endTime, defaultSpeed);
}

/**
 * Area under any keyframed rate curve (value per second) from 0 to `endTime`: the distance a
 * keyframed Speed or Spin has travelled. Used for clip speed and for effect rate parameters
 * (EffectParam.integratedAs), so a keyed ramp moves continuously instead of jumping.
 */
export function integrateKeyframedRate(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  endTime: number,
  defaultValue: number,
): number {
  const rateKeyframes = keyframes.filter(k => k.property === property).sort((a, b) => a.time - b.time);
  if (rateKeyframes.length === 0) return endTime * defaultValue;
  if (rateKeyframes.length === 1) return endTime * rateKeyframes[0].value;
  return integrateRateSamples(keyframes, rateKeyframes, property, endTime, defaultValue);
}

/**
 * Adaptive trapezoidal integration of a keyframed curve from 0 to endTime:
 * 1. Sample the curve at keyframe times and ten intermediate points per segment
 *    (more accurate for bezier curves)
 * 2. Trapezoidal rule: integral = sum of (value_i + value_{i+1}) / 2 * dt; a hold keyframe stays flat
 */
function integrateRateSamples(
  keyframes: Keyframe[],
  rateKeyframes: Keyframe[],
  property: AnimatableProperty,
  endTime: number,
  defaultValue: number
): number {
  // Edge cases
  if (!(endTime > 0)) return 0;

  // Collect all sample points (keyframe times + intermediate samples)
  const samplePoints: number[] = [0];
  for (const kf of rateKeyframes) {
    if (kf.time > 0 && kf.time < endTime) {
      samplePoints.push(kf.time);
    }
  }
  samplePoints.push(endTime);

  const samplesPerSegment = 10;
  const allSamplePoints: number[] = [];
  for (let i = 0; i < samplePoints.length - 1; i++) {
    const start = samplePoints[i];
    const end = samplePoints[i + 1];
    const dt = (end - start) / samplesPerSegment;
    for (let j = 0; j < samplesPerSegment; j++) {
      allSamplePoints.push(start + j * dt);
    }
  }
  allSamplePoints.push(endTime);

  // Remove duplicates and sort
  const uniqueSamples = [...new Set(allSamplePoints)].sort((a, b) => a - b);

  let integral = 0;
  for (let i = 0; i < uniqueSamples.length - 1; i++) {
    const t0 = uniqueSamples[i];
    const t1 = uniqueSamples[i + 1];
    const value0 = interpolateKeyframes(keyframes, property, t0, defaultValue);
    const segment = rateKeyframes.findLast(key => key.time <= t0);
    const value1 = segment?.hold ? value0 : interpolateKeyframes(keyframes, property, t1, defaultValue);
    // Trapezoidal rule: area = (y0 + y1) / 2 * width
    integral += (value0 + value1) / 2 * (t1 - t0);
  }
  return integral;
}

/**
 * Calculate the total source time that will be consumed by a clip with speed keyframes.
 * This is useful for determining if the clip will run out of source material.
 *
 * @param keyframes - All keyframes for the clip
 * @param timelineDuration - The timeline duration of the clip
 * @param defaultSpeed - Default speed
 * @returns Total source time consumed
 */
export function calculateTotalSourceTime(
  keyframes: Keyframe[],
  timelineDuration: number,
  defaultSpeed: number
): number {
  return calculateSourceTime(keyframes, timelineDuration, defaultSpeed);
}

/**
 * Calculate the timeline duration needed to play through a given source duration
 * with the specified speed keyframes. This is the inverse of calculateSourceTime.
 *
 * Uses binary search since the integral is monotonic (assuming positive speeds).
 * For negative speeds, we use absolute values since duration is always positive.
 *
 * @param keyframes - All keyframes for the clip
 * @param sourceDuration - The source duration to consume
 * @param defaultSpeed - Default speed
 * @param maxIterations - Maximum binary search iterations
 * @returns Timeline duration needed
 */
export function calculateTimelineDuration(
  keyframes: Keyframe[],
  sourceDuration: number,
  defaultSpeed: number,
  maxIterations: number = 50
): number {
  // Handle edge cases
  if (sourceDuration <= 0) return 0;

  const speedKeyframes = keyframes
    .filter(k => k.property === 'speed')
    .sort((a, b) => a.time - b.time);

  // No keyframes - simple division using absolute speed
  if (speedKeyframes.length === 0) {
    const absSpeed = Math.abs(defaultSpeed);
    return absSpeed > 0.001 ? sourceDuration / absSpeed : sourceDuration * 1000; // Cap at 1000x duration
  }

  // For keyframes, use binary search with absolute source time
  // (negative speed means reverse, but duration is still positive)
  let low = 0;
  let high = sourceDuration * 20; // Generous upper bound

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const sourceTimeAtMid = Math.abs(calculateSourceTime(keyframes, mid, defaultSpeed));

    if (Math.abs(sourceTimeAtMid - sourceDuration) < 0.001) {
      return mid;
    }

    if (sourceTimeAtMid < sourceDuration) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

/**
 * Check if speed keyframes result in reverse playback at any point.
 * Useful for determining if we need special handling for reverse.
 */
export function hasReverseSpeed(keyframes: Keyframe[], defaultSpeed: number): boolean {
  const speedKeyframes = keyframes.filter(k => k.property === 'speed');

  if (speedKeyframes.length === 0) {
    return defaultSpeed < 0;
  }

  return speedKeyframes.some(k => k.value < 0);
}

/**
 * Get the maximum absolute speed in the keyframe curve.
 * Useful for determining buffer requirements.
 */
export function getMaxSpeed(keyframes: Keyframe[], defaultSpeed: number): number {
  const speedKeyframes = keyframes.filter(k => k.property === 'speed');

  if (speedKeyframes.length === 0) {
    return Math.abs(defaultSpeed);
  }

  let maxSpeed = Math.abs(defaultSpeed);
  for (const kf of speedKeyframes) {
    maxSpeed = Math.max(maxSpeed, Math.abs(kf.value));
  }

  return maxSpeed;
}
