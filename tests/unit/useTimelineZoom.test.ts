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
import { useTimelineStore } from '../../src/stores/timeline';

afterEach(() => {
  vi.useRealTimers();
});

function pointerEvent(type: string, init: MouseEventInit & { pointerId: number; pointerType: string }): PointerEvent {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  return event;
}

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

  it('caps a content-expanded detached timeline to the visible popup viewport', () => {
    const body = document.createElement('div');
    const lanes = document.createElement('div');
    lanes.className = 'timeline-lane-reference';
    Object.defineProperty(lanes, 'clientWidth', { value: 22_536 });
    lanes.getBoundingClientRect = () => ({ left: 210 } as DOMRect);
    body.appendChild(lanes);
    document.body.appendChild(body);
    const setZoom = vi.fn();

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 20,
      scrollX: 0,
      scrollY: 0,
      duration: 68.2,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom,
      setScrollX: vi.fn(),
      setScrollY: vi.fn(),
    }));

    expect(setZoom).not.toHaveBeenCalled();
    unmount();
    body.remove();
  });

  it('zooms around the moving midpoint of a two-touch pinch', () => {
    const body = document.createElement('div');
    const lanes = document.createElement('div');
    lanes.className = 'track-lanes';
    Object.defineProperty(lanes, 'clientWidth', { value: 800 });
    lanes.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    body.appendChild(lanes);
    document.body.appendChild(body);
    const setZoom = vi.fn();
    const setScrollX = vi.fn();

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 10,
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

    body.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100,
    }));
    body.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 100,
    }));
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 2, pointerType: 'touch', clientX: 700, clientY: 100,
    }));

    expect(setZoom).toHaveBeenLastCalledWith(20);
    expect(setScrollX).toHaveBeenLastCalledWith(200);
    unmount();
    body.remove();
  });

  it('pans an empty timeline lane with one finger', () => {
    const body = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'timeline-track-section video';
    section.dataset.sectionKind = 'video';
    const lanes = document.createElement('div');
    lanes.className = 'timeline-section-tracks track-lanes';
    Object.defineProperty(lanes, 'clientWidth', { value: 800 });
    lanes.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    const lane = document.createElement('div');
    lane.className = 'track-lane video';
    lane.dataset.trackId = 'touch-empty-track';
    lanes.appendChild(lane);
    const viewport = document.createElement('div');
    viewport.className = 'timeline-section-viewport';
    viewport.appendChild(lanes);
    section.appendChild(viewport);
    body.appendChild(section);
    document.body.appendChild(body);
    const setScrollX = vi.fn();
    const onSectionTouchPan = vi.fn();
    viewport.addEventListener('wheel', onSectionTouchPan);

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 20,
      scrollX: 300,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom: vi.fn(),
      setScrollX,
      setScrollY: vi.fn(),
    }));

    lane.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 160,
    }));
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1, pointerType: 'touch', clientX: 450, clientY: 130,
    }));

    expect(setScrollX).toHaveBeenLastCalledWith(350);
    expect((onSectionTouchPan.mock.calls.at(-1)?.[0] as WheelEvent).deltaY).toBe(30);
    unmount();
    body.remove();
  });

  it('scales all tracks with one vertical finger drag over the track headers', () => {
    const body = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'timeline-track-section video';
    section.dataset.sectionKind = 'video';
    const headers = document.createElement('div');
    headers.className = 'track-headers';
    const lanes = document.createElement('div');
    lanes.className = 'timeline-section-tracks track-lanes';
    Object.defineProperty(lanes, 'clientWidth', { value: 800 });
    lanes.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    const lane = document.createElement('div');
    lane.className = 'track-lane video';
    lane.dataset.trackId = 'touch-scale-track';
    lanes.appendChild(lane);
    section.appendChild(headers);
    section.appendChild(lanes);
    body.appendChild(section);
    document.body.appendChild(body);
    const scaleTracksOfType = vi
      .spyOn(useTimelineStore.getState(), 'scaleTracksOfType')
      .mockImplementation(() => {});
    const onSynchronousTrackScaleStart = vi.fn();
    const onSynchronousTrackScaleEnd = vi.fn();

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 10,
      scrollX: 0,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom: vi.fn(),
      setScrollX: vi.fn(),
      setScrollY: vi.fn(),
      onSynchronousTrackScaleStart,
      onSynchronousTrackScaleEnd,
    }));

    headers.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200,
    }));
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 160,
    }));

    expect(scaleTracksOfType).toHaveBeenNthCalledWith(1, 'video', 0);
    expect(scaleTracksOfType).toHaveBeenNthCalledWith(2, 'video', 14);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 240,
    }));
    expect(scaleTracksOfType).toHaveBeenLastCalledWith('video', -28);
    expect(onSynchronousTrackScaleStart).toHaveBeenCalledTimes(1);
    expect(onSynchronousTrackScaleStart).toHaveBeenCalledWith('video');

    window.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 240,
    }));
    expect(onSynchronousTrackScaleEnd).toHaveBeenCalledTimes(1);
    unmount();
    scaleTracksOfType.mockRestore();
    body.remove();
  });

  it('keeps a two-finger gesture over the clip lanes assigned to timeline zoom', () => {
    const body = document.createElement('div');
    const section = document.createElement('div');
    section.className = 'timeline-track-section video';
    section.dataset.sectionKind = 'video';
    const lanes = document.createElement('div');
    lanes.className = 'timeline-section-tracks track-lanes';
    Object.defineProperty(lanes, 'clientWidth', { value: 800 });
    lanes.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    const lane = document.createElement('div');
    lane.className = 'track-lane video';
    lane.dataset.trackId = 'touch-zoom-track';
    lanes.appendChild(lane);
    section.appendChild(lanes);
    body.appendChild(section);
    document.body.appendChild(body);
    const setZoom = vi.fn();
    const scaleTracksOfType = vi
      .spyOn(useTimelineStore.getState(), 'scaleTracksOfType')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() => useTimelineZoom({
      timelineBodyRef: { current: body },
      zoom: 10,
      scrollX: 0,
      scrollY: 0,
      duration: 100,
      playheadPosition: 0,
      contentHeight: 0,
      viewportHeight: 0,
      trackSnapPositions: [],
      setZoom,
      setScrollX: vi.fn(),
      setScrollY: vi.fn(),
    }));

    lane.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200,
    }));
    lane.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 2, pointerType: 'touch', clientX: 700, clientY: 200,
    }));
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 2, pointerType: 'touch', clientX: 700, clientY: 140,
    }));

    expect(setZoom).toHaveBeenCalled();
    expect(scaleTracksOfType).not.toHaveBeenCalled();
    unmount();
    scaleTracksOfType.mockRestore();
    body.remove();
  });
});
