import { describe, expect, it } from 'vitest';
import { samplePreciseFace } from '../../src/services/landmarkTracking/preciseFaceSampling';
import type { LandmarkSeries } from '../../src/services/landmarkTracking/types';

function series(): LandmarkSeries {
  return { version: 1, clipId: 'face:test', createdAt: 0, sampleInterval: 0.04,
    faceTracking: { sourceStart: 2.01, sourceEnd: 2.15, detectedFrames: 3, contours: [] },
    frames: [2, 2.04, 2.1].map((time, i) => ({ time, duration: [0.04, 0.06, 0.05][i], hands: [], poses: [],
      faces: [[{ x: [0.5, 0.505, 0.5][i], y: 0.5, z: 0 }]],
    })),
  };
}

describe('precise face source timing and smoothing', () => {
  it('uses source PTS for variable frame rates and trim inside a source frame', () => {
    const track = series();
    expect(samplePreciseFace(track, 2.01)?.time).toBe(2);
    expect(samplePreciseFace(track, 2.099)?.time).toBe(2.04);
    expect(samplePreciseFace(track, 2.1)?.time).toBe(2.1);
    expect(samplePreciseFace(track, 2.15)).toBeNull();
    expect(samplePreciseFace(track, 2)).toBeNull();
  });
  it('does not hold stale positions in decode gaps or borrow a future detection', () => {
    const track = series();
    track.frames[1].faces = [];
    expect(samplePreciseFace(track, 2.08, 1)?.faces).toEqual([]);
    track.frames[0].duration = 0.015;
    expect(samplePreciseFace(track, 2.03)).toBeNull();
    expect(samplePreciseFace(track, NaN)).toBeNull();
  });
  it('reduces small jitter without mutating the saved points', () => {
    const track = series();
    const result = samplePreciseFace(track, 2.05, 1)!;
    expect(result.faces[0][0].x).toBeLessThan(0.505);
    expect(result.faces[0][0].x).toBeGreaterThan(0.5);
    expect(track.frames[1].faces[0][0].x).toBe(0.505);
  });
  it('preserves fast expressions and does not smooth across a missing face', () => {
    const track = series();
    track.frames[1].faces[0][0].x = 0.7;
    expect(samplePreciseFace(track, 2.05, 1)?.faces[0][0].x).toBe(0.7);
    track.frames[1].faces[0][0].x = 0.505;
    track.frames[0].faces = [];
    expect(samplePreciseFace(track, 2.05, 1)?.faces[0][0].x).toBe(0.505);
  });
});
