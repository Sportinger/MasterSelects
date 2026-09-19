import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransitionsPanel } from '../../src/components/panels/TransitionsPanel';
import { useTransitionTouchDropBridge } from '../../src/components/timeline/hooks/useTransitionTouchDropBridge';
import {
  dispatchTransitionTouchDragBridgeEvent,
  getActiveTransitionDragData,
  parseTransitionDropData,
  setActiveTransitionDragData,
  TRANSITION_MIME_TYPE,
  TRANSITION_TOUCH_DRAG_BRIDGE_EVENT,
  type TransitionTouchDragBridgeEventDetail,
} from '../../src/components/timeline/transitionDragData';
import type { TimelineTrack } from '../../src/types/timeline';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

function dispatchTouchPointer(type: string, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 23 },
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
  });
  window.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  setActiveTransitionDragData(null);
  document.querySelectorAll('.transition-touch-drag-ghost').forEach((element) => element.remove());
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalElementFromPointDescriptor) {
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
});

describe('transition touch timeline drag', () => {
  it('starts a direct horizontal finger drag without waiting for the hold delay', () => {
    vi.useFakeTimers();
    render(<TransitionsPanel />);
    const transitionItem = screen.getByText('Dissolve').closest<HTMLElement>('.transition-item');
    expect(transitionItem).not.toBeNull();

    fireEvent.pointerDown(transitionItem!, {
      button: 0,
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch',
    });
    act(() => dispatchTouchPointer('pointermove', 28, 22));

    expect(getActiveTransitionDragData()).toMatchObject({ duration: 2 });
    expect(document.querySelector('.transition-touch-drag-ghost')).not.toBeNull();

    act(() => dispatchTouchPointer('pointerup', 36, 24));
    act(() => vi.advanceTimersByTime(150));
  });

  it('starts a direct finger drag in any direction from the transition preview', () => {
    vi.useFakeTimers();
    render(<TransitionsPanel />);
    const transitionItem = screen.getByText('Dissolve').closest<HTMLElement>('.transition-item');
    const preview = transitionItem?.querySelector<HTMLElement>('.transition-item-preview');
    expect(preview).not.toBeNull();

    fireEvent.pointerDown(preview!, {
      button: 0,
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch',
    });
    act(() => dispatchTouchPointer('pointermove', 12, 38));

    expect(getActiveTransitionDragData()).toMatchObject({ duration: 2 });
    expect(document.querySelector('.transition-touch-drag-ghost')).not.toBeNull();

    act(() => dispatchTouchPointer('pointerup', 14, 48));
    act(() => vi.advanceTimersByTime(150));
  });

  it('keeps an immediate vertical swipe on the card available for list scrolling', () => {
    vi.useFakeTimers();
    render(<TransitionsPanel />);
    const transitionItem = screen.getByText('Dissolve').closest<HTMLElement>('.transition-item');
    expect(transitionItem).not.toBeNull();

    fireEvent.pointerDown(transitionItem!, {
      button: 0,
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch',
    });
    act(() => dispatchTouchPointer('pointermove', 12, 32));

    expect(getActiveTransitionDragData()).toBeNull();
    expect(document.querySelector('.transition-touch-drag-ghost')).toBeNull();
  });

  it('starts a held touch drag from a transition card and publishes move and drop phases', () => {
    vi.useFakeTimers();
    const phases: TransitionTouchDragBridgeEventDetail[] = [];
    const bridgeListener = (event: Event) => {
      phases.push((event as CustomEvent<TransitionTouchDragBridgeEventDetail>).detail);
    };
    window.addEventListener(TRANSITION_TOUCH_DRAG_BRIDGE_EVENT, bridgeListener);

    render(<TransitionsPanel />);
    const transitionItem = screen.getByText('Dissolve').closest<HTMLElement>('.transition-item');
    expect(transitionItem).not.toBeNull();

    fireEvent.pointerDown(transitionItem!, {
      button: 0,
      clientX: 10,
      clientY: 20,
      isPrimary: true,
      pointerId: 23,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(140));
    act(() => dispatchTouchPointer('pointermove', 28, 42));

    expect(getActiveTransitionDragData()).toMatchObject({ duration: 2 });
    expect(phases.at(-1)).toMatchObject({ phase: 'move', clientX: 28, clientY: 42 });
    const dragGhost = document.querySelector<HTMLElement>('.transition-touch-drag-ghost');
    expect(dragGhost?.textContent).toContain('Dissolve');
    expect(dragGhost?.style.transform).toContain('translate3d');

    act(() => dispatchTouchPointer('pointerup', 36, 50));
    expect(phases.at(-1)).toMatchObject({ phase: 'drop', clientX: 36, clientY: 50 });
    expect(dragGhost?.classList.contains('is-dropping')).toBe(true);

    act(() => vi.advanceTimersByTime(0));
    expect(getActiveTransitionDragData()).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(document.querySelector('.transition-touch-drag-ghost')).toBeNull();

    window.removeEventListener(TRANSITION_TOUCH_DRAG_BRIDGE_EVENT, bridgeListener);
  });

  it('routes touch coordinates to the existing transition drop handlers', () => {
    const timelineElement = document.createElement('div');
    const trackLane = document.createElement('div');
    trackLane.className = 'track-lane';
    trackLane.dataset.trackId = 'video-1';
    timelineElement.appendChild(trackLane);
    document.body.appendChild(timelineElement);
    vi.spyOn(timelineElement, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 0,
      width: 600,
      height: 300,
      right: 700,
      bottom: 300,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => trackLane),
    });

    const timelineRef = createRef<HTMLDivElement>();
    timelineRef.current = timelineElement;
    const trackMap = new Map<string, TimelineTrack>([[
      'video-1',
      { id: 'video-1', name: 'Video 1', type: 'video', locked: false } as TimelineTrack,
    ]]);
    const onTransitionDragLeave = vi.fn();
    const onTransitionDragOver = vi.fn();
    const onTransitionDrop = vi.fn();

    const { unmount } = renderHook(() => useTransitionTouchDropBridge({
      isExporting: false,
      onTransitionDragLeave,
      onTransitionDragOver,
      onTransitionDrop,
      pixelToTime: (pixel) => pixel / 10,
      scrollX: 20,
      timelineRef,
      trackMap,
    }));
    setActiveTransitionDragData({ type: 'cross-dissolve', duration: 1.5 });

    act(() => dispatchTransitionTouchDragBridgeEvent({ phase: 'move', clientX: 150, clientY: 80 }));

    expect(onTransitionDragOver).toHaveBeenCalledOnce();
    const [dragEvent, trackId, pointerTime] = onTransitionDragOver.mock.calls[0];
    expect(trackId).toBe('video-1');
    expect(pointerTime).toBe(7);
    expect(parseTransitionDropData(dragEvent.dataTransfer.getData(TRANSITION_MIME_TYPE))).toEqual({
      type: 'cross-dissolve',
      duration: 1.5,
    });

    act(() => dispatchTransitionTouchDragBridgeEvent({ phase: 'drop', clientX: 160, clientY: 80 }));
    expect(onTransitionDrop).toHaveBeenCalledOnce();
    expect(onTransitionDrop.mock.calls[0][1]).toBe('video-1');
    expect(onTransitionDrop.mock.calls[0][2]).toBe(8);
    expect(onTransitionDragLeave).not.toHaveBeenCalled();

    unmount();
    timelineElement.remove();
  });
});
