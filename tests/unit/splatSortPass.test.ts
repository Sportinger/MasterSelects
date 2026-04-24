import { describe, expect, it } from 'vitest';
import { buildBitonicSortPlan } from '../../src/engine/gaussian/core/SplatSortPass';

describe('buildBitonicSortPlan', () => {
  it('preserves power-of-two counts', () => {
    expect(buildBitonicSortPlan(1024)).toEqual({
      visibleCount: 1024,
      paddedCount: 1024,
      workgroupCount: 4,
    });
  });

  it('pads non-power-of-two counts for the GPU bitonic network', () => {
    expect(buildBitonicSortPlan(257)).toEqual({
      visibleCount: 257,
      paddedCount: 512,
      workgroupCount: 2,
    });
  });

  it('handles the large-splat regression case without truncating the sort dispatch', () => {
    const plan = buildBitonicSortPlan(149477160);
    expect(plan.visibleCount).toBe(149477160);
    expect(plan.paddedCount).toBe(268435456);
    expect(plan.workgroupCount).toBe(Math.ceil(268435456 / 256));
  });
});
