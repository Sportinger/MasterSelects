import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';
import { usePlayheadSnap } from '../../src/components/timeline/hooks/usePlayheadSnap';
import { useTimelineHelpers } from '../../src/components/timeline/hooks/useTimelineHelpers';

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

  it('snaps the playhead to the last visible frame instead of the exclusive clip end', () => {
    const timeline = document.createElement('div');
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 1000, width: 1000,
    } as DOMRect);
    const lastFrameTime = 5 - 1 / 24;
    const getSnapTargetTimes = vi.fn((mode?: 'edge' | 'last-frame') => (
      mode === 'last-frame' ? [lastFrameTime] : [5]
    ));
    const setPlayheadPosition = vi.fn();

    renderHook(() => usePlayheadSnap({
      isDraggingPlayhead: true,
      timelineRef: { current: timeline },
      scrollX: 0,
      duration: 10,
      snappingEnabled: true,
      pixelToTime: (pixel) => pixel / 100,
      getSnapTargetTimes,
      setPlayheadPosition,
      setScrollX: vi.fn(),
      setDraggingPlayhead: vi.fn(),
      zoom: 100,
    }));

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: lastFrameTime * 100 }));
    });

    expect(getSnapTargetTimes).toHaveBeenCalledWith('last-frame');
    expect(setPlayheadPosition).toHaveBeenLastCalledWith(lastFrameTime);
  });

  it('keeps edit-edge snap targets exact while resolving playhead ends from composition fps', () => {
    const clip = createMockClip({ id: 'clip-1', startTime: 1, duration: 4 });
    const shortClip = createMockClip({ id: 'clip-short', startTime: 6, duration: 0.01 });
    const terminalKeyframe = createMockKeyframe({ clipId: clip.id, time: clip.duration });
    const { result } = renderHook(() => useTimelineHelpers({
      zoom: 100,
      frameRate: 24,
      clips: [clip, shortClip],
      getClipKeyframes: (clipId) => clipId === clip.id ? [terminalKeyframe] : [],
    }));

    expect(result.current.getSnapTargetTimes()).toEqual([1, 5, 5, 6, 6.01]);
    expect(result.current.getSnapTargetTimes('last-frame')).toEqual([
      1,
      5 - 1 / 24,
      5 - 1 / 24,
      6,
      6,
    ]);
  });
});
