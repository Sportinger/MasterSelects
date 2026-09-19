import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaPanelTouchTimelineDrag } from '../../src/components/panels/media/panel/useMediaPanelTouchTimelineDrag';
import { useTouchContextMenu } from '../../src/hooks/useTouchContextMenu';
import { useDockStore } from '../../src/stores/dockStore';
import { useMediaStore, type ProjectItem } from '../../src/stores/mediaStore';
import {
  clearExternalDragPayload,
  EXTERNAL_DRAG_BRIDGE_EVENT,
  getExternalDragPayload,
  type ExternalDragBridgeEventDetail,
} from '../../src/components/timeline/utils/externalDragSession';

function dispatchTouchPointer(type: string, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 17 },
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
  });
  window.dispatchEvent(event);
}

afterEach(() => {
  clearExternalDragPayload();
  document.querySelectorAll('.media-touch-drag-ghost').forEach((element) => element.remove());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('MediaPanel touch timeline drag', () => {
  it('reserves small finger jitter for the long-press context menu', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const setInternalDragId = vi.fn();
    const mediaFile = {
      id: 'media-context',
      name: 'hold.mov',
      type: 'video',
      duration: 12,
      hasAudio: true,
      file: new File(['video'], 'hold.mov', { type: 'video/quicktime' }),
      url: 'blob:hold',
    } as unknown as ProjectItem;

    function Harness() {
      useTouchContextMenu();
      const onPointerDown = useMediaPanelTouchTimelineDrag({
        activeCompositionId: null,
        renameTimerRef: { current: null },
        setInternalDragId,
        getSlotGridProgress: () => 0,
      });
      return (
        <div
          className="media-item"
          data-testid="media-row"
          onContextMenu={onContextMenu}
          onPointerDown={(event) => onPointerDown(event, mediaFile)}
        />
      );
    }

    render(<Harness />);
    const row = screen.getByTestId('media-row');
    fireEvent.pointerDown(row, {
      button: 0,
      clientX: 40,
      clientY: 60,
      isPrimary: true,
      pointerId: 17,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(40));
    fireEvent.pointerMove(row, {
      clientX: 44,
      clientY: 60,
      pointerId: 17,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(480));

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(getExternalDragPayload()).toBeNull();
    expect(setInternalDragId).not.toHaveBeenCalledWith('media-context');
  });

  it('routes a controlled finger move through the external timeline bridge without a long press', () => {
    vi.useFakeTimers();
    const sourceElement = document.createElement('div');
    document.body.appendChild(sourceElement);
    const phases: ExternalDragBridgeEventDetail[] = [];
    const bridgeListener = (event: Event) => {
      phases.push((event as CustomEvent<ExternalDragBridgeEventDetail>).detail);
    };
    window.addEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, bridgeListener);

    const setInternalDragId = vi.fn();
    const { result, unmount } = renderHook(() => useMediaPanelTouchTimelineDrag({
      activeCompositionId: null,
      renameTimerRef: { current: null },
      setInternalDragId,
      getSlotGridProgress: () => 0,
    }));
    const mediaFile = {
      id: 'media-1',
      name: 'take.mov',
      type: 'video',
      duration: 12,
      hasAudio: true,
      file: new File(['video'], 'take.mov', { type: 'video/quicktime' }),
      url: 'blob:take',
    } as unknown as ProjectItem;

    act(() => result.current({
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 17,
      clientX: 10,
      clientY: 20,
      target: sourceElement,
      currentTarget: sourceElement,
    } as ReactPointerEvent<HTMLDivElement>, mediaFile));
    act(() => dispatchTouchPointer('pointermove', 17, 20));
    expect(getExternalDragPayload()).toBeNull();

    act(() => vi.advanceTimersByTime(40));

    expect(getExternalDragPayload()).toMatchObject({ kind: 'media-file', id: 'media-1' });
    expect(setInternalDragId).toHaveBeenCalledWith('media-1');
    expect(phases.at(-1)).toMatchObject({ phase: 'move', clientX: 17, clientY: 20 });
    const dragGhost = document.querySelector<HTMLElement>('.media-touch-drag-ghost');
    expect(dragGhost).not.toBeNull();
    expect(dragGhost?.textContent).toContain('take.mov');
    expect(dragGhost?.style.transform).toContain('translate3d');

    act(() => dispatchTouchPointer('pointerup', 35, 50));
    expect(phases.at(-1)).toMatchObject({ phase: 'drop', clientX: 35, clientY: 50 });
    expect(setInternalDragId).toHaveBeenLastCalledWith(null);

    act(() => vi.advanceTimersByTime(0));
    expect(getExternalDragPayload()).toBeNull();
    expect(dragGhost?.classList.contains('is-dropping')).toBe(true);

    act(() => vi.advanceTimersByTime(150));
    expect(document.querySelector('.media-touch-drag-ghost')).toBeNull();

    unmount();
    window.removeEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, bridgeListener);
    sourceElement.remove();
  });

  it('leaves a fast initial swipe available for native panel scrolling', () => {
    vi.useFakeTimers();
    const sourceElement = document.createElement('div');
    document.body.appendChild(sourceElement);
    const setInternalDragId = vi.fn();
    const { result, unmount } = renderHook(() => useMediaPanelTouchTimelineDrag({
      activeCompositionId: null,
      renameTimerRef: { current: null },
      setInternalDragId,
      getSlotGridProgress: () => 0,
    }));
    const mediaFile = {
      id: 'media-scroll',
      name: 'scroll.mov',
      type: 'video',
      duration: 12,
      hasAudio: true,
      file: new File(['video'], 'scroll.mov', { type: 'video/quicktime' }),
      url: 'blob:scroll',
    } as unknown as ProjectItem;

    act(() => result.current({
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 17,
      clientX: 10,
      clientY: 20,
      target: sourceElement,
      currentTarget: sourceElement,
    } as ReactPointerEvent<HTMLDivElement>, mediaFile));
    act(() => dispatchTouchPointer('pointermove', 10, 31));
    act(() => vi.advanceTimersByTime(40));

    expect(getExternalDragPayload()).toBeNull();
    expect(setInternalDragId).not.toHaveBeenCalledWith('media-scroll');
    expect(document.querySelector('.media-touch-drag-ghost')).toBeNull();

    unmount();
    sourceElement.remove();
  });

  it('opens a composition on a touch double tap without arming a drag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    const sourceElement = document.createElement('div');
    document.body.appendChild(sourceElement);
    const previousMediaState = useMediaStore.getState();
    const openCompositionTab = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...previousMediaState,
      openCompositionTab,
    });
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => undefined);
    const setInternalDragId = vi.fn();
    const { result, unmount } = renderHook(() => useMediaPanelTouchTimelineDrag({
      activeCompositionId: null,
      renameTimerRef: { current: null },
      setInternalDragId,
      getSlotGridProgress: () => 0,
    }));
    const composition = {
      id: 'comp-touch',
      name: 'Touch Comp',
      type: 'composition',
      duration: 10,
      frameRate: 30,
      width: 1920,
      height: 1080,
    } as ProjectItem;
    const pointerDown = () => result.current({
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      pointerId: 17,
      clientX: 20,
      clientY: 30,
      target: sourceElement,
      currentTarget: sourceElement,
    } as ReactPointerEvent<HTMLDivElement>, composition);

    act(pointerDown);
    act(() => dispatchTouchPointer('pointerup', 20, 30));
    act(() => vi.advanceTimersByTime(100));
    act(pointerDown);
    act(() => dispatchTouchPointer('pointerup', 21, 30));

    expect(activatePanelType).toHaveBeenCalledWith('timeline');
    expect(openCompositionTab).toHaveBeenCalledWith('comp-touch', { skipAnimation: true });
    expect(setInternalDragId).not.toHaveBeenCalledWith('comp-touch');

    unmount();
    vi.mocked(useMediaStore.getState).mockReturnValue(previousMediaState);
    sourceElement.remove();
  });
});
