import { describe, expect, it } from 'vitest';
import { getTrimHandleArrowDirections } from '../../../src/components/timeline/utils/trimHandleDirections';
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
});
