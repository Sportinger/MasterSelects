import { describe, expect, it } from 'vitest';
import { getKeyframeSegmentIndex } from '../../src/components/timeline/utils/keyframeSegmentIndex';

describe('keyframe segment ordering', () => {
  it('resolves outgoing segments and the final incoming easing target independently per property', () => {
    const keys = [
      { id: 'last', property: 'rotation.x', time: 5 },
      { id: 'single', property: 'opacity', time: 2 },
      { id: 'first', property: 'rotation.x', time: 0 },
      { id: 'middle', property: 'rotation.x', time: 2 },
    ];
    const index = getKeyframeSegmentIndex(keys);
    expect([...index.outgoingIds]).toEqual(['first', 'middle']);
    expect(index.easingTargets.get('last')?.id).toBe('middle');
    expect(index.easingTargets.get('middle')?.id).toBe('middle');
    expect(index.easingTargets.get('single')?.id).toBe('single');
    expect(keys[0].id).toBe('last');
  });

  it('reuses the immutable array index but recalculates ordering after a move', () => {
    const keys = [{ id: 'a', property: 'rotation.x', time: 0 }, { id: 'b', property: 'rotation.x', time: 1 }];
    const first = getKeyframeSegmentIndex(keys);
    expect(getKeyframeSegmentIndex(keys)).toBe(first);
    const moved = [keys[0], { ...keys[1], time: -1 }];
    expect(getKeyframeSegmentIndex(moved).outgoingIds.has('a')).toBe(false);
    expect(getKeyframeSegmentIndex(moved).easingTargets.get('a')?.id).toBe('b');
  });

  it('keeps source reads bounded for a six-channel, 3000-frame camera solve', () => {
    let reads = 0;
    const keys = Array.from({ length: 18000 }, (_, i) => ({
      id: `key-${i}`,
      get property() { reads++; return `channel-${i % 6}`; },
      time: Math.floor(i / 6) / 60,
    }));
    for (const key of keys) getKeyframeSegmentIndex(keys).outgoingIds.has(key.id);
    expect(reads).toBeLessThan(keys.length * 3);
    expect(getKeyframeSegmentIndex(keys).outgoingIds.size).toBe(keys.length - 6);
  });
});
