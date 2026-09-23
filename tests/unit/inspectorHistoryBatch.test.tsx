import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInspectorHistoryBatch } from '../../src/components/panels/properties/resolveInspector/useInspectorHistoryBatch';
import { useHistoryStore } from '../../src/stores/historyStore';

afterEach(() => { cleanup(); vi.restoreAllMocks(); useHistoryStore.setState({ batchId: null }); });

it('owns one batch for many drag frames and does not close an enclosing batch', () => {
  const state = useHistoryStore.getState();
  const start = vi.spyOn(state, 'startBatch').mockImplementation(() => {
    const previous = useHistoryStore.getState().batchId;
    if (previous !== null) return { opened: false, batchId: previous };
    useHistoryStore.setState({ batchId: 123 }); return { opened: true, batchId: 123 };
  });
  const end = vi.spyOn(state, 'endBatch').mockImplementation(() => { useHistoryStore.setState({ batchId: null }); });
  const { result } = renderHook(() => useInspectorHistoryBatch('Delay'));
  act(() => result.current.begin());
  expect(useHistoryStore.getState().batchId).toBe(123);
  act(() => result.current.end());
  expect(end).toHaveBeenCalledTimes(1);
  useHistoryStore.setState({ batchId: 456 });
  act(() => { result.current.begin(); result.current.end(); });
  expect(start).toHaveBeenCalledTimes(2);
  expect(end).toHaveBeenCalledTimes(1);
  expect(useHistoryStore.getState().batchId).toBe(456);
});
