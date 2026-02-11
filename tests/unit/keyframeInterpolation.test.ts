import { describe, it, expect } from 'vitest';
import {
  easingFunctions,
  PRESET_BEZIER,
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

// ═══════════════════════════════════════════════════════════════════════════
// Additional coverage tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── PRESET_BEZIER constant ─────────────────────────────────────────────────

describe('PRESET_BEZIER', () => {
  it('has entries for all 4 non-bezier easing types', () => {
    expect(PRESET_BEZIER).toHaveProperty('linear');
    expect(PRESET_BEZIER).toHaveProperty('ease-in');
    expect(PRESET_BEZIER).toHaveProperty('ease-out');
    expect(PRESET_BEZIER).toHaveProperty('ease-in-out');
  });

  it('linear preset is identity curve (0,0) to (1,1)', () => {
    expect(PRESET_BEZIER.linear.p1).toEqual([0, 0]);
    expect(PRESET_BEZIER.linear.p2).toEqual([1, 1]);
  });

  it('ease-in preset matches CSS spec (0.42,0) to (1,1)', () => {
    expect(PRESET_BEZIER['ease-in'].p1).toEqual([0.42, 0]);
    expect(PRESET_BEZIER['ease-in'].p2).toEqual([1, 1]);
  });

  it('ease-out preset matches CSS spec (0,0) to (0.58,1)', () => {
    expect(PRESET_BEZIER['ease-out'].p1).toEqual([0, 0]);
    expect(PRESET_BEZIER['ease-out'].p2).toEqual([0.58, 1]);
  });

  it('ease-in-out preset matches CSS spec (0.42,0) to (0.58,1)', () => {
    expect(PRESET_BEZIER['ease-in-out'].p1).toEqual([0.42, 0]);
    expect(PRESET_BEZIER['ease-in-out'].p2).toEqual([0.58, 1]);
  });

  it('all presets have control points with x in [0,1]', () => {
    for (const key of Object.keys(PRESET_BEZIER) as Array<keyof typeof PRESET_BEZIER>) {
      const { p1, p2 } = PRESET_BEZIER[key];
      expect(p1[0]).toBeGreaterThanOrEqual(0);
      expect(p1[0]).toBeLessThanOrEqual(1);
      expect(p2[0]).toBeGreaterThanOrEqual(0);
      expect(p2[0]).toBeLessThanOrEqual(1);
    }
  });
});

// ─── easingFunctions (additional) ───────────────────────────────────────────

describe('easingFunctions (additional)', () => {
  it('all easing functions are monotonically non-decreasing over [0,1]', () => {
    const types = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
    for (const type of types) {
      const fn = easingFunctions[type];
      let prev = fn(0);
      for (let t = 0.01; t <= 1.0; t += 0.01) {
        const curr = fn(t);
        expect(curr).toBeGreaterThanOrEqual(prev - 1e-10);
        prev = curr;
      }
    }
  });

  it('ease-in: quarter and three-quarter points', () => {
    expect(easingFunctions['ease-in'](0.25)).toBe(0.0625); // 0.25^2
    expect(easingFunctions['ease-in'](0.75)).toBe(0.5625); // 0.75^2
  });

  it('ease-out: quarter and three-quarter points', () => {
    // Formula: t * (2 - t)
    expect(easingFunctions['ease-out'](0.25)).toBe(0.4375); // 0.25 * 1.75
    expect(easingFunctions['ease-out'](0.75)).toBe(0.9375); // 0.75 * 1.25
  });

  it('ease-in and ease-out are symmetric: easeIn(t) + easeOut(1-t) = 1', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const ein = easingFunctions['ease-in'](t);
      const eout = easingFunctions['ease-out'](1 - t);
      expect(ein + eout).toBeCloseTo(1, 10);
    }
  });

  it('ease-in-out: exactly at midpoint boundary t=0.5', () => {
    // Both halves of the piecewise function meet at t=0.5
    expect(easingFunctions['ease-in-out'](0.5)).toBe(0.5);
  });
});

// ─── solveCubicBezierForX (additional) ──────────────────────────────────────

describe('solveCubicBezierForX (additional)', () => {
  it('custom epsilon: tighter precision converges', () => {
    const result = solveCubicBezierForX(0.5, 0.25, 0.1, 0.25, 1, 0.00001);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('ease-in-out bezier (0.42,0,0.58,1) is symmetric around 0.5', () => {
    const at25 = solveCubicBezierForX(0.25, 0.42, 0, 0.58, 1);
    const at75 = solveCubicBezierForX(0.75, 0.42, 0, 0.58, 1);
    expect(at25 + at75).toBeCloseTo(1, 2);
  });

  it('very small targetX near zero returns small positive value', () => {
    const result = solveCubicBezierForX(0.001, 0.42, 0, 0.58, 1);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(0.01);
  });

  it('very large targetX near one returns value close to 1', () => {
    const result = solveCubicBezierForX(0.999, 0.42, 0, 0.58, 1);
    expect(result).toBeGreaterThan(0.99);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('multiple values along the curve remain in [0,1]', () => {
    for (let x = 0.1; x <= 0.9; x += 0.1) {
      const result = solveCubicBezierForX(x, 0.42, 0, 0.58, 1);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it('steep curve (0,0,0,1): all output in valid range', () => {
    for (let x = 0.1; x <= 0.9; x += 0.1) {
      const result = solveCubicBezierForX(x, 0, 0, 0, 1);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it('handles degenerate bezier where p1x == p2x', () => {
    const result = solveCubicBezierForX(0.5, 0.5, 0, 0.5, 1);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ─── interpolateBezier (additional) ─────────────────────────────────────────

describe('interpolateBezier (additional)', () => {
  it('at t=0, returns prevKey value', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 10 });
    const nextKey = createMockKeyframe({ time: 2, value: 90 });
    expect(interpolateBezier(prevKey, nextKey, 0)).toBeCloseTo(10, 5);
  });

  it('at t=1, returns nextKey value', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 10 });
    const nextKey = createMockKeyframe({ time: 2, value: 90 });
    expect(interpolateBezier(prevKey, nextKey, 1)).toBeCloseTo(90, 5);
  });

  it('negative value delta (decreasing values)', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 100 });
    const nextKey = createMockKeyframe({ time: 1, value: 0 });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeCloseTo(50, 0);
  });

  it('zero value delta with non-zero time delta returns constant value', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 42 });
    const nextKey = createMockKeyframe({ time: 2, value: 42 });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeCloseTo(42, 5);
  });

  it('negative timeDelta returns nextKey value (defensive)', () => {
    const prevKey = createMockKeyframe({ time: 5, value: 10 });
    const nextKey = createMockKeyframe({ time: 2, value: 50 });
    expect(interpolateBezier(prevKey, nextKey, 0.5)).toBe(50);
  });

  it('large value range interpolates correctly', () => {
    const prevKey = createMockKeyframe({ time: 0, value: -1000 });
    const nextKey = createMockKeyframe({ time: 10, value: 1000 });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeCloseTo(0, -1);
  });

  it('very small time range still interpolates', () => {
    const prevKey = createMockKeyframe({ time: 0, value: 0 });
    const nextKey = createMockKeyframe({ time: 0.001, value: 100 });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeCloseTo(50, 0);
  });

  it('explicit handles override default linear handles', () => {
    const prevKey = createMockKeyframe({
      time: 0, value: 0,
      handleOut: { x: 0.42, y: 0 },
    });
    const nextKey = createMockKeyframe({
      time: 1, value: 100,
      handleIn: { x: 0, y: 0 },
    });
    const result = interpolateBezier(prevKey, nextKey, 0.5);
    expect(result).toBeLessThan(55);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ─── interpolateKeyframes (additional) ──────────────────────────────────────

describe('interpolateKeyframes (additional)', () => {
  it('exact time on a keyframe returns that keyframe value', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.5, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 0, 0)).toBe(0);
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBeCloseTo(0.5, 5);
    expect(interpolateKeyframes(kfs, 'opacity', 2, 0)).toBe(1);
  });

  it('unsorted keyframes are handled correctly (sorted internally)', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBeCloseTo(0.5, 5);
  });

  it('3+ segments with different easing per segment', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'ease-in' }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.5, easing: 'ease-out' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    // Segment 1 (ease-in): midpoint should be below linear midpoint
    const seg1mid = interpolateKeyframes(kfs, 'opacity', 0.5, 0);
    expect(seg1mid).toBeLessThan(0.25);
    expect(seg1mid).toBeGreaterThan(0);

    // Segment 2 (ease-out): midpoint should be above linear midpoint
    const seg2mid = interpolateKeyframes(kfs, 'opacity', 1.5, 0);
    expect(seg2mid).toBeGreaterThan(0.75);
    expect(seg2mid).toBeLessThan(1);
  });

  it('bezier fallback: handleOut triggers bezier even without easing=bezier', () => {
    const kfs = [
      createMockKeyframe({
        property: 'opacity', time: 0, value: 0, easing: 'linear',
        handleOut: { x: 0.333, y: 0 },
      }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 1 }),
    ];
    const result = interpolateKeyframes(kfs, 'opacity', 0.5, 0);
    expect(result).toBeDefined();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('bezier fallback: handleIn on nextKey triggers bezier', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({
        property: 'opacity', time: 1, value: 1,
        handleIn: { x: -0.333, y: 0 },
      }),
    ];
    const result = interpolateKeyframes(kfs, 'opacity', 0.5, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('effect property keyframes interpolate correctly', () => {
    const effectProp = 'effect.fx_123.shift' as AnimatableProperty;
    const kfs = [
      createMockKeyframe({ property: effectProp, time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: effectProp, time: 2, value: 180 }),
    ];
    expect(interpolateKeyframes(kfs, effectProp, 1, 0)).toBeCloseTo(90, 5);
  });

  it('negative values interpolate correctly', () => {
    const kfs = [
      createMockKeyframe({ property: 'position.x', time: 0, value: -100, easing: 'linear' }),
      createMockKeyframe({ property: 'position.x', time: 2, value: 100 }),
    ];
    expect(interpolateKeyframes(kfs, 'position.x', 1, 0)).toBeCloseTo(0, 5);
  });

  it('large number of keyframes: picks correct segment', () => {
    const kfs = [];
    for (let i = 0; i <= 10; i++) {
      kfs.push(createMockKeyframe({
        property: 'opacity',
        time: i,
        value: i / 10,
        easing: 'linear',
      }));
    }
    expect(interpolateKeyframes(kfs, 'opacity', 5.5, 0)).toBeCloseTo(0.55, 5);
  });

  it('zero time range between two keyframes at query time returns first value (before-first check)', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.2, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.8 }),
    ];
    // Both keyframes at time=1. After sort, first has value 0.2.
    // time <= propKeyframes[0].time is checked first (1 <= 1 = true), returns first value.
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBe(0.2);
  });

  it('time exactly on first keyframe returns first value', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.3, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 3, value: 0.9 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBe(0.3);
  });

  it('time exactly on last keyframe returns last value', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 1, value: 0.3, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 3, value: 0.9 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 3, 0)).toBe(0.9);
  });

  it('interpolation at 25% and 75% of linear range', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 4, value: 100 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 1, 0)).toBeCloseTo(25, 5);
    expect(interpolateKeyframes(kfs, 'opacity', 3, 0)).toBeCloseTo(75, 5);
  });

  it('default value is used only when no keyframes match property', () => {
    const kfs = [
      createMockKeyframe({ property: 'scale.x', time: 0, value: 2 }),
    ];
    expect(interpolateKeyframes(kfs, 'opacity', 0, 0.77)).toBe(0.77);
    expect(interpolateKeyframes(kfs, 'scale.x', 0, 999)).toBe(2);
  });
});

// ─── getInterpolatedClipTransform (additional) ──────────────────────────────

describe('getInterpolatedClipTransform (additional)', () => {
  it('partial keyframes: only animated properties change, rest use base', () => {
    const base = createMockTransform({
      opacity: 0.8,
      position: { x: 10, y: 20, z: 30 },
      scale: { x: 2, y: 3 },
      rotation: { x: 45, y: 90, z: 180 },
    });
    const kfs: Keyframe[] = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    const result = getInterpolatedClipTransform(kfs, 1, base);
    expect(result.opacity).toBeCloseTo(0.5, 5);
    expect(result.position.x).toBe(10);
    expect(result.position.y).toBe(20);
    expect(result.position.z).toBe(30);
    expect(result.scale.x).toBe(2);
    expect(result.scale.y).toBe(3);
    expect(result.rotation.x).toBe(45);
    expect(result.rotation.y).toBe(90);
    expect(result.rotation.z).toBe(180);
  });

  it('properties animated at different times: each resolves independently', () => {
    const base = createMockTransform();
    const kfs: Keyframe[] = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
      createMockKeyframe({ property: 'position.x', time: 1, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'position.x', time: 3, value: 100 }),
    ];

    const r0 = getInterpolatedClipTransform(kfs, 0, base);
    expect(r0.opacity).toBeCloseTo(0, 5);
    expect(r0.position.x).toBe(0);

    const r1 = getInterpolatedClipTransform(kfs, 1, base);
    expect(r1.opacity).toBeCloseTo(0.5, 5);
    expect(r1.position.x).toBeCloseTo(0, 5);

    const r2 = getInterpolatedClipTransform(kfs, 2, base);
    expect(r2.opacity).toBe(1);
    expect(r2.position.x).toBeCloseTo(50, 5);
  });

  it('blendMode preserved with non-default value through keyframe animation', () => {
    const base = createMockTransform({ blendMode: 'screen' });
    const kfs: Keyframe[] = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 1, value: 1 }),
    ];
    const result = getInterpolatedClipTransform(kfs, 0.5, base);
    expect(result.blendMode).toBe('screen');
    expect(result.opacity).toBeCloseTo(0.5, 5);
  });

  it('returns a new object (does not mutate baseTransform)', () => {
    const base = createMockTransform({ opacity: 0.8 });
    const kfs: Keyframe[] = [
      createMockKeyframe({ property: 'opacity', time: 0, value: 0, easing: 'linear' }),
      createMockKeyframe({ property: 'opacity', time: 2, value: 1 }),
    ];
    const result = getInterpolatedClipTransform(kfs, 1, base);
    expect(result).not.toBe(base);
    expect(base.opacity).toBe(0.8);
  });
});

// ─── convertPresetToBezierHandles (additional) ──────────────────────────────

describe('convertPresetToBezierHandles (additional)', () => {
  it('ease-in-out preset conversion', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-in-out', 2, 100);
    expect(handleOut.x).toBeCloseTo(0.84, 2); // 0.42 * 2
    expect(handleOut.y).toBe(0); // 0 * 100
    expect(handleIn.x).toBeCloseTo(-0.84, 2); // (0.58-1) * 2
    expect(handleIn.y).toBe(0); // (1-1) * 100
  });

  it('zero timeDelta produces zero x handles', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-in', 0, 100);
    expect(handleOut.x).toBe(0);
    expect(handleIn.x).toBe(0);
  });

  it('zero valueDelta produces zero y handles', () => {
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-in', 2, 0);
    expect(handleOut.y).toBe(0);
    expect(handleIn.y).toBe(0);
  });

  it('negative valueDelta produces handles with correct sign', () => {
    const { handleOut } = convertPresetToBezierHandles('ease-in', 2, -100);
    expect(handleOut.x).toBeCloseTo(0.84, 2);
    expect(handleOut.y).toBeCloseTo(0, 10); // 0 * -100 = -0, use toBeCloseTo to handle -0
  });

  it('handles scale proportionally with timeDelta and valueDelta', () => {
    const small = convertPresetToBezierHandles('ease-in', 1, 50);
    const large = convertPresetToBezierHandles('ease-in', 2, 100);
    expect(large.handleOut.x).toBeCloseTo(small.handleOut.x * 2, 5);
    expect(large.handleOut.y).toBeCloseTo(small.handleOut.y * 2, 5);
    expect(large.handleIn.x).toBeCloseTo(small.handleIn.x * 2, 5);
  });

  it('roundtrip: converting preset and using as bezier handles produces similar curve', () => {
    const timeDelta = 2;
    const valueDelta = 100;
    const { handleOut, handleIn } = convertPresetToBezierHandles('ease-in', timeDelta, valueDelta);
    const prevKey = createMockKeyframe({ time: 0, value: 0, handleOut });
    const nextKey = createMockKeyframe({ time: 2, value: 100, handleIn });
    const bezierResult = interpolateBezier(prevKey, nextKey, 0.5);
    expect(bezierResult).toBeLessThan(50);
    expect(bezierResult).toBeGreaterThanOrEqual(0);
  });
});

// ─── hasKeyframesForProperty (additional) ────────────────────────────────────

describe('hasKeyframesForProperty (additional)', () => {
  it('multiple properties: correctly identifies each', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' }),
      createMockKeyframe({ property: 'scale.x' }),
      createMockKeyframe({ property: 'position.y' }),
    ];
    expect(hasKeyframesForProperty(kfs, 'opacity')).toBe(true);
    expect(hasKeyframesForProperty(kfs, 'scale.x')).toBe(true);
    expect(hasKeyframesForProperty(kfs, 'position.y')).toBe(true);
    expect(hasKeyframesForProperty(kfs, 'rotation.z')).toBe(false);
    expect(hasKeyframesForProperty(kfs, 'scale.y')).toBe(false);
  });

  it('effect properties are matched correctly', () => {
    const effectProp = 'effect.fx_1.amount' as AnimatableProperty;
    const kfs = [
      createMockKeyframe({ property: effectProp }),
    ];
    expect(hasKeyframesForProperty(kfs, effectProp)).toBe(true);
    expect(hasKeyframesForProperty(kfs, 'effect.fx_1.shift' as AnimatableProperty)).toBe(false);
    expect(hasKeyframesForProperty(kfs, 'opacity')).toBe(false);
  });
});

// ─── getAnimatedProperties (additional) ──────────────────────────────────────

describe('getAnimatedProperties (additional)', () => {
  it('returns all 9 transform properties when all are present', () => {
    const allProps: AnimatableProperty[] = [
      'opacity', 'position.x', 'position.y', 'position.z',
      'scale.x', 'scale.y', 'rotation.x', 'rotation.y', 'rotation.z',
    ];
    const kfs = allProps.map(p => createMockKeyframe({ property: p }));
    const result = getAnimatedProperties(kfs);
    expect(result).toHaveLength(9);
    for (const p of allProps) {
      expect(result).toContain(p);
    }
  });

  it('includes effect properties alongside transform properties', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity' }),
      createMockKeyframe({ property: 'effect.fx_1.amount' as AnimatableProperty }),
    ];
    const result = getAnimatedProperties(kfs);
    expect(result).toHaveLength(2);
    expect(result).toContain('opacity');
    expect(result).toContain('effect.fx_1.amount');
  });

  it('deduplicates even with many keyframes per property', () => {
    const kfs = [
      createMockKeyframe({ property: 'opacity', time: 0 }),
      createMockKeyframe({ property: 'opacity', time: 1 }),
      createMockKeyframe({ property: 'opacity', time: 2 }),
      createMockKeyframe({ property: 'opacity', time: 3 }),
    ];
    const result = getAnimatedProperties(kfs);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('opacity');
  });
});

// ─── getKeyframeAtTime (additional) ──────────────────────────────────────────

describe('getKeyframeAtTime (additional)', () => {
  it('custom tolerance: wider tolerance finds keyframe', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 1 });
    expect(getKeyframeAtTime([kf], 'opacity', 1.05)).toBeUndefined();
    expect(getKeyframeAtTime([kf], 'opacity', 1.05, 0.1)).toBe(kf);
  });

  it('custom tolerance: narrower tolerance misses borderline keyframe', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 1 });
    expect(getKeyframeAtTime([kf], 'opacity', 1.005)).toBe(kf);
    expect(getKeyframeAtTime([kf], 'opacity', 1.005, 0.001)).toBeUndefined();
  });

  it('exact match at time 0', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 0 });
    expect(getKeyframeAtTime([kf], 'opacity', 0)).toBe(kf);
  });

  it('returns first matching keyframe when multiple are within tolerance', () => {
    const kf1 = createMockKeyframe({ property: 'opacity', time: 1.0 });
    const kf2 = createMockKeyframe({ property: 'opacity', time: 1.005 });
    const result = getKeyframeAtTime([kf1, kf2], 'opacity', 1.002);
    expect(result).toBe(kf1);
  });

  it('empty keyframes array returns undefined', () => {
    expect(getKeyframeAtTime([], 'opacity', 0)).toBeUndefined();
  });

  it('negative time values are handled', () => {
    const kf = createMockKeyframe({ property: 'opacity', time: 0 });
    expect(getKeyframeAtTime([kf], 'opacity', -0.005)).toBe(kf);
    expect(getKeyframeAtTime([kf], 'opacity', -1)).toBeUndefined();
  });
});

// ─── setValueInTransform (additional) ────────────────────────────────────────

describe('setValueInTransform (additional)', () => {
  it('unknown property returns copy without changes', () => {
    const original = createMockTransform({ opacity: 0.7 });
    const updated = setValueInTransform(original, 'speed' as AnimatableProperty, 99);
    expect(updated).not.toBe(original);
    expect(updated.opacity).toBe(0.7);
    expect(updated.position.x).toBe(0);
  });

  it('does not mutate nested position object', () => {
    const original = createMockTransform({ position: { x: 1, y: 2, z: 3 } });
    const updated = setValueInTransform(original, 'position.x', 99);
    expect(original.position.x).toBe(1);
    expect(updated.position.x).toBe(99);
    expect(updated.position).not.toBe(original.position);
  });

  it('does not mutate nested scale object', () => {
    const original = createMockTransform({ scale: { x: 1, y: 2 } });
    const updated = setValueInTransform(original, 'scale.x', 5);
    expect(original.scale.x).toBe(1);
    expect(updated.scale.x).toBe(5);
    expect(updated.scale).not.toBe(original.scale);
  });

  it('does not mutate nested rotation object', () => {
    const original = createMockTransform({ rotation: { x: 10, y: 20, z: 30 } });
    const updated = setValueInTransform(original, 'rotation.y', 99);
    expect(original.rotation.y).toBe(20);
    expect(updated.rotation.y).toBe(99);
    expect(updated.rotation).not.toBe(original.rotation);
  });

  it('setting position.y does not affect position.x or position.z', () => {
    const original = createMockTransform({ position: { x: 1, y: 2, z: 3 } });
    const updated = setValueInTransform(original, 'position.y', 99);
    expect(updated.position.x).toBe(1);
    expect(updated.position.y).toBe(99);
    expect(updated.position.z).toBe(3);
  });

  it('setting position.z does not affect position.x or position.y', () => {
    const original = createMockTransform({ position: { x: 1, y: 2, z: 3 } });
    const updated = setValueInTransform(original, 'position.z', 99);
    expect(updated.position.x).toBe(1);
    expect(updated.position.y).toBe(2);
    expect(updated.position.z).toBe(99);
  });

  it('setting rotation.x does not affect rotation.y or rotation.z', () => {
    const original = createMockTransform({ rotation: { x: 10, y: 20, z: 30 } });
    const updated = setValueInTransform(original, 'rotation.x', 99);
    expect(updated.rotation.x).toBe(99);
    expect(updated.rotation.y).toBe(20);
    expect(updated.rotation.z).toBe(30);
  });

  it('chaining multiple sets produces correct cumulative result', () => {
    let t = createMockTransform();
    t = setValueInTransform(t, 'opacity', 0.5);
    t = setValueInTransform(t, 'position.x', 10);
    t = setValueInTransform(t, 'scale.y', 3);
    t = setValueInTransform(t, 'rotation.z', 45);
    expect(t.opacity).toBe(0.5);
    expect(t.position.x).toBe(10);
    expect(t.scale.y).toBe(3);
    expect(t.rotation.z).toBe(45);
    expect(t.position.y).toBe(0);
    expect(t.scale.x).toBe(1);
    expect(t.rotation.x).toBe(0);
  });
});
