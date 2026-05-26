import { describe, expect, it } from 'vitest';
import { createTimelineGridPlan, formatTimelineTimecode } from '../../src/components/timeline/utils/timelineGrid';

describe('timeline grid planner', () => {
  it('uses independent frame lines when frames are visually resolvable', () => {
    const plan = createTimelineGridPlan({ zoom: 300, frameRate: 30 });

    expect(plan.mode).toBe('frame');
    expect(plan.minorIntervalSeconds).toBeCloseTo(1 / 30);
    expect(plan.minorIntervalPixels).toBeCloseTo(10);
    expect(plan.labelMode).toBe('timecode');
  });

  it('uses time ticks when frames would be too dense', () => {
    const plan = createTimelineGridPlan({ zoom: 50, frameRate: 30 });

    expect(plan.mode).toBe('time');
    expect(plan.minorIntervalPixels).toBeGreaterThanOrEqual(40);
    expect(plan.labelMode).toBe('time');
  });

  it('honors fractional composition frame rates for frame spacing', () => {
    const plan = createTimelineGridPlan({ zoom: 300, frameRate: 23.976 });

    expect(plan.mode).toBe('frame');
    expect(plan.minorIntervalSeconds).toBeCloseTo(1 / 23.976);
  });

  it('formats frame-mode labels as timeline timecode', () => {
    expect(formatTimelineTimecode(1 + 5 / 30, 30)).toBe('00:01:05');
  });
});
