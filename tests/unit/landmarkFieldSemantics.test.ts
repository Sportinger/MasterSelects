import { describe, expect, it } from 'vitest';
import {
  LANDMARK_FIELD_MAX_POINTS,
  LANDMARK_FIELD_STORAGE_FLOATS,
  evaluateLandmarkField,
  packTrackingLandmarkStorage,
  type TrackingLandmarkSourceDescriptor,
} from '../../src/services/operators/landmarkFieldSemantics';

describe('landmark field semantics', () => {
  it('matches the bounded f32 max field with resolution aspect correction', () => {
    const points = [{ x: .25, y: .5 }, { x: .75, y: .5 }];
    expect(evaluateLandmarkField({ points, uv: [.25, .5], radius: .1, resolution: [1920, 1080] })).toBe(1);
    const wide = evaluateLandmarkField({ points, uv: [.29, .5], radius: .1, resolution: [200, 100] });
    const square = evaluateLandmarkField({ points, uv: [.29, .5], radius: .1, resolution: [100, 100] });
    expect(wide).toBeLessThan(square);
    expect(evaluateLandmarkField({
      points: Array.from({ length: LANDMARK_FIELD_MAX_POINTS + 1 }, (_, index) => index === LANDMARK_FIELD_MAX_POINTS
        ? { x: .5, y: .5 } : { x: 0, y: 0 }),
      uv: [.5, .5], radius: .05, resolution: [1, 1],
    })).toBe(0);
  });

  it('fails closed at invalid numeric boundaries', () => {
    const valid = { points: [{ x: .5, y: .5 }], uv: [.5, .5] as const, radius: .1, resolution: [16, 9] as const };
    expect(evaluateLandmarkField({ ...valid, radius: 0 })).toBe(0);
    expect(evaluateLandmarkField({ ...valid, uv: [Number.NaN, .5] })).toBe(0);
    expect(evaluateLandmarkField({ ...valid, resolution: [16, 0] })).toBe(0);
    expect(evaluateLandmarkField({ ...valid, points: [{ x: Number.POSITIVE_INFINITY, y: .5 }] })).toBe(0);
  });

  it('defines the pose-first-face descriptor and vec4 storage layout', () => {
    const descriptor: TrackingLandmarkSourceDescriptor = {
      kind: 'tracking-landmarks', operator: 'source.tracking-landmarks', policy: 'pose-first-face',
    };
    expect(descriptor.policy).toBe('pose-first-face');
    const packed = packTrackingLandmarkStorage({
      header: [72, .4, .6, .2],
      points: [{ x: .1, y: .2, z: -.3, visibility: .75 }],
    });
    expect(packed).toHaveLength(LANDMARK_FIELD_STORAGE_FLOATS);
    expect([...packed.slice(0, 8)]).toEqual([
      72, Math.fround(.4), Math.fround(.6), Math.fround(.2),
      Math.fround(.1), Math.fround(.2), Math.fround(-.3), Math.fround(.75),
    ]);
    expect([...packed.slice(8)]).toEqual(Array(LANDMARK_FIELD_STORAGE_FLOATS - 8).fill(0));
  });
});
