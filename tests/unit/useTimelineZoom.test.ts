import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTimelineZoomWheelMultiplier,
  useTimelineZoom,
} from '../../src/components/timeline/hooks/useTimelineZoom';
import {
  acquireExclusiveTimelineMutationLease,
  releaseExclusiveTimelineMutationLease,
} from '../../src/stores/timeline/exclusiveMutationLease';

afterEach(() => {
  vi.useRealTimers();
});

describe('getTimelineZoomWheelMultiplier', () => {
  it('uses larger zoom steps for larger wheel deltas', () => {
    const normal = getTimelineZoomWheelMultiplier(100, 120);
    const fast = getTimelineZoomWheelMultiplier(400, 120);

    expect(fast).toBeGreaterThan(normal);
  });

  it('boosts very rapid repeated wheel gestures', () => {
    const separated = getTimelineZoomWheelMultiplier(100, 120);
    const rapid = getTimelineZoomWheelMultiplier(100, 20);

    expect(rapid).toBeGreaterThan(separated);
  });

  it('does not zoom for a zero delta', () => {
    expect(getTimelineZoomWheelMultiplier(0, 20)).toBe(1);
  });

  it('defers the passive zoom clamp until an exclusive kernel edit releases its lease', () => {
    vi.useFakeTimers();
    const lease = acquireExclusiveTimelineMutationLease('timeline zoom regression');
    const setZoom = vi.fn();
    const setScrollX = vi.fn();

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: createRef<HTMLDivElement>(),
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom,
      setScrollX,
      setScrollY: vi.fn(),
    }));

    expect(setZoom).not.toHaveBeenCalled();
    releaseExclusiveTimelineMutationLease(lease);
    act(() => vi.advanceTimersByTime(50));
    expect(setZoom).toHaveBeenCalledWith(7);
    expect(setScrollX).not.toHaveBeenCalled();
    unmount();
  });
});
