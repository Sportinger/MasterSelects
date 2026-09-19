import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const timelineState = vi.hoisted(() => ({
  clips: [],
  tracks: [],
  selectedClipIds: new Set<string>(),
  primarySelectedClipId: null,
  playheadPosition: 0,
  selectClip: vi.fn(),
  setDraggingPlayhead: vi.fn(),
  setPlayheadPosition: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: (selector: (state: typeof timelineState) => unknown) => selector(timelineState),
}));

import { ColorCompactTimeline } from '../../src/components/panels/color-workspace/ColorCompactTimeline';

function preparePointerCapture(element: HTMLElement) {
  Object.assign(element, {
    getBoundingClientRect: () => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 238,
      top: 0,
      width: 238,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });
}

describe('ColorCompactTimeline scrubbing', () => {
  it('marks lane pointer movement as an interactive playhead drag', () => {
    const { unmount } = render(<ColorCompactTimeline />);
    const timeline = screen.getByLabelText('Compact color timeline');
    preparePointerCapture(timeline);

    fireEvent.pointerDown(timeline, { button: 0, clientX: 138, pointerId: 7 });
    fireEvent.pointerMove(timeline, { clientX: 188, pointerId: 7 });
    fireEvent.pointerUp(timeline, { clientX: 188, pointerId: 7 });

    expect(timelineState.setDraggingPlayhead).toHaveBeenNthCalledWith(1, true);
    expect(timelineState.setDraggingPlayhead).toHaveBeenNthCalledWith(2, false);
    expect(timelineState.setPlayheadPosition).toHaveBeenCalledTimes(2);

    timelineState.setDraggingPlayhead.mockClear();
    unmount();
  });

  it('clears the playhead drag state when the panel unmounts mid-scrub', () => {
    const { unmount } = render(<ColorCompactTimeline />);
    const timeline = screen.getByLabelText('Compact color timeline');
    preparePointerCapture(timeline);

    fireEvent.pointerDown(timeline, { button: 0, clientX: 138, pointerId: 11 });
    unmount();

    expect(timelineState.setDraggingPlayhead).toHaveBeenLastCalledWith(false);
  });
});
