import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDockPinchFullscreen } from '../../src/hooks/useDockPinchFullscreen';
import {
  claimEditableValueTouchSession,
  releaseEditableValueTouchSession,
} from '../../src/services/input/editableValueTouchSession';
import { useDockStore } from '../../src/stores/dockStore';
import type { DockLayout, PanelType } from '../../src/types/dock';

const originalLayout = useDockStore.getState().layout;
const originalMaximizedPanelId = useDockStore.getState().maximizedPanelId;

function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId: number; pointerType: string },
): PointerEvent {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  return event;
}

function mountPane(panelType: PanelType, editMode = false, pinchReserved = false) {
  const panelId = `pinch-${panelType}`;
  const layout: DockLayout = {
    root: {
      kind: 'tab-group',
      id: 'pinch-group',
      activeIndex: 0,
      panels: [{ id: panelId, type: panelType, title: panelType }],
    },
    floatingPanels: [],
    panelZoom: {},
  };
  useDockStore.setState({ layout, maximizedPanelId: null });

  const pane = document.createElement('div');
  pane.className = 'dock-tab-pane';
  pane.dataset.groupId = 'pinch-group';
  pane.dataset.activePanelType = panelType;
  const target = document.createElement('div');
  if (panelType === 'preview') {
    target.className = 'preview-container';
    target.dataset.previewEditMode = editMode ? 'true' : 'false';
    target.dataset.previewPinchReserved = pinchReserved ? 'true' : 'false';
  }
  pane.appendChild(target);
  document.body.appendChild(pane);
  return { pane, panelId, target };
}

function pinch(target: Element, endX: number): void {
  target.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100,
  }));
  target.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100,
  }));
  window.dispatchEvent(pointerEvent('pointermove', {
    pointerId: 2, pointerType: 'touch', clientX: endX, clientY: 100,
  }));
}

function safariGesture(target: EventTarget, type: string, scale: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  target.dispatchEvent(event);
}

beforeEach(() => {
  useDockStore.setState({ maximizedPanelId: null });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  useDockStore.setState({
    layout: originalLayout,
    maximizedPanelId: originalMaximizedPanelId,
  });
});

describe('useDockPinchFullscreen', () => {
  it('maximizes the active tab on pinch-out and restores it on pinch-in', () => {
    const { unmount } = renderHook(() => useDockPinchFullscreen());
    const first = mountPane('media');

    pinch(first.target, 225);
    expect(useDockStore.getState().maximizedPanelId).toBe(first.panelId);

    unmount();
    first.pane.remove();
    const second = mountPane('media');
    useDockStore.setState({ maximizedPanelId: second.panelId });
    renderHook(() => useDockPinchFullscreen());

    pinch(second.target, 180);
    expect(useDockStore.getState().maximizedPanelId).toBeNull();
  });

  it('leaves timeline pinch to the timeline zoom controller', () => {
    renderHook(() => useDockPinchFullscreen());
    const { target } = mountPane('timeline');

    pinch(target, 240);

    expect(useDockStore.getState().maximizedPanelId).toBeNull();
  });

  it('leaves preview pinch to preview zoom while edit mode is active', () => {
    renderHook(() => useDockPinchFullscreen());
    const { target } = mountPane('preview', true);

    pinch(target, 240);

    expect(useDockStore.getState().maximizedPanelId).toBeNull();
  });

  it('does not fullscreen a Preview whose camera navigation owns touch gestures', () => {
    renderHook(() => useDockPinchFullscreen());
    const { target } = mountPane('preview', false, true);

    pinch(target, 240);

    expect(useDockStore.getState().maximizedPanelId).toBeNull();
  });

  it('uses Safari gesture events when viewport pinch withholds pointer moves', () => {
    renderHook(() => useDockPinchFullscreen());
    const { panelId, target } = mountPane('media');

    safariGesture(target, 'gesturestart', 1);
    safariGesture(window, 'gesturechange', 1.2);

    expect(useDockStore.getState().maximizedPanelId).toBe(panelId);
  });

  it('does not maximize while a value touch session owns the extra fingers', () => {
    renderHook(() => useDockPinchFullscreen());
    const { target } = mountPane('media');
    const owner = Symbol('value-test');
    claimEditableValueTouchSession(owner);

    try {
      pinch(target, 240);
      expect(useDockStore.getState().maximizedPanelId).toBeNull();
    } finally {
      releaseEditableValueTouchSession(owner);
    }
  });
});
