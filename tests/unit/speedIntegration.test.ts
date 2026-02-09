import { describe, it, expect } from 'vitest';
import {
  calculateSourceTime,
  getSpeedAtTime,
  calculateTimelineDuration,
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
});
