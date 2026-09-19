import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageZoom } from '../../src/hooks/usePageZoom';

function dispatchCtrlWheel(target: Element): WheelEvent {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: 100,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchCancelableEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function dispatchMultiTouchMove(touchCount: number): TouchEvent {
  const event = new Event('touchmove', { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: touchCount }, () => ({})),
  });
  window.dispatchEvent(event);
  return event;
}

describe('usePageZoom', () => {
  it('blocks native Ctrl+wheel page zoom', () => {
    renderHook(() => usePageZoom());

    expect(dispatchCtrlWheel(document.body).defaultPrevented).toBe(true);
  });

  it('allows native Ctrl+wheel page zoom inside the Appearance zoom area', () => {
    renderHook(() => usePageZoom());
    const zoomArea = document.createElement('div');
    zoomArea.dataset.browserZoomArea = '';
    const child = document.createElement('span');
    zoomArea.appendChild(child);
    document.body.appendChild(zoomArea);

    expect(dispatchCtrlWheel(child).defaultPrevented).toBe(false);

    zoomArea.remove();
  });

  it('blocks Safari native pinch gesture events', () => {
    renderHook(() => usePageZoom());

    expect(dispatchCancelableEvent('gesturestart').defaultPrevented).toBe(true);
    expect(dispatchCancelableEvent('gesturechange').defaultPrevented).toBe(true);
  });

  it('blocks multi-touch page zoom without blocking one-finger movement', () => {
    renderHook(() => usePageZoom());

    expect(dispatchMultiTouchMove(2).defaultPrevented).toBe(true);
    expect(dispatchMultiTouchMove(1).defaultPrevented).toBe(false);
  });
});
