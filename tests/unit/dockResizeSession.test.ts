import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const historyMocks = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })),
  endBatch: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', () => historyMocks);

import {
  registerDockResizeHandle,
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
  }: DockResizePointer & { buttons: number; pointerId?: number },
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
    pointerType: { value: 'mouse' },
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
});
