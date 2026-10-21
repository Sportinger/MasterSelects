import type { Keyframe, AnimatableProperty } from '../types';
import { interpolateKeyframes } from './keyframeInterpolation';
import { keyframesForProperty } from './keyframePropertyIndex';

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
  return integrateKeyframedRate(keyframes, 'speed' as AnimatableProperty, clipLocalTime, defaultSpeed);
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
 * Area under any keyframed rate curve (value per second) from 0 to `endTime`: the distance a
 * keyframed Speed or Spin has travelled. Used for clip speed and for effect rate parameters
 * (EffectParam.integratedAs), so a keyed ramp moves continuously instead of jumping. Without keys
 * it is endTime × defaultValue, with one key endTime × its value; with more keys an `endTime` at or
 * before 0 gives 0 (playback never asks for it). Cost per call: O(log K) (see rateIntegralTable).
 */
export function integrateKeyframedRate(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  endTime: number,
  defaultValue: number,
): number {
  const keys = keyframesForProperty(keyframes, property);
  if (keys.length === 0) return endTime * defaultValue;
  if (keys.length === 1) return endTime * keys[0].value;
  if (!(endTime > 0)) return 0;
  const table = rateIntegralTable(keyframes, property, keys);
  return rateIntegralTo(keyframes, property, table, endTime) - rateIntegralTo(keyframes, property, table, 0);
}

/**
 * Signed area under a keyframed rate curve from `from` to `to` (either may be negative or lie
 * outside the keys): before the first key the curve holds the first key's value, after the last key
 * the last one's. Cost per call: O(log K).
 */
export function integrateKeyframedRateBetween(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  from: number,
  to: number,
  defaultValue: number,
): number {
  const keys = keyframesForProperty(keyframes, property);
  if (keys.length === 0) return (to - from) * defaultValue;
  if (keys.length === 1) return (to - from) * keys[0].value;
  const table = rateIntegralTable(keyframes, property, keys);
  return rateIntegralTo(keyframes, property, table, to) - rateIntegralTo(keyframes, property, table, from);
}

/**
 * Integration of a keyframed rate is a lookup into a table of cumulative segment integrals, built
 * once per keyframe array (timeline edits replace keyframe arrays and objects, as for
 * keyframesForProperty) and property. A query binary-searches its segment and integrates only the
 * partial last segment, so playback no longer integrates every segment from 0 on every frame.
 *
 * Each segment between two key times is sampled at SAMPLES_PER_SEGMENT equal steps with the
 * trapezoidal rule (exact for linear segments, accurate for eased and bezier ones); a hold key
 * stays flat until the next key.
 */
interface RateIntegralTable {
  readonly keys: readonly Keyframe[];
  /** cumulative[i] = area from keys[0].time to keys[i].time. */
  readonly cumulative: Float64Array;
}

const SAMPLES_PER_SEGMENT = 10;
const rateIntegralTables = new WeakMap<readonly Keyframe[], Map<AnimatableProperty, RateIntegralTable>>();

function rateIntegralTable(keyframes: Keyframe[], property: AnimatableProperty, keys: readonly Keyframe[]): RateIntegralTable {
  let byProperty = rateIntegralTables.get(keyframes);
  if (!byProperty) { byProperty = new Map(); rateIntegralTables.set(keyframes, byProperty); }
  let table = byProperty.get(property);
  if (!table) {
    const cumulative = new Float64Array(keys.length);
    for (let i = 1; i < keys.length; i++) {
      cumulative[i] = cumulative[i - 1] + segmentArea(keyframes, property, keys[i - 1], keys[i].time);
    }
    table = { keys, cumulative };
    byProperty.set(property, table);
  }
  return table;
}

/** Area from the first key's time to `time` (negative before it). */
function rateIntegralTo(keyframes: Keyframe[], property: AnimatableProperty, { keys, cumulative }: RateIntegralTable, time: number): number {
  const first = keys[0], last = keys.length - 1;
  if (time <= first.time) return (time - first.time) * first.value;
  if (time >= keys[last].time) return cumulative[last] + (time - keys[last].time) * keys[last].value;
  // The last key at or before `time`: with equal times the segment starts at the last of them.
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid].time <= time) lo = mid; else hi = mid;
  }
  return cumulative[lo] + segmentArea(keyframes, property, keys[lo], time);
}

/**
 * Area of the segment that starts at `segmentKey`, from its time to `end` (at most the next key).
 * The curve leaves a key at that key's value, so a second key at the same time is a jump, not a
 * ramp over the first sample step; a hold key stays flat.
 */
function segmentArea(keyframes: Keyframe[], property: AnimatableProperty, segmentKey: Keyframe, end: number): number {
  const start = segmentKey.time;
  if (!(end > start)) return 0;
  if (segmentKey.hold) return segmentKey.value * (end - start);
  const dt = (end - start) / SAMPLES_PER_SEGMENT;
  let area = 0;
  let t0 = start;
  let value0 = segmentKey.value;
  for (let step = 1; step <= SAMPLES_PER_SEGMENT; step++) {
    const t1 = step === SAMPLES_PER_SEGMENT ? end : start + step * dt;
    const value1 = interpolateKeyframes(keyframes, property, t1, segmentKey.value);
    area += (value0 + value1) / 2 * (t1 - t0);
    t0 = t1;
    value0 = value1;
  }
  return area;
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

  // No keyframes - simple division using absolute speed
  if (keyframesForProperty(keyframes, 'speed' as AnimatableProperty).length === 0) {
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
