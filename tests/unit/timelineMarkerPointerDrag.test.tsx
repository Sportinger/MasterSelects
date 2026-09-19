import type { PointerEvent as ReactPointerEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMarkerDrag } from '../../src/components/timeline/hooks/useMarkerDrag';
import { usePlayheadDrag } from '../../src/components/timeline/hooks/usePlayheadDrag';

function touchPointerEvent(
  type: string,
  init: MouseEventInit & { pointerId: number },
): PointerEvent {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: init.pointerId },
    pointerType: { value: 'touch' },
  });
  return event;
}

function reactTouchPointerDown(pointerId: number, clientX: number): ReactPointerEvent<HTMLElement> {
  return {
    button: 0,
    clientX,
    currentTarget: { setPointerCapture: vi.fn() },
    isPrimary: true,
    pointerId,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function timelineElement(): HTMLDivElement {
  const timeline = document.createElement('div');
  vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 1000,
    width: 1000,
  } as DOMRect);
  return timeline;
}

describe('timeline ruler marker pointer dragging', () => {
  it('moves a timeline marker from a touch pointer stream', () => {
    const timeline = timelineElement();
    const moveMarker = vi.fn();
    const { result } = renderHook(() => useMarkerDrag({
      timelineRef: { current: timeline },
      timelineBodyRef: { current: timeline },
      markers: [{ id: 'marker-1', time: 2, label: 'Marker', color: '#2997E5' }],
      scrollX: 0,
      snappingEnabled: false,
      duration: 10,
      playheadPosition: 0,
      inPoint: null,
      outPoint: null,
      pixelToTime: (pixel) => pixel / 100,
      getSnapTargetTimes: () => [],
      moveMarker,
      addMarker: vi.fn(),
    }));

    act(() => {
      result.current.handleTimelineMarkerPointerDown(
        reactTouchPointerDown(7, 200),
        'marker-1',
      );
    });
    act(() => {
      document.dispatchEvent(touchPointerEvent('pointermove', {
        buttons: 1,
        clientX: 500,
        pointerId: 7,
      }));
    });

    expect(moveMarker).toHaveBeenLastCalledWith('marker-1', 5);

    act(() => {
      document.dispatchEvent(touchPointerEvent('pointerup', {
        clientX: 500,
        pointerId: 7,
      }));
    });
    expect(result.current.timelineMarkerDrag).toBeNull();
  });

  it('moves an In point from its ruler flag with touch', () => {
    const timeline = timelineElement();
    const setInPoint = vi.fn();
    const { result } = renderHook(() => usePlayheadDrag({
      timelineRef: { current: timeline },
      scrollX: 0,
      duration: 10,
      inPoint: 2,
      outPoint: 8,
      isRamPreviewing: false,
      isPlaying: false,
      isExporting: false,
      setPlayheadPosition: vi.fn(),
      setDraggingPlayhead: vi.fn(),
      setInPoint,
      setOutPoint: vi.fn(),
      cancelRamPreview: vi.fn(),
      pause: vi.fn(),
      pixelToTime: (pixel) => pixel / 100,
    }));

    act(() => {
      result.current.handleMarkerPointerDown(reactTouchPointerDown(9, 200), 'in');
    });
    act(() => {
      document.dispatchEvent(touchPointerEvent('pointermove', {
        buttons: 1,
        clientX: 500,
        pointerId: 9,
      }));
    });

    expect(setInPoint).toHaveBeenLastCalledWith(5);

    act(() => {
      document.dispatchEvent(touchPointerEvent('pointerup', {
        clientX: 500,
        pointerId: 9,
      }));
    });
    expect(result.current.markerDrag).toBeNull();
  });
});
