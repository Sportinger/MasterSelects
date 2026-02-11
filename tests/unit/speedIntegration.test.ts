import { describe, it, expect } from 'vitest';
import {
  calculateSourceTime,
  getSpeedAtTime,
  calculateTimelineDuration,
  calculateTotalSourceTime,
  hasReverseSpeed,
  getMaxSpeed,
} from '../../src/utils/speedIntegration';
import { createMockKeyframe } from '../helpers/mockData';
import type { Keyframe } from '../../src/types';

// ─── calculateSourceTime ──────────────────────────────────────────────────

describe('calculateSourceTime', () => {
  it('no keyframes → time * defaultSpeed', () => {
    expect(calculateSourceTime([], 2, 1)).toBe(2);
    expect(calculateSourceTime([], 2, 2)).toBe(4);
    expect(calculateSourceTime([], 2, 0.5)).toBe(1);
  });

  it('1 speed keyframe → time * kf.value', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 3 })];
    expect(calculateSourceTime(kfs, 2, 1)).toBe(6);
  });

  it('t=0 → 0 (regardless of speed)', () => {
    expect(calculateSourceTime([], 0, 5)).toBe(0);
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 3 })];
    expect(calculateSourceTime(kfs, 0, 1)).toBe(0);
  });

  it('constant speed keyframes → exact value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 5, value: 2 }),
    ];
    const result = calculateSourceTime(kfs, 3, 1);
    // Constant speed 2 for 3 seconds = 6
    expect(result).toBeCloseTo(6, 1);
  });

  it('variable speed → trapezoidal integration (2x then 1x)', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 1, value: 1 }),
    ];
    // Speed goes linearly from 2 to 1 over 1 second
    // Integral = average(2, 1) * 1 = 1.5
    const result = calculateSourceTime(kfs, 1, 1);
    expect(result).toBeCloseTo(1.5, 1);
  });

  it('ignores non-speed keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, time: 0, value: 0.5 }),
    ];
    expect(calculateSourceTime(kfs, 2, 1)).toBe(2); // falls through to no speed KFs path
  });

  it('negative default speed without keyframes', () => {
    // Negative speed → reverse playback, source time goes negative
    expect(calculateSourceTime([], 2, -1)).toBe(-2);
    expect(calculateSourceTime([], 3, -2)).toBe(-6);
  });

  it('single keyframe with negative value', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: -2 })];
    expect(calculateSourceTime(kfs, 3, 1)).toBe(-6);
  });

  it('3 keyframes → multi-segment integration', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 1 }),
    ];
    // Constant speed 1 for 4 seconds = 4
    const result = calculateSourceTime(kfs, 4, 1);
    expect(result).toBeCloseTo(4, 1);
  });

  it('3 keyframes with varying speed → sums segment integrals', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 3, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 1 }),
    ];
    // Segment 1 (0→2): linear 1→3, avg=2, integral=2*2=4
    // Segment 2 (2→4): linear 3→1, avg=2, integral=2*2=4
    // Total = 8
    const result = calculateSourceTime(kfs, 4, 1);
    expect(result).toBeCloseTo(8, 1);
  });

  it('endTime beyond last keyframe → holds last value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 3 }),
    ];
    // From 0→2: linear 1→3, avg=2, integral=4
    // From 2→5: holds at 3, integral=3*3=9
    // Total = 13
    const result = calculateSourceTime(kfs, 5, 1);
    expect(result).toBeCloseTo(13, 0);
  });

  it('endTime between first and second keyframe → partial segment', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 2 }),
    ];
    // Constant speed 2 for 1 second = 2
    const result = calculateSourceTime(kfs, 1, 1);
    expect(result).toBeCloseTo(2, 1);
  });

  it('very large speed value', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 100 })];
    expect(calculateSourceTime(kfs, 5, 1)).toBe(500);
  });

  it('very small speed value (near zero)', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 0.01 })];
    expect(calculateSourceTime(kfs, 10, 1)).toBeCloseTo(0.1, 2);
  });

  it('speed = 0 (freeze frame) → source time = 0', () => {
    expect(calculateSourceTime([], 10, 0)).toBe(0);
  });

  it('single speed keyframe at value 0 → freeze frame', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 0 })];
    expect(calculateSourceTime(kfs, 5, 1)).toBe(0);
  });

  it('mixed speed and non-speed keyframes → only speed used', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, time: 0, value: 0 }),
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 3 }),
      createMockKeyframe({ property: 'opacity' as any, time: 5, value: 1 }),
    ];
    // Only 1 speed keyframe → time * kf.value
    expect(calculateSourceTime(kfs, 2, 1)).toBe(6);
  });

  it('mixed speed and non-speed keyframes with multiple speed kfs', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, time: 0, value: 0 }),
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 2 }),
      createMockKeyframe({ property: 'opacity' as any, time: 5, value: 1 }),
    ];
    // Constant speed 2 for 1 second = 2
    const result = calculateSourceTime(kfs, 1, 1);
    expect(result).toBeCloseTo(2, 1);
  });

  it('negative endTime in integration path → returns 0', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 5, value: 2 }),
    ];
    expect(calculateSourceTime(kfs, -1, 1)).toBe(0);
  });

  it('speed ramp from 1x to 4x over 2 seconds', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 4 }),
    ];
    // Linear ramp 1→4 over 2s: integral = avg(1,4) * 2 = 2.5 * 2 = 5
    const result = calculateSourceTime(kfs, 2, 1);
    expect(result).toBeCloseTo(5, 1);
  });

  it('unsorted keyframes still produce correct result', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 2 }),
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
    ];
    // Even if given out of order, sort should fix it. Constant speed 2 for 1s = 2
    const result = calculateSourceTime(kfs, 1, 1);
    expect(result).toBeCloseTo(2, 1);
  });
});

// ─── getSpeedAtTime ────────────────────────────────────────────────────────

describe('getSpeedAtTime', () => {
  it('delegates to interpolateKeyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 3 }),
    ];
    const speed = getSpeedAtTime(kfs, 1, 1);
    expect(speed).toBeCloseTo(2, 1);
  });

  it('returns default if no speed keyframes', () => {
    expect(getSpeedAtTime([], 1, 1.5)).toBe(1.5);
  });

  it('returns default if only non-speed keyframes present', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, time: 0, value: 0.5 }),
    ];
    expect(getSpeedAtTime(kfs, 1, 2)).toBe(2);
  });

  it('single speed keyframe → returns its value at any time', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 1, value: 3 })];
    // Single keyframe returns that value regardless of time
    expect(getSpeedAtTime(kfs, 0, 1)).toBe(3);
    expect(getSpeedAtTime(kfs, 1, 1)).toBe(3);
    expect(getSpeedAtTime(kfs, 5, 1)).toBe(3);
  });

  it('time before first keyframe → returns first keyframe value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 1, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 3, value: 4 }),
    ];
    expect(getSpeedAtTime(kfs, 0, 1)).toBe(2);
  });

  it('time after last keyframe → returns last keyframe value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 4 }),
    ];
    expect(getSpeedAtTime(kfs, 5, 1)).toBe(4);
  });

  it('time at exact keyframe position → returns keyframe value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 5 }),
    ];
    expect(getSpeedAtTime(kfs, 0, 1)).toBe(1);
    expect(getSpeedAtTime(kfs, 2, 1)).toBe(5);
  });

  it('interpolates between 3 keyframes correctly', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 3, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 1 }),
    ];
    // At t=1: linear interp between 1 and 3, t=0.5 → 2
    expect(getSpeedAtTime(kfs, 1, 1)).toBeCloseTo(2, 1);
    // At t=3: linear interp between 3 and 1, t=0.5 → 2
    expect(getSpeedAtTime(kfs, 3, 1)).toBeCloseTo(2, 1);
  });

  it('negative speed interpolation', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: -1 }),
    ];
    // At t=1: linear interp between 1 and -1, midpoint = 0
    expect(getSpeedAtTime(kfs, 1, 1)).toBeCloseTo(0, 1);
  });

  it('returns default for negative default speed with no keyframes', () => {
    expect(getSpeedAtTime([], 1, -2)).toBe(-2);
  });
});

// ─── calculateTotalSourceTime ─────────────────────────────────────────────

describe('calculateTotalSourceTime', () => {
  it('delegates to calculateSourceTime', () => {
    // Should behave identically to calculateSourceTime
    expect(calculateTotalSourceTime([], 5, 2)).toBe(10);
  });

  it('no keyframes → timelineDuration * defaultSpeed', () => {
    expect(calculateTotalSourceTime([], 10, 1)).toBe(10);
    expect(calculateTotalSourceTime([], 10, 0.5)).toBe(5);
    expect(calculateTotalSourceTime([], 10, 3)).toBe(30);
  });

  it('single keyframe → timelineDuration * kf.value', () => {
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 2 })];
    expect(calculateTotalSourceTime(kfs, 5, 1)).toBe(10);
  });

  it('timelineDuration = 0 → 0', () => {
    expect(calculateTotalSourceTime([], 0, 5)).toBe(0);
    const kfs = [createMockKeyframe({ property: 'speed' as any, time: 0, value: 3 })];
    expect(calculateTotalSourceTime(kfs, 0, 1)).toBe(0);
  });

  it('variable speed keyframes → same as calculateSourceTime', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 1, value: 1 }),
    ];
    const direct = calculateSourceTime(kfs, 1, 1);
    const total = calculateTotalSourceTime(kfs, 1, 1);
    expect(total).toBe(direct);
  });

  it('negative speed → negative source time consumed', () => {
    expect(calculateTotalSourceTime([], 5, -1)).toBe(-5);
  });
});

// ─── calculateTimelineDuration ─────────────────────────────────────────────

describe('calculateTimelineDuration', () => {
  it('sourceDuration=0 → 0', () => {
    expect(calculateTimelineDuration([], 0, 1)).toBe(0);
  });

  it('no keyframes → sourceDuration / |speed|', () => {
    expect(calculateTimelineDuration([], 10, 2)).toBe(5);
    expect(calculateTimelineDuration([], 10, 0.5)).toBe(20);
  });

  it('no keyframes, negative speed → uses absolute', () => {
    expect(calculateTimelineDuration([], 10, -2)).toBe(5);
  });

  it('binary search converges for constant speed keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 10, value: 2 }),
    ];
    // At constant speed 2, timeline duration for 10s source = 5s
    const result = calculateTimelineDuration(kfs, 10, 2);
    expect(result).toBeCloseTo(5, 1);
  });

  it('very slow speed caps at high duration', () => {
    // Speed near zero: code caps at sourceDuration * 1000
    const result = calculateTimelineDuration([], 10, 0.0001);
    expect(result).toBeGreaterThanOrEqual(10000);
  });

  it('negative sourceDuration → 0', () => {
    expect(calculateTimelineDuration([], -5, 1)).toBe(0);
  });

  it('speed = 1 no keyframes → same as sourceDuration', () => {
    expect(calculateTimelineDuration([], 10, 1)).toBe(10);
    expect(calculateTimelineDuration([], 0.5, 1)).toBe(0.5);
    expect(calculateTimelineDuration([], 100, 1)).toBe(100);
  });

  it('variable speed keyframes → binary search converges', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 2, value: 3, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 1 }),
    ];
    // We can verify by computing the forward direction:
    // sourceTime at t=4 ≈ 8 (as verified in calculateSourceTime test above)
    // So calculateTimelineDuration(kfs, 8, 1) should return ~4
    const duration = calculateTimelineDuration(kfs, 8, 1);
    expect(duration).toBeCloseTo(4, 0);
  });

  it('inverse of calculateSourceTime for constant speed', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 3, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 10, value: 3 }),
    ];
    // At constant speed 3: sourceTime at t=4 = 12
    const sourceTime = calculateSourceTime(kfs, 4, 3);
    const timelineDur = calculateTimelineDuration(kfs, sourceTime, 3);
    expect(timelineDur).toBeCloseTo(4, 1);
  });

  it('inverse of calculateSourceTime for ramp speed', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 4, value: 3 }),
    ];
    const sourceTime = calculateSourceTime(kfs, 4, 1);
    const timelineDur = calculateTimelineDuration(kfs, sourceTime, 1);
    expect(timelineDur).toBeCloseTo(4, 0);
  });

  it('half-speed doubles the timeline duration', () => {
    const result = calculateTimelineDuration([], 10, 0.5);
    expect(result).toBe(20);
  });

  it('4x speed quarters the timeline duration', () => {
    const result = calculateTimelineDuration([], 20, 4);
    expect(result).toBe(5);
  });

  it('custom maxIterations parameter', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 10, value: 2 }),
    ];
    // With very few iterations, result should still be reasonable
    const result = calculateTimelineDuration(kfs, 10, 2, 5);
    // 5 iterations may not converge perfectly but should be in the ballpark
    expect(result).toBeGreaterThan(3);
    expect(result).toBeLessThan(7);
  });

  it('single keyframe uses constant speed', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 5 }),
    ];
    // Single keyframe: calculateSourceTime uses kf.value * time
    // So calculateTimelineDuration should find t such that 5*t = 10 → t=2
    // But single keyframe path in calculateSourceTime doesn't go through binary search
    // so the binary search should still converge to the right answer
    const result = calculateTimelineDuration(kfs, 10, 1);
    expect(result).toBeCloseTo(2, 1);
  });

  it('speed exactly 0.001 → sourceDuration / 0.001', () => {
    const result = calculateTimelineDuration([], 10, 0.001);
    // absSpeed = 0.001 which is NOT < 0.001, so division path
    expect(result).toBeCloseTo(10000, 0);
  });

  it('speed slightly below threshold → caps at 1000x', () => {
    const result = calculateTimelineDuration([], 10, 0.0005);
    // absSpeed = 0.0005 < 0.001 → caps at sourceDuration * 1000
    expect(result).toBe(10000);
  });
});

// ─── hasReverseSpeed ───────────────────────────────────────────────────────

describe('hasReverseSpeed', () => {
  it('positive default, no keyframes → false', () => {
    expect(hasReverseSpeed([], 1)).toBe(false);
  });

  it('negative default, no keyframes → true', () => {
    expect(hasReverseSpeed([], -1)).toBe(true);
  });

  it('positive keyframes → false', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
      createMockKeyframe({ property: 'speed' as any, value: 2 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(false);
  });

  it('mixed keyframes (some negative) → true', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
      createMockKeyframe({ property: 'speed' as any, value: -0.5 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(true);
  });

  it('all negative keyframes → true', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: -1 }),
      createMockKeyframe({ property: 'speed' as any, value: -2 }),
      createMockKeyframe({ property: 'speed' as any, value: -0.5 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(true);
  });

  it('zero default speed, no keyframes → false (not negative)', () => {
    expect(hasReverseSpeed([], 0)).toBe(false);
  });

  it('zero value keyframe → false (not negative)', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 0 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(false);
  });

  it('ignores non-speed keyframes even if they have negative values', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, value: -1 }),
    ];
    // No speed keyframes → checks defaultSpeed
    expect(hasReverseSpeed(kfs, 1)).toBe(false);
  });

  it('single negative speed keyframe → true', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: -3 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(true);
  });

  it('negative default but positive keyframes → checks keyframes not default', () => {
    // When keyframes exist, only keyframe values are checked
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
      createMockKeyframe({ property: 'speed' as any, value: 2 }),
    ];
    expect(hasReverseSpeed(kfs, -5)).toBe(false);
  });

  it('very small negative speed → true', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: -0.001 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(true);
  });
});

// ─── getMaxSpeed ───────────────────────────────────────────────────────────

describe('getMaxSpeed', () => {
  it('no keyframes → |defaultSpeed|', () => {
    expect(getMaxSpeed([], 2)).toBe(2);
    expect(getMaxSpeed([], -3)).toBe(3);
  });

  it('with keyframes → max absolute value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
      createMockKeyframe({ property: 'speed' as any, value: -5 }),
      createMockKeyframe({ property: 'speed' as any, value: 3 }),
    ];
    expect(getMaxSpeed(kfs, 1)).toBe(5);
  });

  it('includes defaultSpeed in comparison', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
    ];
    expect(getMaxSpeed(kfs, 10)).toBe(10);
  });

  it('single keyframe larger than default', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 7 }),
    ];
    expect(getMaxSpeed(kfs, 2)).toBe(7);
  });

  it('single keyframe smaller than default', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
    ];
    expect(getMaxSpeed(kfs, 5)).toBe(5);
  });

  it('all zero speeds → 0', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 0 }),
    ];
    expect(getMaxSpeed(kfs, 0)).toBe(0);
  });

  it('negative default is larger in absolute value than keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 2 }),
      createMockKeyframe({ property: 'speed' as any, value: 3 }),
    ];
    expect(getMaxSpeed(kfs, -10)).toBe(10);
  });

  it('ignores non-speed keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' as any, value: 100 }),
    ];
    // No speed keyframes → returns |defaultSpeed|
    expect(getMaxSpeed(kfs, 2)).toBe(2);
  });

  it('many keyframes → finds the absolute max', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 0.5 }),
      createMockKeyframe({ property: 'speed' as any, value: 1 }),
      createMockKeyframe({ property: 'speed' as any, value: -2 }),
      createMockKeyframe({ property: 'speed' as any, value: 1.5 }),
      createMockKeyframe({ property: 'speed' as any, value: -4 }),
      createMockKeyframe({ property: 'speed' as any, value: 3 }),
    ];
    expect(getMaxSpeed(kfs, 1)).toBe(4);
  });

  it('very large speed value', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 400 }),
    ];
    expect(getMaxSpeed(kfs, 1)).toBe(400);
  });

  it('very small fractional speed', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 0.001 }),
    ];
    expect(getMaxSpeed(kfs, 0.0001)).toBeCloseTo(0.001, 5);
  });
});

// ─── Integration / Round-trip Tests ──────────────────────────────────────

describe('round-trip: calculateSourceTime ↔ calculateTimelineDuration', () => {
  it('constant speed 1x round-trips correctly', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 10, value: 1 }),
    ];
    const timelineDur = 7;
    const sourceTime = calculateSourceTime(kfs, timelineDur, 1);
    const recoveredDur = calculateTimelineDuration(kfs, sourceTime, 1);
    expect(recoveredDur).toBeCloseTo(timelineDur, 1);
  });

  it('constant speed 0.5x round-trips correctly', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 0.5, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 20, value: 0.5 }),
    ];
    const timelineDur = 8;
    const sourceTime = calculateSourceTime(kfs, timelineDur, 0.5);
    const recoveredDur = calculateTimelineDuration(kfs, sourceTime, 0.5);
    expect(recoveredDur).toBeCloseTo(timelineDur, 1);
  });

  it('no keyframes round-trips correctly', () => {
    const timelineDur = 5;
    const speed = 2;
    const sourceTime = calculateSourceTime([], timelineDur, speed);
    const recoveredDur = calculateTimelineDuration([], sourceTime, speed);
    expect(recoveredDur).toBeCloseTo(timelineDur, 5);
  });

  it('linear ramp 1x→3x round-trips correctly', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 6, value: 3 }),
    ];
    const timelineDur = 6;
    const sourceTime = calculateSourceTime(kfs, timelineDur, 1);
    const recoveredDur = calculateTimelineDuration(kfs, sourceTime, 1);
    expect(recoveredDur).toBeCloseTo(timelineDur, 0);
  });
});

// ─── Cross-function Consistency ──────────────────────────────────────────

describe('cross-function consistency', () => {
  it('getSpeedAtTime matches speed used in calculateSourceTime for constant speed', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 2, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 10, value: 2 }),
    ];
    // Speed at any point should be 2
    expect(getSpeedAtTime(kfs, 0, 1)).toBeCloseTo(2, 1);
    expect(getSpeedAtTime(kfs, 5, 1)).toBeCloseTo(2, 1);
    expect(getSpeedAtTime(kfs, 10, 1)).toBeCloseTo(2, 1);
    // Source time at t=5 should be 10
    expect(calculateSourceTime(kfs, 5, 1)).toBeCloseTo(10, 1);
  });

  it('calculateTotalSourceTime and calculateSourceTime return same result', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'speed' as any, time: 3, value: 2 }),
    ];
    const t = 3;
    expect(calculateTotalSourceTime(kfs, t, 1)).toBe(calculateSourceTime(kfs, t, 1));
  });

  it('hasReverseSpeed and getMaxSpeed agree on direction info', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: -3 }),
      createMockKeyframe({ property: 'speed' as any, value: 2 }),
    ];
    expect(hasReverseSpeed(kfs, 1)).toBe(true);
    expect(getMaxSpeed(kfs, 1)).toBe(3); // |-3| = 3
  });

  it('getMaxSpeed returns at least |defaultSpeed| even with keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'speed' as any, value: 0.1 }),
    ];
    const defaultSpeed = 5;
    expect(getMaxSpeed(kfs, defaultSpeed)).toBeGreaterThanOrEqual(Math.abs(defaultSpeed));
  });
});
