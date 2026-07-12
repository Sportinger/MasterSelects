import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayheadSnap } from '../../src/components/timeline/hooks/usePlayheadSnap';

describe('usePlayheadSnap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps scrolling and scrubbing while a left-button drag stays at an edge', () => {
    const timeline = document.createElement('div');
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, width: 1000,
    } as DOMRect);
    const requestFrame = vi.fn<FrameRequestCallback, [FrameRequestCallback]>((callback) => {
      return callback as unknown as number;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const setPlayheadPosition = vi.fn();
    const setScrollX = vi.fn();
    const setDraggingPlayhead = vi.fn();
    renderHook(() => usePlayheadSnap({
      isDraggingPlayhead: true,
      timelineRef: { current: timeline },
      scrollX: 0,
      duration: 200,
      snappingEnabled: false,
      pixelToTime: (pixel) => pixel / 10,
      getSnapTargetTimes: () => [],
      setPlayheadPosition,
      setScrollX,
      setDraggingPlayhead,
      zoom: 10,
    }));

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 999 }));
      requestFrame.mock.calls.at(-1)?.[0](0);
      requestFrame.mock.calls.at(-1)?.[0](50);
    });
    const rightScroll = setScrollX.mock.calls.at(-1)?.[0] ?? 0;
    expect(rightScroll).toBeGreaterThan(0);
    expect(setPlayheadPosition).toHaveBeenLastCalledWith(expect.any(Number));

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: 1 }));
      requestFrame.mock.calls.at(-1)?.[0](100);
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(setScrollX.mock.calls.at(-1)?.[0]).toBeLessThan(rightScroll);
    expect(setDraggingPlayhead).toHaveBeenCalledWith(false);
  });
});
