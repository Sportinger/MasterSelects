import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPreviewPinchTranslation,
  isPreviewPinchWheelEvent,
  usePreviewPinchZoom,
} from '../../src/components/preview/usePreviewPinchZoom';
import { resolvePreviewPinchZoomEnabled } from '../../src/components/preview/usePreviewPanelInputBindings';

let animationFrameCallbacks: FrameRequestCallback[] = [];

function flushAnimationFrame(): void {
  const callbacks = animationFrameCallbacks;
  animationFrameCallbacks = [];
  callbacks.forEach(callback => callback(performance.now()));
}

function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId: number; pointerType: string },
): PointerEvent {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  return event;
}

function setupPreviewPinch(handleWheel: (event: WheelEvent) => void, zoomSpeed?: number) {
  const container = document.createElement('div');
  const canvasTarget = document.createElement('div');
  container.appendChild(canvasTarget);
  document.body.appendChild(container);
  const containerRef = createRef<HTMLDivElement>();
  containerRef.current = container;
  const hook = renderHook(() => usePreviewPinchZoom({
    containerRef,
    enabled: true,
    handleWheel,
    isCanvasInteractionTarget: target => target instanceof Node && canvasTarget.contains(target),
    zoomSpeed,
  }));
  return { canvasTarget, ...hook };
}

function startPinch(target: Element): void {
  target.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 11, pointerType: 'touch', clientX: 100, clientY: 120,
  }));
  target.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 12, pointerType: 'touch', clientX: 200, clientY: 120,
  }));
}

beforeEach(() => {
  animationFrameCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('usePreviewPinchZoom', () => {
  it('keeps pinch enabled for camera dolly without requiring Preview edit zoom', () => {
    expect(resolvePreviewPinchZoomEnabled(true, false, false, false)).toBe(true);
    expect(resolvePreviewPinchZoomEnabled(false, true, false, false)).toBe(true);
    expect(resolvePreviewPinchZoomEnabled(false, false, true, false)).toBe(true);
    expect(resolvePreviewPinchZoomEnabled(false, true, false, true)).toBe(true);
    expect(resolvePreviewPinchZoomEnabled(false, false, false, true)).toBe(true);
    expect(resolvePreviewPinchZoomEnabled(false, false, false, false)).toBe(false);
  });

  it('routes pinch-out through preview zoom at the gesture midpoint', () => {
    const handleWheel = vi.fn<(event: WheelEvent) => void>();
    const { canvasTarget } = setupPreviewPinch(handleWheel);
    startPinch(canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 230, clientY: 120,
    }));
    flushAnimationFrame();

    expect(handleWheel).toHaveBeenCalled();
    expect(handleWheel.mock.calls.every(([event]) => event.deltaY < 0)).toBe(true);
    expect(handleWheel.mock.calls.at(-1)?.[0].clientX).toBe(165);
    expect(handleWheel.mock.calls.at(-1)?.[0].target).toBe(canvasTarget);
  });

  it('routes pinch-in through preview zoom in the opposite direction', () => {
    const handleWheel = vi.fn<(event: WheelEvent) => void>();
    const { canvasTarget } = setupPreviewPinch(handleWheel);
    startPinch(canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 175, clientY: 120,
    }));
    flushAnimationFrame();

    expect(handleWheel).toHaveBeenCalled();
    expect(handleWheel.mock.calls.every(([event]) => event.deltaY > 0)).toBe(true);
  });

  it('emits small continuous deltas without waiting for a zoom step', () => {
    const handleWheel = vi.fn<(event: WheelEvent) => void>();
    const { canvasTarget } = setupPreviewPinch(handleWheel);
    startPinch(canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 201, clientY: 120,
    }));
    flushAnimationFrame();

    expect(handleWheel).toHaveBeenCalledOnce();
    const event = handleWheel.mock.calls[0][0];
    expect(event.deltaY).toBeLessThan(0);
    expect(Math.abs(event.deltaY)).toBeLessThan(10);
    expect(isPreviewPinchWheelEvent(event)).toBe(true);
  });

  it('scales only the synthetic zoom delta for a faster edit-mode pinch', () => {
    const normalWheel = vi.fn<(event: WheelEvent) => void>();
    const fastWheel = vi.fn<(event: WheelEvent) => void>();
    const normal = setupPreviewPinch(normalWheel);
    const fast = setupPreviewPinch(fastWheel, 4);
    startPinch(normal.canvasTarget);
    startPinch(fast.canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 230, clientY: 120,
    }));
    flushAnimationFrame();

    const normalDelta = normalWheel.mock.calls.at(-1)?.[0].deltaY ?? 0;
    const fastDelta = fastWheel.mock.calls.at(-1)?.[0].deltaY ?? 0;
    expect(fastDelta).toBeCloseTo(normalDelta * 4, 10);
  });

  it('keeps the active pinch when a zoom render replaces the wheel callback', () => {
    const container = document.createElement('div');
    const canvasTarget = document.createElement('div');
    container.appendChild(canvasTarget);
    document.body.appendChild(container);
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = container;
    const firstHandleWheel = vi.fn<(event: WheelEvent) => void>();
    const nextHandleWheel = vi.fn<(event: WheelEvent) => void>();
    const isCanvasInteractionTarget = (target: EventTarget | null) => (
      target instanceof Node && canvasTarget.contains(target)
    );
    const hook = renderHook(
      ({ handleWheel }: { handleWheel: (event: WheelEvent) => void }) => usePreviewPinchZoom({
        containerRef,
        enabled: true,
        handleWheel,
        isCanvasInteractionTarget,
      }),
      { initialProps: { handleWheel: firstHandleWheel } },
    );
    startPinch(canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 210, clientY: 120,
    }));
    flushAnimationFrame();
    hook.rerender({ handleWheel: nextHandleWheel });
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 220, clientY: 120,
    }));
    flushAnimationFrame();

    expect(firstHandleWheel).toHaveBeenCalledOnce();
    expect(nextHandleWheel).toHaveBeenCalledOnce();
  });

  it('reports centroid movement so two fingers can pan while pinching', () => {
    const handleWheel = vi.fn<(event: WheelEvent) => void>();
    const { canvasTarget } = setupPreviewPinch(handleWheel);
    startPinch(canvasTarget);

    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 11, pointerType: 'touch', clientX: 120, clientY: 140,
    }));
    window.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 12, pointerType: 'touch', clientX: 220, clientY: 140,
    }));
    flushAnimationFrame();

    expect(handleWheel).toHaveBeenCalledOnce();
    const event = handleWheel.mock.calls[0][0];
    expect(getPreviewPinchTranslation(event)).toEqual({ x: 20, y: 20 });
    expect(event.deltaY).toBeCloseTo(0, 10);
  });
});
