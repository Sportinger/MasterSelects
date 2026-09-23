import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFrameCoalescedNumberChange } from '../../src/components/common/useFrameCoalescedNumberChange';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('publishes only the latest sample per frame and flushes the final value before commit', () => {
  const change = vi.fn();
  const { result } = renderHook(() => useFrameCoalescedNumberChange(change));
  act(() => { for (let i = 0; i < 100; i++) result.current.enqueue(i); });
  expect(change).not.toHaveBeenCalled();
  act(() => vi.advanceTimersToNextFrame());
  expect(change.mock.calls).toEqual([[99]]);
  act(() => { result.current.enqueue(100); result.current.flush(); });
  expect(change.mock.calls).toEqual([[99], [100]]);
  act(() => vi.advanceTimersToNextFrame());
  expect(change).toHaveBeenCalledTimes(2);
});

it('retains the original edit target across selection changes and flushes on unmount', () => {
  const first = vi.fn(), second = vi.fn();
  const { result, rerender, unmount } = renderHook(({ change }) => useFrameCoalescedNumberChange(change),
    { initialProps: { change: first } });
  act(() => result.current.enqueue(7));
  rerender({ change: second });
  unmount();
  expect(first).toHaveBeenCalledWith(7);
  expect(second).not.toHaveBeenCalled();
  act(() => vi.advanceTimersToNextFrame());
  expect(first).toHaveBeenCalledTimes(1);
});
