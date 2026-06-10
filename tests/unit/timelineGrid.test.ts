import { describe, expect, it } from 'vitest';
import {
  alignTimelineGridPixel,
  createTimelineGridPlan,
  formatTimelineFrameNumber,
  formatTimelineTimecode,
} from '../../src/components/timeline/utils/timelineGrid';

describe('timeline grid planner', () => {
  it('uses independent frame lines when frames are visually resolvable', () => {
    const plan = createTimelineGridPlan({ zoom: 480, frameRate: 30 });

    expect(plan.mode).toBe('frame');
    expect(plan.minorIntervalSeconds).toBeCloseTo(1 / 30);
    expect(plan.minorIntervalPixels).toBeCloseTo(16);
    expect(plan.frameIntervalPixels).toBeCloseTo(16);
    expect(plan.frameGridOpacity).toBe(1);
    expect(plan.timeGridOpacity).toBe(0);
    expect(plan.labelMode).toBe('timecode');
  });

  it('uses time ticks when frames would be too dense', () => {
    const plan = createTimelineGridPlan({ zoom: 50, frameRate: 30 });

    expect(plan.mode).toBe('time');
    expect(plan.minorIntervalPixels).toBeGreaterThanOrEqual(40);
    expect(plan.frameGridOpacity).toBe(0);
    expect(plan.timeGridOpacity).toBe(1);
    expect(plan.labelMode).toBe('time');
  });

  it('omits frame grid lines below the anti-aliasing threshold', () => {
    const plan = createTimelineGridPlan({ zoom: 270, frameRate: 30 });

    expect(plan.mode).toBe('time');
    expect(plan.frameIntervalPixels).toBeCloseTo(9);
    expect(plan.timeIntervalPixels).toBeGreaterThan(plan.frameIntervalPixels);
    expect(plan.frameGridOpacity).toBe(0);
    expect(plan.timeGridOpacity).toBe(1);
  });

  it('fades frame grid visibility in before switching to frame labels', () => {
    const plan = createTimelineGridPlan({ zoom: 390, frameRate: 30 });

    expect(plan.mode).toBe('time');
    expect(plan.frameIntervalPixels).toBeCloseTo(13);
    expect(plan.timeIntervalPixels).toBeGreaterThan(plan.frameIntervalPixels);
    expect(plan.frameGridOpacity).toBeGreaterThan(0);
    expect(plan.frameGridOpacity).toBeLessThan(1);
    expect(plan.timeGridOpacity).toBeGreaterThan(0);
    expect(plan.timeGridOpacity).toBeLessThan(1);
    expect(plan.frameGridOpacity + plan.timeGridOpacity).toBeCloseTo(1);
  });

  it('honors fractional composition frame rates for frame spacing', () => {
    const plan = createTimelineGridPlan({ zoom: 480, frameRate: 23.976 });

    expect(plan.mode).toBe('frame');
    expect(plan.minorIntervalSeconds).toBeCloseTo(1 / 23.976);
  });

  it('formats frame-mode labels as timeline timecode', () => {
    expect(formatTimelineTimecode(1 + 5 / 30, 30)).toBe('00:01:05');
  });

  it('formats ruler labels as absolute frame numbers', () => {
    expect(formatTimelineFrameNumber(1 + 5 / 30, 30)).toBe('35');
  });

  it('aligns grid coordinates to device pixels', () => {
    expect(alignTimelineGridPixel(10.26, 2)).toBe(10.5);
    expect(alignTimelineGridPixel(10.24, 2)).toBe(10);
  });
});
