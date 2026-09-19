import { describe, it, expect } from 'vitest';
import { visibleKeyframeMarkers, nearestKeyframeMarker } from '../../src/components/timeline/utils/visibleKeyframeMarkers';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import { createMockKeyframe } from '../helpers/mockData';

describe('dense keyframe display', () => {
  const keys = Array.from({ length: 3000 }, (_, i) => ({ id: String(i), x: i / 10 }));
  it('draws every overlapping key in the viewport without reducing the source', () => {
    const shown = visibleKeyframeMarkers(keys, k => k.x, 0, 400);
    expect(shown).toEqual(keys);
    expect(nearestKeyframeMarker(shown, 100.1)?.id).toBe('1001');
    expect(nearestKeyframeMarker(shown, 100.2)?.id).toBe('1002');
  });
  it('culls offscreen geometry and locates the nearest key after horizontal scrolling', () => {
    const shown = visibleKeyframeMarkers(keys, k => k.x, 100, 30);
    expect(shown).not.toContain(keys[0]); expect(shown).not.toContain(keys[2999]);
    expect(nearestKeyframeMarker(shown, 120)?.id).toBe('1200');
    expect(nearestKeyframeMarker(shown, 300)).toBeUndefined();
  });
});

describe('indexed keyframe interpolation', () => {
  it('reuses property ordering across frames and rebuilds after an immutable edit', () => {
    let reads = 0;
    const keys = Array.from({ length: 3000 }, (_, i) => ({
      ...createMockKeyframe({ time: i / 30, value: i, property: 'position.x' }),
      get property() { reads++; return 'position.x' as const; },
    }));
    expect(interpolateKeyframes(keys, 'position.x', 1, 0)).toBe(30);
    const initialReads = reads;
    for (let frame = 1; frame < 100; frame++) interpolateKeyframes(keys, 'position.x', frame / 30, 0);
    expect(reads).toBe(initialReads);
    const edited = keys.map((k, i) => i === 30 ? { ...k, value: 900 } : k);
    expect(interpolateKeyframes(edited, 'position.x', 1, 0)).toBe(900);
    expect(interpolateKeyframes(keys, 'position.x', 1, 0)).toBe(30);
  });
});
