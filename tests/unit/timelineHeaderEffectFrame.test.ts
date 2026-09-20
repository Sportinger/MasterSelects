import { describe, expect, it, vi } from 'vitest';
import { getHeaderPropertyCurrentValue, type KeyframeTrackClip } from '../../src/components/timeline/utils/timelineHeaderPropertyModel';
import { createMockClip } from '../helpers/mockData';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';

describe('expanded effect header values', () => {
  it('interpolates once for sibling rows and refreshes on time, keys, clip or reader changes', () => {
    const effects = [{ id: 'fx', type: 'blur', name: 'Blur', params: { amount: 3, radius: 7 } }];
    const read = vi.fn(() => effects);
    let input = { clip: createMockClip() as KeyframeTrackClip, clipId: 'clip', clipLocalTime: 1,
      keyframes: [], isWithinClip: true, getInterpolatedEffects: read,
      getInterpolatedTransform: () => DEFAULT_TRANSFORM, prop: 'effect.fx.amount' };
    expect(getHeaderPropertyCurrentValue(input)).toBe(3);
    expect(getHeaderPropertyCurrentValue({ ...input, prop: 'effect.fx.radius' })).toBe(7);
    expect(read).toHaveBeenCalledTimes(1);
    input = { ...input, clipLocalTime: 2 };
    getHeaderPropertyCurrentValue(input);
    input = { ...input, keyframes: [] };
    getHeaderPropertyCurrentValue(input);
    input = { ...input, clip: { ...input.clip } };
    getHeaderPropertyCurrentValue(input);
    expect(read).toHaveBeenCalledTimes(4);
    const nextRead = vi.fn(() => [{ ...effects[0], params: { amount: 9 } }]);
    expect(getHeaderPropertyCurrentValue({ ...input, getInterpolatedEffects: nextRead })).toBe(9);
    expect(nextRead).toHaveBeenCalledTimes(1);
    expect(getHeaderPropertyCurrentValue({ ...input, isWithinClip: false })).toBe(0);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
