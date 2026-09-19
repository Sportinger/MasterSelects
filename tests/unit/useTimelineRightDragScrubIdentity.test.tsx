import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineRightDragScrub } from '../../src/components/timeline/hooks/useTimelineRightDragScrub';

type RightDragScrubProps = Parameters<typeof useTimelineRightDragScrub>[0];

const stableProps: Omit<RightDragScrubProps, 'handleClipMouseDown' | 'isExporting'> = {
  timelineRef: { current: null },
  scrollX: 0,
  duration: 10,
  isPlaying: false,
  isRamPreviewing: false,
  pixelToTime: (pixel) => pixel,
  pause: () => undefined,
  cancelRamPreview: () => undefined,
  setDraggingPlayhead: () => undefined,
  setPlayheadPosition: () => undefined,
  closeTimelineContextMenus: () => undefined,
  setEmptyContextMenu: () => undefined,
  openClipContextMenu: () => undefined,
};

describe('useTimelineRightDragScrub callback identity', () => {
  it('uses the updated scroll offset during an ongoing scrub and preserves single right clicks', () => {
    const timeline = document.createElement('div');
    timeline.getBoundingClientRect = () => ({ left: 0 } as DOMRect);
    const setPlayheadPosition = vi.fn();
    const setDraggingPlayhead = vi.fn();
    const setEmptyContextMenu = vi.fn();
    const { result, rerender } = renderHook(({ scrollX }) => useTimelineRightDragScrub({
      ...stableProps,
      timelineRef: { current: timeline },
      duration: 1000,
      scrollX,
      isExporting: false,
      handleClipMouseDown: vi.fn(),
      setPlayheadPosition,
      setDraggingPlayhead,
      setEmptyContextMenu,
    }), { initialProps: { scrollX: 0 } });
    const event = {
      button: 2, clientX: 100, clientY: 50,
      stopPropagation: vi.fn(), preventDefault: vi.fn(),
    } as unknown as ReactMouseEvent;

    act(() => result.current.handleEmptyTimelineMouseDown(event, 'video-1', 100));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { buttons: 2, clientX: 102, clientY: 50 })));
    expect(setPlayheadPosition).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { button: 2 })));
    act(() => result.current.handleEmptyTimelineContextMenu(event, 'video-1', 100));
    expect(setEmptyContextMenu).toHaveBeenCalledWith({ x: 100, y: 50, time: 100, trackId: 'video-1' });

    act(() => result.current.handleEmptyTimelineMouseDown(event, 'video-1', 100));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { buttons: 2, clientX: 150, clientY: 50 })));
    expect(setPlayheadPosition).toHaveBeenLastCalledWith(150);
    rerender({ scrollX: 200 });
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { buttons: 2, clientX: 160, clientY: 50 })));
    expect(setPlayheadPosition).toHaveBeenLastCalledWith(360);
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { button: 2 })));
    expect(setDraggingPlayhead).toHaveBeenLastCalledWith(false);
  });

  it('keeps track mouse handlers stable while reading current committed dependencies', () => {
    const initialClipMouseDown = vi.fn();
    const replacementClipMouseDown = vi.fn();
    const { result, rerender } = renderHook(
      ({ handleClipMouseDown, isExporting }) => useTimelineRightDragScrub({
        ...stableProps,
        handleClipMouseDown,
        isExporting,
      }),
      {
        initialProps: {
          handleClipMouseDown: initialClipMouseDown,
          isExporting: false,
        },
      },
    );
    const initialEmptyMouseDown = result.current.handleEmptyTimelineMouseDown;
    const initialTimelineClipMouseDown = result.current.handleTimelineClipMouseDown;

    rerender({
      handleClipMouseDown: replacementClipMouseDown,
      isExporting: true,
    });

    expect(result.current.handleEmptyTimelineMouseDown).toBe(initialEmptyMouseDown);
    expect(result.current.handleTimelineClipMouseDown).toBe(initialTimelineClipMouseDown);

    const leftClick = { button: 0 } as ReactMouseEvent;
    result.current.handleTimelineClipMouseDown(leftClick, 'clip-1');
    expect(replacementClipMouseDown).toHaveBeenCalledWith(leftClick, 'clip-1');
    expect(initialClipMouseDown).not.toHaveBeenCalled();

    const rightClick = {
      button: 2,
      stopPropagation: vi.fn(),
    } as unknown as ReactMouseEvent;
    result.current.handleEmptyTimelineMouseDown(rightClick, 'track-1', 3);
    expect(rightClick.stopPropagation).not.toHaveBeenCalled();
  });
});
