import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTimelineTrackClipTouchRowEvent } from '../../src/components/timeline/hooks/useTimelineTrackClipTouchRowEvent';

function dispatchTouchPointerUp(clientX: number, clientY: number): void {
  const event = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperties(event, {
    pointerId: { value: 17 },
    pointerType: { value: 'touch' },
    isPrimary: { value: true },
  });
  window.dispatchEvent(event);
}

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('timeline clip touch double tap', () => {
  it('opens the hit clip on the second tap instead of beginning another drag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    const row = document.createElement('div');
    document.body.appendChild(row);
    const onClipDoubleClick = vi.fn();
    const onClipMouseDown = vi.fn();
    const { result, unmount } = renderHook(() => useTimelineTrackClipTouchRowEvent({
      handleTimelineToolPointerClick: vi.fn(() => false),
      hitTestClipAtClientX: vi.fn(() => 'nested-comp-clip'),
      onClipDoubleClick,
      onClipMouseDown,
      setHoveredClipId: vi.fn(),
    }));
    const pointerDown = () => result.current({
      pointerType: 'touch',
      button: 0,
      pointerId: 17,
      clientX: 50,
      clientY: 40,
      target: row,
      currentTarget: row,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactPointerEvent<HTMLDivElement>);

    act(pointerDown);
    act(() => dispatchTouchPointerUp(50, 40));
    act(() => vi.advanceTimersByTime(100));
    act(pointerDown);

    expect(onClipMouseDown).toHaveBeenCalledTimes(1);
    expect(onClipDoubleClick).toHaveBeenCalledTimes(1);
    expect(onClipDoubleClick).toHaveBeenCalledWith(
      expect.anything() as ReactMouseEvent<HTMLDivElement>,
      'nested-comp-clip',
    );

    unmount();
    row.remove();
  });
});
