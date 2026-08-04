import { describe, expect, it } from 'vitest';
import { getTrimHandleArrowDirections } from '../../../src/components/timeline/utils/trimHandleDirections';
import { computeTrimTiming, trimOriginalsFromClip } from '../../../src/components/timeline/utils/clipTrimTiming';
import { createMockClip } from '../../helpers/mockData';

describe('trimHandleDirections', () => {
  it('shows both directions when a finite clip can be extended and shortened', () => {
    const clip = createMockClip({
      startTime: 10,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 20 },
    });

    expect(getTrimHandleArrowDirections(clip, 'left')).toEqual(['left', 'right']);
    expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left', 'right']);
  });

  it('shows only inward arrows at the source start and end', () => {
    const clip = createMockClip({
      startTime: 10,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', naturalDuration: 5 },
    });

    expect(getTrimHandleArrowDirections(clip, 'left')).toEqual(['right']);
    expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left']);
  });

  it('prevents left extension at the timeline start', () => {
    const clip = createMockClip({
      startTime: 0,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 20 },
    });

    expect(getTrimHandleArrowDirections(clip, 'left')).toEqual(['right']);
  });

  it('allows generated clips to extend right indefinitely', () => {
    const clip = createMockClip({
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'image', naturalDuration: 5 },
    });

    expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left', 'right']);
  });

  it('treats motion clips as procedural: both edges extend past the creation-time naturalDuration', () => {
    for (const type of ['motion-shape', 'motion-null', 'motion-adjustment']) {
      const clip = createMockClip({
        startTime: 10,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        source: { type, naturalDuration: 5 },
      });

      expect(getTrimHandleArrowDirections(clip, 'left')).toEqual(['left', 'right']);
      expect(getTrimHandleArrowDirections(clip, 'right')).toEqual(['left', 'right']);

      const extendRight = computeTrimTiming(clip, 'right', trimOriginalsFromClip(clip), 7);
      expect(extendRight.newDuration).toBe(12);

      const extendLeft = computeTrimTiming(clip, 'left', trimOriginalsFromClip(clip), -4);
      expect(extendLeft.newStartTime).toBe(6);
      expect(extendLeft.newDuration).toBe(9);
    }
  });

  it('maps timeline trim deltas through the absolute playback speed', () => {
    for (const speed of [2, -2]) {
      const clip = createMockClip({
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 10,
        speed,
        source: { type: 'video', naturalDuration: 10 },
      });

      const trimEnd = computeTrimTiming(clip, 'right', trimOriginalsFromClip(clip), -1);
      expect(trimEnd.newOutPoint).toBe(8);
      expect(trimEnd.newDuration).toBe(4);
      expect(trimEnd.targetTime).toBe(4);

      const trimStart = computeTrimTiming(clip, 'left', trimOriginalsFromClip(clip), 1);
      expect(trimStart.newStartTime).toBe(1);
      expect(trimStart.newInPoint).toBe(2);
      expect(trimStart.newDuration).toBe(4);
    }
  });
});
