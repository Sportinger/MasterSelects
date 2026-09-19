import { renderHook } from '@testing-library/react';
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
