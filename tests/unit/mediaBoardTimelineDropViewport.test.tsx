import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaBoardNodeMoveGesture } from '../../src/components/panels/media/board/useMediaBoardNodeMoveGesture';
import type { MediaBoardItem, MediaBoardNodePlacement } from '../../src/components/panels/media/board/types';
import { dispatchExternalDragBridgeEvent } from '../../src/components/timeline/utils/externalDragSession';

vi.mock('../../src/components/timeline/utils/externalDragSession', () => ({
  createExternalDragPayloadForProjectItem: () => ({ kind: 'media-file', fileId: 'media-a' }),
  dispatchExternalDragBridgeEvent: vi.fn(),
  setExternalDragPayload: vi.fn(),
  clearExternalDragPayload: vi.fn(),
}));

describe('media board timeline drop viewport', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('restores the starting board view after edge auto-pan and a timeline drop', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    const flushFrame = (time: number) => {
      const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time));
    };
    const canvas = document.createElement('div');
    canvas.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200 } as DOMRect);
    const timelineLane = document.createElement('div');
    timelineLane.className = 'track-lane'; timelineLane.dataset.trackId = 'video-1';
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (_x: number, y: number) => y < 100 ? timelineLane : canvas });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] });
    const item = { id: 'media-a', name: 'Video', type: 'video' } as MediaBoardItem;
    const layout = { x: 0, y: 0, width: 100, height: 80 };
    const placement = { item, layout, defaultLayout: layout, slotIndex: 0 } as MediaBoardNodePlacement;
    const viewport = { zoom: 1.5, panX: 30, panY: -20 };
    const viewportRef = { current: viewport };
    const applyPreview = vi.fn();
    const setViewport = vi.fn();
    const commitOrder = vi.fn();
    const { result, unmount } = renderHook(() => useMediaBoardNodeMoveGesture({
      activeCompositionId: 'comp-1', applyMediaBoardViewportPreview: applyPreview,
      boardAutoPanFrameRef: { current: null }, boardCanvasRef: { current: canvas },
      boardInteractionFrameRef: { current: null }, closeContextMenu: vi.fn(),
      commitMediaBoardOrderChange: commitOrder, getMediaBoardInsertTarget: () => null,
      getMediaBoardTopLevelMoveIds: ids => ids, getSlotGridProgress: () => 0,
      mediaBoardItemIds: new Set([item.id]),
      mediaBoardLayout: { placements: [placement], groups: [], insertGaps: [], slots: [] },
      mediaBoardPlacementsById: new Map([[item.id, placement]]), mediaBoardViewportRef: viewportRef,
      selectedIds: [item.id], setMediaBoardInsertionPreview: vi.fn(),
      setMediaBoardPerformanceMode: vi.fn(), setMediaBoardViewport: setViewport,
      suppressNextMediaBoardContextMenu: vi.fn(), updateMediaBoardInsertionPreview: () => null,
    }));
    act(() => result.current({ clientX: 200, clientY: 200 } as ReactMouseEvent, item));
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 105, clientY: 200 })); flushFrame(0); flushFrame(50); });
    expect(applyPreview.mock.calls.at(-1)?.[0].panX).toBeGreaterThan(viewport.panX);
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 0 }));
    });
    expect(dispatchExternalDragBridgeEvent).toHaveBeenCalledWith(expect.objectContaining({ phase: 'drop' }));
    expect(viewportRef.current).toEqual(viewport);
    expect(setViewport).toHaveBeenLastCalledWith(viewport);
    expect(applyPreview).toHaveBeenLastCalledWith(viewport);
    expect(commitOrder).not.toHaveBeenCalled();
    unmount();
  });
});
