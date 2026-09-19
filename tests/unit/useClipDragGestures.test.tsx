import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClipDrag } from '../../src/components/timeline/hooks/useClipDrag';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function mountDrag({
  clips = [createMockClip({ id: 'lead', trackId: 'video-1', startTime: 2, duration: 2, source: { type: 'video' } })],
  selectedClipIds = new Set<string>(),
  snappingEnabled = false,
} = {}) {
  const tracks = ['video-3', 'video-2', 'video-1', 'audio-1'].map(id => createMockTrack({
    id, type: id.startsWith('video') ? 'video' : 'audio', height: 60,
  }));
  useTimelineStore.setState({ clips, tracks, selectedClipIds, expandedTracks: new Set(), clipKeyframes: new Map() });
  const timeline = document.createElement('div');
  timeline.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
  const clipElement = document.createElement('div');
  clipElement.getBoundingClientRect = () => ({ left: 200, top: 144, width: 200, height: 60 } as DOMRect);
  const hoveredLane = document.createElement('div');
  hoveredLane.className = 'track-lane';
  hoveredLane.dataset.trackId = 'video-1';
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hoveredLane) });
  const applyOperation = vi.fn(() => ({ success: true, changedClipIds: [], warnings: [] }));
  const getSnappedPosition = vi.fn((_clipId: string, startTime: number) => ({ startTime, snapped: false, snapEdgeTime: startTime }));
  const resistance = vi.fn((_clipId: string, startTime: number, _trackId: string) => ({ startTime, forcingOverlap: false }));
  const { result, unmount } = renderHook(() => useClipDrag({
    timelineRef: { current: timeline }, trackLanesRef: { current: timeline },
    clips, tracks, clipMap: new Map(clips.map(clip => [clip.id, clip])), selectedClipIds,
    scrollX: 0, frameRate: 25, snappingEnabled, isExporting: false, activeTimelineToolId: 'select',
    selectClip: useTimelineStore.getState().selectClip,
    applyTimelineEditOperation: applyOperation,
    openCompositionTab: vi.fn(), pixelToTime: pixel => pixel / 100,
    getRenderedTrackHeight: () => 60, getSnappedPosition,
    getPositionWithResistance: resistance,
  }));
  const pointerDown = () => act(() => result.current.handleClipMouseDown({
    button: 0, clientX: 225, clientY: 170, shiftKey: false, altKey: false,
    currentTarget: clipElement, nativeEvent: new MouseEvent('mousedown'),
    stopPropagation: vi.fn(), preventDefault: vi.fn(),
  } as unknown as ReactMouseEvent, 'lead'));
  const release = (clientX: number, clientY: number, trackId = 'video-1') => {
    hoveredLane.dataset.trackId = trackId;
    vi.advanceTimersByTime(400);
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { clientX, clientY })));
  };
  return { pointerDown, release, applyOperation, getSnappedPosition, resistance, unmount };
}

describe('timeline clip drag gestures', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([false, true])('does not move a clip after small click jitter (selected=%s)', selected => {
    const drag = mountDrag({ selectedClipIds: new Set(selected ? ['lead'] : []) });
    drag.pointerDown();
    drag.release(228, 173);
    expect(drag.applyOperation).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().clips[0].startTime).toBe(2);
    drag.unmount();
  });

  it('commits an intentional horizontal move after passing the drag threshold', () => {
    const drag = mountDrag();
    drag.pointerDown();
    drag.release(325, 170);
    expect(drag.applyOperation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'move-clips', moves: [{ clipId: 'lead', startTime: 3, trackId: 'video-1' }],
    }), expect.anything());
    drag.unmount();
  });

  it.each([false, true])('keeps the original time when changing layers (snapping=%s)', snappingEnabled => {
    const drag = mountDrag({ snappingEnabled });
    drag.getSnappedPosition.mockReturnValue({ startTime: 2.48, snapped: true, snapEdgeTime: 2.48 });
    drag.pointerDown();
    drag.release(265, 110, 'video-2');
    expect(drag.applyOperation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'move-clips', moves: [{ clipId: 'lead', startTime: 2, trackId: 'video-2' }],
    }), expect.anything());
    drag.unmount();
  });

  it('moves multiple selected clips to relative destination layers', () => {
    const clips: TimelineClip[] = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 2, duration: 2, source: { type: 'video' } }),
      createMockClip({ id: 'follower', trackId: 'video-2', startTime: 5, duration: 2, source: { type: 'video' } }),
    ];
    const drag = mountDrag({ clips, selectedClipIds: new Set(['lead', 'follower']) });
    drag.pointerDown();
    drag.release(225, 110, 'video-2');
    expect(drag.applyOperation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'move-clips', moves: [
        { clipId: 'lead', startTime: 2, trackId: 'video-2' },
        { clipId: 'follower', startTime: 5, trackId: 'video-3' },
      ],
    }), expect.anything());
    drag.unmount();
  });

  it('does not shift time to squeeze a vertical move into an occupied layer', () => {
    const drag = mountDrag();
    drag.resistance.mockImplementation((_id, startTime, trackId) => ({
      startTime: trackId === 'video-2' ? 3 : startTime, forcingOverlap: false,
    }));
    drag.pointerDown();
    drag.release(265, 110, 'video-2');
    expect(drag.applyOperation).not.toHaveBeenCalled();
    drag.unmount();
  });
});
