import { describe, expect, it } from 'vitest';
import {
  evenlySampleLandmarks,
  landmarkPointStats,
  selectSubjectLandmarks,
} from '../../src/services/landmarkTracking/subjectLandmarkSemantics';
import type { LandmarkPoint } from '../../src/services/landmarkTracking/types';

const point = (x: number, y = x): LandmarkPoint => ({ x, y, z: 0 });

describe('Subject landmark semantics', () => {
  it('prefers all pose points and falls back to faces only without a pose', () => {
    const poses = [[point(.1), point(.2)], [point(.3)]], faces = [[point(.7), point(.8)]];
    expect(selectSubjectLandmarks({ poses, faces })).toEqual(poses.flat());
    expect(selectSubjectLandmarks({ poses: [], faces })).toEqual(faces.flat());
    expect(selectSubjectLandmarks({ poses: [], faces: [] })).toEqual([]);
  });

  it('retains the legacy empty defaults and mean radial spread', () => {
    expect(landmarkPointStats([])).toEqual({ x: .5, y: .5, spread: .15 });
    const stats = landmarkPointStats([point(0, 0), point(1, 0), point(0, 1), point(1, 1)]);
    expect(stats.x).toBe(.5);
    expect(stats.y).toBe(.5);
    expect(stats.spread).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it('uses the exact stable floor-index downsampling contract', () => {
    const points = Array.from({ length: 130 }, (_, index) => point(index, -index));
    const sampled = evenlySampleLandmarks(points, 64);
    expect(sampled).toHaveLength(64);
    expect(sampled.map(item => item.x)).toEqual(Array.from({ length: 64 }, (_, index) => Math.floor(index * 130 / 64)));
    const short = points.slice(0, 3);
    expect(evenlySampleLandmarks(short, 64)).toBe(short);
  });
});
