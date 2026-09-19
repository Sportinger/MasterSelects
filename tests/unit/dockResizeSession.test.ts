import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const historyMocks = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })),
  endBatch: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', () => historyMocks);

import {
  registerDockResizeHandle,
  registerDockResizeProxyHandle,
  startDockResize,
  type DockResizeAxis,
  type DockResizePointer,
} from '../../src/components/dock/dockResizeSession';

function makePointerEvent(
  type: string,
  {
    clientX,
    clientY,
    buttons,
    pointerId = 1,
    pointerType = 'mouse',
  }: DockResizePointer & { buttons: number; pointerId?: number; pointerType?: string },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    buttons,
  }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  });
  return event;
}

function makeHandleElement(rect: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    toJSON: () => ({}),
  });
  document.body.appendChild(element);
  return element;
}

describe('dock resize session', () => {
  const unregisterHandles: Array<() => void> = [];

  beforeEach(() => {
    historyMocks.startBatch.mockClear();
    historyMocks.endBatch.mockClear();
    document.documentElement.removeAttribute('data-dock-resize-axis');
    document.body.style.userSelect = '';
  });

  afterEach(() => {
    window.dispatchEvent(makePointerEvent('pointercancel', {
      clientX: 0,
      clientY: 0,
      buttons: 0,
    }));
    while (unregisterHandles.length > 0) unregisterHandles.pop()?.();
    document.body.replaceChildren();
  });

  function registerHandle(
    id: string,
    axis: DockResizeAxis,
    element: HTMLElement,
  ) {
    const callbacks = {
      onStart: vi.fn(),
      onMove: vi.fn(),
      onEnd: vi.fn(),
    };
    unregisterHandles.push(registerDockResizeHandle({
      id,
      axis,
      element,
      ...callbacks,
    }));
    return callbacks;
  }

  it('resizes both axes when expanded handle hit areas meet at a corner', () => {
    const xCallbacks = registerHandle('x-split', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 100,
    }));
    const yCallbacks = registerHandle('y-split', 'y', makeHandleElement({
      left: 0,
      right: 200,
      top: 100,
      bottom: 102,
    }));

    const pointerDown = makePointerEvent('pointerdown', {
      clientX: 110,
      clientY: 110,
      buttons: 1,
    });
    expect(startDockResize(pointerDown, 'y-split')).toBe(true);

    expect(xCallbacks.onStart).toHaveBeenCalledWith({ clientX: 110, clientY: 110 });
    expect(yCallbacks.onStart).toHaveBeenCalledWith({ clientX: 110, clientY: 110 });
    expect(document.documentElement.getAttribute('data-dock-resize-axis')).toBe('xy');
    expect(historyMocks.startBatch).toHaveBeenCalledTimes(1);

    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 160,
      clientY: 150,
      buttons: 1,
    }));
    expect(xCallbacks.onMove).toHaveBeenCalledWith({ clientX: 160, clientY: 150 });
    expect(yCallbacks.onMove).toHaveBeenCalledWith({ clientX: 160, clientY: 150 });

    window.dispatchEvent(makePointerEvent('pointerup', {
      clientX: 165,
      clientY: 155,
      buttons: 0,
    }));
    expect(xCallbacks.onEnd).toHaveBeenCalledWith({ clientX: 165, clientY: 155 });
    expect(yCallbacks.onEnd).toHaveBeenCalledWith({ clientX: 165, clientY: 155 });
    expect(document.documentElement.hasAttribute('data-dock-resize-axis')).toBe(false);
    expect(historyMocks.endBatch).toHaveBeenCalledTimes(1);
  });

  it('shows a cross cursor and highlights every divider at a corner hover', () => {
    const xElement = makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 100,
    });
    const yElement = makeHandleElement({
      left: 0,
      right: 200,
      top: 100,
      bottom: 102,
    });
    registerHandle('hover-x', 'x', xElement);
    registerHandle('hover-y', 'y', yElement);

    yElement.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 110,
      clientY: 110,
      buttons: 0,
    }));

    expect(document.documentElement.getAttribute('data-dock-resize-hover-axis')).toBe('xy');
    expect(xElement.getAttribute('data-dock-resize-hovered')).toBe('true');
    expect(yElement.getAttribute('data-dock-resize-hovered')).toBe('true');

    yElement.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 50,
      clientY: 101,
      buttons: 0,
    }));

    expect(document.documentElement.hasAttribute('data-dock-resize-hover-axis')).toBe(false);
    expect(xElement.hasAttribute('data-dock-resize-hovered')).toBe(false);
    expect(yElement.getAttribute('data-dock-resize-hovered')).toBe('true');
  });

  it('keeps an isolated divider on a single resize axis', () => {
    const xCallbacks = registerHandle('x-only', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 100,
    }));
    const yCallbacks = registerHandle('far-y', 'y', makeHandleElement({
      left: 0,
      right: 200,
      top: 140,
      bottom: 142,
    }));

    expect(startDockResize(makePointerEvent('pointerdown', {
      clientX: 101,
      clientY: 90,
      buttons: 1,
    }), 'x-only')).toBe(true);

    expect(xCallbacks.onStart).toHaveBeenCalledOnce();
    expect(yCallbacks.onStart).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute('data-dock-resize-axis')).toBe('x');
  });

  it('passes a proxy divider drag to its target without an initial position jump', () => {
    const targetCallbacks = registerHandle('target-y', 'y', makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    }));
    unregisterHandles.push(registerDockResizeProxyHandle({
      id: 'fixed-panels-y',
      axis: 'y',
      element: makeHandleElement({
        left: 0,
        right: 300,
        top: 300,
        bottom: 302,
      }),
      proxyTargetId: 'target-y',
    }));

    expect(startDockResize(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 301,
      buttons: 1,
    }), 'fixed-panels-y')).toBe(true);
    expect(targetCallbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 101 });

    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 321,
      buttons: 1,
    }));
    expect(targetCallbacks.onMove).toHaveBeenCalledWith({ clientX: 150, clientY: 121 });

    window.dispatchEvent(makePointerEvent('pointerup', {
      clientX: 150,
      clientY: 331,
      buttons: 0,
    }));
    expect(targetCallbacks.onEnd).toHaveBeenCalledWith({ clientX: 150, clientY: 131 });
  });

  it('keeps global pointer observers informed during an active resize', () => {
    registerHandle('observer-x', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 200,
    }));

    expect(startDockResize(makePointerEvent('pointerdown', {
      clientX: 101,
      clientY: 80,
      buttons: 1,
      pointerType: 'touch',
    }), 'observer-x')).toBe(true);

    const moveObserver = vi.fn();
    const upObserver = vi.fn();
    window.addEventListener('pointermove', moveObserver, true);
    window.addEventListener('pointerup', upObserver, true);

    try {
      window.dispatchEvent(makePointerEvent('pointermove', {
        clientX: 120,
        clientY: 80,
        buttons: 1,
        pointerType: 'touch',
      }));
      window.dispatchEvent(makePointerEvent('pointerup', {
        clientX: 120,
        clientY: 80,
        buttons: 0,
        pointerType: 'touch',
      }));

      expect(moveObserver).toHaveBeenCalledOnce();
      expect(upObserver).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('pointermove', moveObserver, true);
      window.removeEventListener('pointerup', upObserver, true);
    }
  });

  it.each(['lostpointercapture', 'blur', 'pagehide'])(
    'releases a stuck touch resize on %s',
    (terminalEvent) => {
      const callbacks = registerHandle('terminal-touch-x', 'x', makeHandleElement({
        left: 100,
        right: 102,
        top: 0,
        bottom: 200,
      }));

      expect(startDockResize(makePointerEvent('pointerdown', {
        clientX: 101,
        clientY: 80,
        buttons: 1,
        pointerId: 17,
        pointerType: 'touch',
      }), 'terminal-touch-x')).toBe(true);

      if (terminalEvent === 'lostpointercapture') {
        window.dispatchEvent(makePointerEvent(terminalEvent, {
          clientX: 101,
          clientY: 80,
          buttons: 0,
          pointerId: 17,
          pointerType: 'touch',
        }));
      } else {
        window.dispatchEvent(new Event(terminalEvent));
      }

      expect(callbacks.onEnd).toHaveBeenCalledWith({ clientX: 101, clientY: 80 });
      expect(document.documentElement.hasAttribute('data-dock-resize-axis')).toBe(false);
      expect(document.body.style.userSelect).toBe('');
      expect(historyMocks.endBatch).toHaveBeenCalledOnce();
    },
  );

  it('starts a touch resize from the finger-sized area after directed movement', () => {
    const callbacks = registerHandle('touch-x', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 200,
    }));

    document.body.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 124,
      clientY: 80,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();

    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 131,
      clientY: 81,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 124, clientY: 80 });
    expect(document.documentElement.getAttribute('data-dock-resize-axis')).toBe('x');
  });

  it('expands a horizontal divider touch target above and below the line', () => {
    const callbacks = registerHandle('touch-y-two-sided', 'y', makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    }));

    document.body.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 124,
      buttons: 1,
      pointerId: 11,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 132,
      buttons: 1,
      pointerId: 11,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointerup', {
      clientX: 150,
      clientY: 140,
      buttons: 0,
      pointerId: 11,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 124 });
    callbacks.onStart.mockClear();

    document.body.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 78,
      buttons: 1,
      pointerId: 12,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 70,
      buttons: 1,
      pointerId: 12,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 78 });
    expect(document.documentElement.getAttribute('data-dock-resize-axis')).toBe('y');
  });

  it('keeps a button tap intact but promotes a directed divider drag', () => {
    const callbacks = registerHandle('touch-y-button-gap', 'y', makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    }));
    const button = document.createElement('button');
    document.body.appendChild(button);

    button.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 118,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(historyMocks.startBatch).not.toHaveBeenCalled();

    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 130,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 118 });
    expect(historyMocks.startBatch).toHaveBeenCalledOnce();
  });

  it('starts immediately from the physical divider even over an underlying button', () => {
    const handle = makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    });
    const callbacks = registerHandle('touch-y-under-button', 'y', handle);
    const button = document.createElement('button');
    document.body.appendChild(button);
    const elementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = vi.fn(() => [handle, button]);

    try {
      const pointerDown = makePointerEvent('pointerdown', {
        clientX: 150,
        clientY: 101,
        buttons: 1,
        pointerType: 'touch',
      });
      handle.dispatchEvent(pointerDown);

      expect(startDockResize(pointerDown, 'touch-y-under-button')).toBe(true);
      expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 101 });
      expect(historyMocks.startBatch).toHaveBeenCalledOnce();
    } finally {
      document.elementsFromPoint = elementsFromPoint;
    }
  });

  it('leaves a touch tap beside the divider available to the underlying pane', () => {
    const callbacks = registerHandle('touch-tap-x', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 200,
    }));

    document.body.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 124,
      clientY: 80,
      buttons: 1,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointerup', {
      clientX: 124,
      clientY: 80,
      buttons: 0,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(historyMocks.startBatch).not.toHaveBeenCalled();
  });

  it('keeps a cross-axis control gesture out of the expanded touch area', () => {
    const callbacks = registerHandle('touch-control-x', 'x', makeHandleElement({
      left: 100,
      right: 102,
      top: 0,
      bottom: 200,
    }));
    const button = document.createElement('button');
    document.body.appendChild(button);

    button.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 124,
      clientY: 80,
      buttons: 1,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 124,
      clientY: 101,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();
  });

  it('promotes a directed resize from a soft-priority media surface', () => {
    const callbacks = registerHandle('touch-media-soft-y', 'y', makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    }));
    const mediaContent = document.createElement('div');
    mediaContent.dataset.dockResizeTouchPriority = 'soft';
    document.body.appendChild(mediaContent);

    mediaContent.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 124,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();

    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 132,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).toHaveBeenCalledWith({ clientX: 150, clientY: 124 });
  });

  it('does not let an expanded divider target steal a media content swipe', () => {
    const callbacks = registerHandle('touch-media-y', 'y', makeHandleElement({
      left: 0,
      right: 300,
      top: 100,
      bottom: 102,
    }));
    const mediaContent = document.createElement('div');
    mediaContent.dataset.dockResizeTouchPriority = 'true';
    document.body.appendChild(mediaContent);

    mediaContent.dispatchEvent(makePointerEvent('pointerdown', {
      clientX: 150,
      clientY: 124,
      buttons: 1,
      pointerType: 'touch',
    }));
    window.dispatchEvent(makePointerEvent('pointermove', {
      clientX: 150,
      clientY: 145,
      buttons: 1,
      pointerType: 'touch',
    }));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(historyMocks.startBatch).not.toHaveBeenCalled();
  });
});
