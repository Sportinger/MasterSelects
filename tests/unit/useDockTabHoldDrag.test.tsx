import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HOLD_DURATION } from '../../src/components/dock/tabPane/layoutMath';
import { useDockTabHoldDrag } from '../../src/components/dock/tabPane/useDockTabHoldDrag';
import type { DockPanel } from '../../src/types/dock';

const panel: DockPanel = {
  id: 'export',
  type: 'export',
  title: 'Export',
};

function touchPointerUp(pointerId: number): PointerEvent {
  const event = new MouseEvent('pointerup', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
  });
  return event as PointerEvent;
}

describe('dock tab touch hold', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('cancels on the first release even when a nested gesture stops propagation', () => {
    vi.useFakeTimers();
    const startDrag = vi.fn();
    const { result, unmount } = renderHook(() => useDockTabHoldDrag({
      groupId: 'right-group',
      startDrag,
    }));
    const tab = document.createElement('div');
    const blockingTarget = document.createElement('div');
    blockingTarget.addEventListener('pointerup', event => event.stopPropagation(), true);
    document.body.append(tab, blockingTarget);

    act(() => {
      result.current.startHold('export', panel, tab, {
        clientX: 20,
        clientY: 10,
        pointerId: 7,
        pointerType: 'touch',
      });
    });
    act(() => {
      blockingTarget.dispatchEvent(touchPointerUp(7));
      vi.advanceTimersByTime(HOLD_DURATION + 1);
    });

    expect(startDrag).not.toHaveBeenCalled();
    expect(result.current.holdProgress).not.toBe('holding');

    unmount();
  });
});
