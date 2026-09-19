import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistoryDoubleTap } from '../../src/hooks/useHistoryDoubleTap';

function touchPointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  target: EventTarget,
  x: number,
  y = 100,
  pointerId = 1,
): void {
  fireEvent[type === 'pointerdown' ? 'pointerDown' : type === 'pointermove' ? 'pointerMove' : 'pointerUp'](
    target,
    { button: 0, clientX: x, clientY: y, pointerId, pointerType: 'touch' },
  );
}

function tap(target: EventTarget, x: number, y = 100): void {
  touchPointer('pointerdown', target, x, y);
  touchPointer('pointerup', target, x, y);
}

describe('useHistoryDoubleTap', () => {
  let preview: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T12:00:00Z'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    preview = document.createElement('div');
    preview.dataset.previewPanelId = 'preview-1';
    document.body.appendChild(preview);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('maps a left double tap to undo and a right double tap to redo', () => {
    const onOperation = vi.fn();
    renderHook(() => useHistoryDoubleTap(onOperation));

    tap(preview, 200);
    vi.advanceTimersByTime(100);
    tap(preview, 205);
    expect(onOperation).toHaveBeenLastCalledWith('undo');

    vi.advanceTimersByTime(400);
    tap(preview, 800);
    vi.advanceTimersByTime(100);
    tap(preview, 805);
    expect(onOperation).toHaveBeenLastCalledWith('redo');
    expect(onOperation).toHaveBeenCalledTimes(2);
  });

  it('does not treat a drag or two distant taps as history gestures', () => {
    const onOperation = vi.fn();
    renderHook(() => useHistoryDoubleTap(onOperation));

    touchPointer('pointerdown', preview, 100);
    touchPointer('pointermove', preview, 130);
    touchPointer('pointerup', preview, 130);
    tap(preview, 100);
    expect(onOperation).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    tap(preview, 300);
    expect(onOperation).not.toHaveBeenCalled();
  });

  it('leaves double taps on interactive controls untouched', () => {
    const onOperation = vi.fn();
    renderHook(() => useHistoryDoubleTap(onOperation));
    const button = document.createElement('button');
    preview.appendChild(button);

    tap(button, 200);
    vi.advanceTimersByTime(100);
    tap(button, 200);

    expect(onOperation).not.toHaveBeenCalled();
  });

  it('ignores double taps outside the Preview panel', () => {
    const onOperation = vi.fn();
    renderHook(() => useHistoryDoubleTap(onOperation));
    const mediaItem = document.createElement('div');
    mediaItem.dataset.itemId = 'comp-1';
    document.body.appendChild(mediaItem);

    tap(mediaItem, 200);
    vi.advanceTimersByTime(100);
    tap(mediaItem, 200);

    expect(onOperation).not.toHaveBeenCalled();
  });
});
