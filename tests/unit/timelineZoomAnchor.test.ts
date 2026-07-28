import { describe, expect, it } from 'vitest';
import { calculateTimelineZoomScrollX } from '../../src/components/timeline/utils/timelineZoomAnchor';

describe('calculateTimelineZoomScrollX', () => {
  it('keeps timeline start visible while zooming in near the left edge', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 0,
      zoom: 10,
      nextZoom: 20,
      pointerX: 24,
      viewportWidth: 1000,
      maxScrollX: 1000,
    })).toBe(0);
  });

  it('preserves the current left time boundary away from timeline start', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 100,
      zoom: 10,
      nextZoom: 20,
      pointerX: 40,
      viewportWidth: 1000,
      maxScrollX: 2000,
    })).toBe(200);
  });

  it('preserves the visible right time boundary while zooming in near the right edge', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 100,
      zoom: 10,
      nextZoom: 20,
      pointerX: 970,
      viewportWidth: 1000,
      maxScrollX: 2000,
    })).toBe(1200);
  });

  it('clamps the calculated anchor to the available scroll range', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 100,
      zoom: 10,
      nextZoom: 20,
      pointerX: 995,
      viewportWidth: 1000,
      maxScrollX: 500,
    })).toBe(500);
  });

  it('keeps exact cursor anchoring in the middle of the viewport', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 100,
      zoom: 10,
      nextZoom: 20,
      pointerX: 500,
      viewportWidth: 1000,
      maxScrollX: 2000,
    })).toBe(700);
  });

  it('keeps exact cursor anchoring when zooming out near an edge', () => {
    expect(calculateTimelineZoomScrollX({
      scrollX: 200,
      zoom: 20,
      nextZoom: 10,
      pointerX: 20,
      viewportWidth: 1000,
      maxScrollX: 1000,
    })).toBe(90);
  });
});
