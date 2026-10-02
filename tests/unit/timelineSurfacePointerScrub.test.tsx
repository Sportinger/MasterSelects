import { act, cleanup, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const timeline = vi.hoisted(() => ({ isDraggingPlayhead: false }));
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => timeline },
}));

import { useTimelineSurfacePointer } from '../../src/components/timeline/hooks/useTimelineSurfacePointer';

function setup(activeTimelineToolId = 'select') {
  const element = document.createElement('div');
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 50, width: 800, top: 0, right: 850, bottom: 300, height: 300, x: 50, y: 0,
    toJSON: () => ({}),
  });
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => true);
  element.releasePointerCapture = vi.fn();
  const setScrollX = vi.fn();
  const renderCount = vi.fn();
  const view = renderHook(() => {
    renderCount();
    return useTimelineSurfacePointer({
      trackLanesRef: { current: element }, timelineBodyRef: { current: element },
      activeTimelineToolId, timelineToolCursor: 'default', duration: 100,
      scrollX: 200, zoom: 20, trackHeaderWidth: 50, isClipInteractionActive: false,
      setZoom: vi.fn(), setScrollX,
    });
  });
  const pointer = (clientX: number) => ({
    clientX, pointerId: 1, button: 0, buttons: 1,
    target: element, currentTarget: element,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  }) as unknown as ReactPointerEvent<HTMLDivElement>;
  const move = (clientX: number) => act(() => view.result.current.handleTimelinePointerMove(pointer(clientX)));
  return { ...view, pointer, move, measure, renderCount, setScrollX };
}

beforeEach(() => { timeline.isDraggingPlayhead = false; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Timeline pointer hover during scrubbing', () => {
  it('does not rerender the editor for scrub pointer moves, including before drag-start commits', () => {
    const view = setup();
    view.move(100);
    expect(view.result.current.timelinePointerX).toBe(50);
    const renderedBeforeScrub = view.renderCount.mock.calls.length;
    view.measure.mockClear();

    // Changing the live drag flag does not rerender this hook. A stale prop
    // guard would miss the first pointer events after the ruler is pressed.
    timeline.isDraggingPlayhead = true;
    for (const x of [120, 160, 250, 180, 95]) view.move(x);

    expect(view.renderCount).toHaveBeenCalledTimes(renderedBeforeScrub);
    expect(view.measure).not.toHaveBeenCalled();
    expect(view.result.current.timelinePointerX).toBe(50);
    timeline.isDraggingPlayhead = false;
    view.move(300);
    expect(view.result.current.timelinePointerX).toBe(250);
    expect(view.renderCount).toHaveBeenCalledTimes(renderedBeforeScrub + 1);
  });

  it('clears hover on leaving during a scrub and resumes it after release', () => {
    const view = setup();
    view.move(100);
    timeline.isDraggingPlayhead = true;
    act(() => view.result.current.handleTimelinePointerLeave());
    expect(view.result.current.timelinePointerX).toBeNull();
    const rendersAfterLeave = view.renderCount.mock.calls.length;
    view.move(500);
    expect(view.renderCount).toHaveBeenCalledTimes(rendersAfterLeave);
    timeline.isDraggingPlayhead = false;
    view.move(600);
    expect(view.result.current.timelinePointerX).toBe(550);
  });

  it('preserves hand-tool panning and pointer release', () => {
    const view = setup('hand');
    act(() => view.result.current.handleTimelinePointerDown(view.pointer(400)));
    expect(view.result.current.timelineSurfaceCursor).toBe('grabbing');
    view.move(430);
    expect(view.setScrollX).toHaveBeenCalledWith(170);
    act(() => view.result.current.handleTimelinePointerUp(view.pointer(430)));
    expect(view.result.current.timelineSurfaceCursor).toBe('default');
    view.setScrollX.mockClear();
    view.move(450);
    expect(view.setScrollX).not.toHaveBeenCalled();
    expect(view.result.current.timelinePointerX).toBe(400);
  });
});
