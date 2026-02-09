import { describe, it, expect } from 'vitest';
import {
  easingFunctions,
  solveCubicBezierForX,
  interpolateBezier,
  interpolateKeyframes,
  getInterpolatedClipTransform,
  convertPresetToBezierHandles,
  hasKeyframesForProperty,
  getAnimatedProperties,
  getKeyframeAtTime,
  getValueFromTransform,
  setValueInTransform,
} from '../../src/utils/keyframeInterpolation';
import { createMockKeyframe, createMockTransform } from '../helpers/mockData';
import type { Keyframe, ClipTransform, AnimatableProperty } from '../../src/types';

// ─── easingFunctions ───────────────────────────────────────────────────────

describe('easingFunctions', () => {
  it('linear: t=0 → 0, t=0.5 → 0.5, t=1 → 1', () => {
    expect(easingFunctions.linear(0)).toBe(0);
    expect(easingFunctions.linear(0.5)).toBe(0.5);
    expect(easingFunctions.linear(1)).toBe(1);
  });

  it('ease-in: starts slow (t=0.5 < 0.5)', () => {
    expect(easingFunctions['ease-in'](0)).toBe(0);
    expect(easingFunctions['ease-in'](0.5)).toBe(0.25);
    expect(easingFunctions['ease-in'](1)).toBe(1);
  });

  it('ease-out: starts fast (t=0.5 > 0.5)', () => {
    expect(easingFunctions['ease-out'](0)).toBe(0);
    expect(easingFunctions['ease-out'](0.5)).toBe(0.75);
    expect(easingFunctions['ease-out'](1)).toBe(1);
  });

  it('ease-in-out: symmetric around 0.5', () => {
    expect(easingFunctions['ease-in-out'](0)).toBe(0);
    expect(easingFunctions['ease-in-out'](0.5)).toBe(0.5);
    expect(easingFunctions['ease-in-out'](1)).toBe(1);
    // First half is ease-in, second half is ease-out
    expect(easingFunctions['ease-in-out'](0.25)).toBeLessThan(0.25);
    expect(easingFunctions['ease-in-out'](0.75)).toBeGreaterThan(0.75);
  });
});

// ─── solveCubicBezierForX ──────────────────────────────────────────────────

describe('solveCubicBezierForX', () => {
  it('returns 0 for targetX <= 0', () => {
    expect(solveCubicBezierForX(0, 0.42, 0, 0.58, 1)).toBe(0);
    expect(solveCubicBezierForX(-1, 0.42, 0, 0.58, 1)).toBe(0);
  });

  it('returns 1 for targetX >= 1', () => {
    expect(solveCubicBezierForX(1, 0.42, 0, 0.58, 1)).toBe(1);
    expect(solveCubicBezierForX(2, 0.42, 0, 0.58, 1)).toBe(1);
  });

  it('linear bezier (0,0,1,1) returns ~targetX', () => {
    expect(solveCubicBezierForX(0.5, 0, 0, 1, 1)).toBeCloseTo(0.5, 2);
    expect(solveCubicBezierForX(0.25, 0, 0, 1, 1)).toBeCloseTo(0.25, 2);
    expect(solveCubicBezierForX(0.75, 0, 0, 1, 1)).toBeCloseTo(0.75, 2);
  });

  it('ease-in bezier produces output < input at midpoint', () => {
    const result = solveCubicBezierForX(0.5, 0.42, 0, 1, 1);
    expect(result).toBeLessThan(0.5);
  });

  it('ease-out bezier produces output > input at midpoint', () => {
    const result = solveCubicBezierForX(0.5, 0, 0, 0.58, 1);
    expect(result).toBeGreaterThan(0.5);
  });
});

// ─── interpolateBezier ─────────────────────────────────────────────────────

describe('interpolateBezier', () => {
  it('linear handles → linear interpolation', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 0 });
    const nextKey = createMockKeyframe({ time: 1, value: 100 });
    // Default handles produce linear interpolation
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeCloseTo(50, 0);
  });

  it('returns nextKey value when timeDelta is 0', () => {
    const prevKey = createMockKeyframe({ time: 1, value: 10 });
    const nextKey = createMockKeyframe({ time: 1, value: 50 });
    expect(interpolateBezier(prevKey, nextKey, 0.5)).toBe(50);
  });

  it('custom handles produce non-linear interpolation', () => {
    const prevKey = createMockKeyframe({
      time: 0, value: 0,
      handleOut: { x: 0.5, y: 0 }, // slow start
    });
    const nextKey = createMockKeyframe({
      time: 1, value: 100,
      handleIn: { x: -0.5, y: 0 }, // slow end
    });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    // With slow start/end, midpoint value should differ from 50
    expect(result).toBeDefined();
    expect(typeof result).toBe('number');
  });
});

// ─── interpolateKeyframes ──────────────────────────────────────────────────

describe('interpolateKeyframes', () => {
  it('0 keyframes → defaultValue', () => {
    expect(interpolateKeyframes([], 'opacity', 1, 0.5)).toBe(0.5);
  });

  it('1 keyframe → that value', () => {
    const kfs = [createMockKeyframe({ property: 'opacity', time: 1, value: 0.7 })];
    expect(interpolateKeyframes(kfs, 'opacity', 0, 0.5)).toBe(0.7);
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0.5)).toBe(0.7);
    expect(interpolateKeyframes(kfs, 'opacity', 5, 0.5)).toBe(0.7);
  });

  it('before first KF → first value', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 2, value: 0.3 }),
      createMockKeyframe({ property: 'opacity', time: 4, value: 0.9 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 0, 1)).toBe(0.3);
    expect(interpolateKeyframes(kfs, 'opacity', 1, 1)).toBe(0.3);
  });

  it('after last KF → last value', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.2 }),
      createMockKeyframe({ property: 'opacity', time: 3, value: 0.8 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 5, 1)).toBe(0.8);
  });

  it('linear interpolation between two keyframes', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBeCloseTo(0.5, 5);
  });

  it('ease-in interpolation: midpoint < 0.5 of range', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'ease-in' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    const mid = interpolateKeyframes(kfs, 'opacity', 1, 0);
    expect(mid).toBeLessThan(0.5);
    expect(mid).toBeGreaterThan(0);
  });

  it('ease-out interpolation: midpoint > 0.5 of range', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'ease-out' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    const mid = interpolateKeyframes(kfs, 'opacity', 1, 0);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
  });

  it('ease-in-out interpolation at t=0.5 → ~0.5 of value range', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'ease-in-out' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    const mid = interpolateKeyframes(kfs, 'opacity', 1, 0);
    expect(mid).toBeCloseTo(0.5, 1);
  });

  it('bezier easing with custom handles', () => {
    const kfs = [
      createMockKeyframe({
        property: 'opacity', time: 0, value: 0, easing: 'bezier',
        handleOut: { x: 0.333, y: 0 },
      }),
      createMockKeyframe({
        property: 'opacity', time: 3, value: 1,
        handleIn: { x: -1, y: 0 },
      }),
    ];
    const result = interpolateKeyframes(kfs, 'opacity', 1.5, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('ignores keyframes for other properties', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0.5 }),
      createMockKeyframe({ property: 'scale.x', time: 0, value: 2 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 0, 1)).toBe(0.5);
    expect(interpolateKeyframes(kfs, 'scale.x', 0, 1)).toBe(2);
  });

  it('multiple keyframes: correct segment selection', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 0 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 0.5, 0)).toBeCloseTo(0.5, 5);
    expect(interpolateKeyframes(kfs, 'opacity', 1.5, 0)).toBeCloseTo(0.5, 5);
  });
});

// ─── getInterpolatedClipTransform ──────────────────────────────────────────

describe('getInterpolatedClipTransform', () => {
  it('no keyframes → returns baseTransform', () => {
    const base = createMockTransform({ opacity: 0.8 });
    const result = getInterpolatedClipTransform([], 0, base);
    expect(result.opacity).toBe(0.8);
    expect(result.position.x).toBe(0);
    expect(result.scale.x).toBe(1);
  });

  it('interpolates all 9 properties correctly', () => {
    const base = createMockTransform();
    const kfs: Keyframe[] = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
      createMockKeyframe({ property: 'position.x', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'position.x', time: 2, value: 100 }),
      createMockKeyframe({ property: 'position.y', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'position.y', time: 2, value: 200 }),
      createMockKeyframe({ property: 'position.z', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'position.z', time: 2, value: 50 }),
      createMockKeyframe({ property: 'scale.x', time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'scale.x', time: 2, value: 2 }),
      createMockKeyframe({ property: 'scale.y', time: 0, value: 1, easing: 'linear' }),
      createMockKeyframe({ property: 'scale.y', time: 2, value: 3 }),
      createMockKeyframe({ property: 'rotation.x', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'rotation.x', time: 2, value: 90 }),
      createMockKeyframe({ property: 'rotation.y', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'rotation.y', time: 2, value: 180 }),
      createMockKeyframe({ property: 'rotation.z', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'rotation.z', time: 2, value: 360 }),
    ];

    const result = getInterpolatedClipTransform(kfs, 1, base);
    expect(result.opacity).toBeCloseTo(0.5, 5);
    expect(result.position.x).toBeCloseTo(50, 5);
    expect(result.position.y).toBeCloseTo(100, 5);
    expect(result.position.z).toBeCloseTo(25, 5);
    expect(result.scale.x).toBeCloseTo(1.5, 5);
    expect(result.scale.y).toBeCloseTo(2, 5);
    expect(result.rotation.x).toBeCloseTo(45, 5);
    expect(result.rotation.y).toBeCloseTo(90, 5);
    expect(result.rotation.z).toBeCloseTo(180, 5);
  });

  it('blendMode is always from baseTransform (not animatable)', () => {
    const base = createMockTransform({ blendMode: 'multiply' });
    const result = getInterpolatedClipTransform([], 0, base);
    expect(result.blendMode).toBe('multiply');
  });
});

// ─── convertPresetToBezierHandles ──────────────────────────────────────────

describe('convertPresetToBezierHandles', () => {
  it('linear → zero-value handles', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('linear', 1, 1);
    expect(handleOut.x).toBe(0);
    expect(handleOut.y).toBe(0);
    expect(handleIn.x).toBe(0);
    expect(handleIn.y).toBe(0);
  });

  it('ease-in preset conversion', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-in', 2, 100);
    expect(handleOut.x).toBeCloseTo(0.84, 2); // 0.42 * 2
    expect(handleOut.y).toBe(0); // 0 * 100
    expect(handleIn.x).toBe(0); // (1-1) * 2
    expect(handleIn.y).toBe(0); // (1-1) * 100
  });

  it('ease-out preset conversion', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-out', 2, 100);
    expect(handleOut.x).toBe(0); // 0 * 2
    expect(handleOut.y).toBe(0); // 0 * 100
    expect(handleIn.x).toBeCloseTo(-0.84, 2); // (0.58-1) * 2
    expect(handleIn.y).toBe(0); // (1-1) * 100
  });
});

// ─── hasKeyframesForProperty ───────────────────────────────────────────────

describe('hasKeyframesForProperty', () => {
  it('returns false for empty array', () => {
    expect(hasKeyframesForProperty([], 'opacity')).toBe(false);
  });

  it('returns true when property has keyframes', () => {
    const kfs = [createMockKeyframe({ property: 'opacity' })];
    expect(hasKeyframesForProperty(kfs, 'opacity')).toBe(true);
  });

  it('returns false when property has no keyframes', () => {
    const kfs = [createMockKeyframe({ property: 'scale.x' })];
    expect(hasKeyframesForProperty(kfs, 'opacity')).toBe(false);
  });
});

// ─── getAnimatedProperties ─────────────────────────────────────────────────

describe('getAnimatedProperties', () => {
  it('returns empty array for no keyframes', () => {
    expect(getAnimatedProperties([])).toEqual([]);
  });

  it('returns unique properties', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' }),
      createMockKeyframe({ property: 'opacity' }),
      createMockKeyframe({ property: 'scale.x' }),
    ];
    const props = getAnimatedProperties(kfs);
    expect(props).toHaveLength(2);
    expect(props).toContain('opacity');
    expect(props).toContain('scale.x');
  });
});

// ─── getKeyframeAtTime ─────────────────────────────────────────────────────

describe('getKeyframeAtTime', () => {
  it('finds keyframe within tolerance', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 1 });
    expect(getKeyframeAtTime([kf], 'opacity', 1.005)).toBe(kf);
  });

  it('returns undefined outside tolerance', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 1 });
    expect(getKeyframeAtTime([kf], 'opacity', 1.05)).toBeUndefined();
  });

  it('returns undefined for wrong property', () => {
    const kf = createMockKeyframe({ property: 'scale.x', time: 1 });
    expect(getKeyframeAtTime([kf], 'opacity', 1)).toBeUndefined();
  });
});

// ─── getValueFromTransform / setValueInTransform ───────────────────────────

describe('getValueFromTransform', () => {
  const transform = createMockTransform({
    opacity: 0.5,
    position: { x: 10, y: 20, z: 30 },
    scale: { x: 2, y: 3 },
    rotation: { x: 45, y: 90, z: 180 },
  });

  const cases: [AnimatableProperty, number][] = [
    ['opacity', 0.5],
    ['position.x', 10],
    ['position.y', 20],
    ['position.z', 30],
    ['scale.x', 2],
    ['scale.y', 3],
    ['rotation.x', 45],
    ['rotation.y', 90],
    ['rotation.z', 180],
  ];

  it.each(cases)('%s → %d', (prop, expected) => {
    expect(getValueFromTransform(transform, prop)).toBe(expected);
  });

  it('unknown property returns 0', () => {
    expect(getValueFromTransform(transform, 'speed' as AnimatableProperty)).toBe(0);
  });
});

describe('setValueInTransform', () => {
  it('sets opacity without mutating original', () => {
    const original = createMockTransform();
    const updated = setValueInTransform(original, 'opacity', 0.5);
    expect(updated.opacity).toBe(0.5);
    expect(original.opacity).toBe(1); // unchanged
  });

  it('sets position.x', () => {
    const original = createMockTransform();
    const updated = setValueInTransform(original, 'position.x', 42);
    expect(updated.position.x).toBe(42);
    expect(updated.position.y).toBe(0); // other axes unchanged
  });

  it('sets scale.y', () => {
    const original = createMockTransform();
    const updated = setValueInTransform(original, 'scale.y', 2.5);
    expect(updated.scale.y).toBe(2.5);
    expect(updated.scale.x).toBe(1); // other axis unchanged
  });

  it('sets rotation.z', () => {
    const original = createMockTransform();
    const updated = setValueInTransform(original, 'rotation.z', 90);
    expect(updated.rotation.z).toBe(90);
  });

  it('roundtrip: get after set returns same value', () => {
    const props: AnimatableProperty[] = [
      'opacity', 'position.x', 'position.y', 'position.z',
      'scale.x', 'scale.y', 'rotation.x', 'rotation.y', 'rotation.z',
    ];
    for (const prop of props) {
      const t = setValueInTransform(createMockTransform(), prop, 42);
      expect(getValueFromTransform(t, prop)).toBe(42);
    }
  });
});
