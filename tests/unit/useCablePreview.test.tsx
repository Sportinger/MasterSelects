import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useCablePreview } from '../../src/services/faceCables/useCablePreview';

const calls = vi.hoisted(() => ({
  invalidate: vi.fn(), composite: vi.fn(), render: vi.fn(), simulate: vi.fn(() => 'draft'),
  globalInvalidate: vi.fn(),
}));
vi.mock('../../src/services/layerBuilder', () => ({ layerBuilder: { invalidateCache: calls.invalidate } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { clearCompositeCache: calls.composite, requestRender: calls.render } }));
vi.mock('../../src/services/faceCables/previewFaceCables', () => ({ previewFaceCables: calls.simulate }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: (select: (state: unknown) => unknown) => select({ getActiveComposition: () => ({ frameRate: 30 }) }) }));
vi.mock('../../src/stores/timeline', async () => {
  const { create } = await import('zustand');
  return { useTimelineStore: create(() => ({
    playheadPosition: 0, isPlaying: false, isExporting: false, clipKeyframes: new Map(),
    clips: [{ id: 'clip', startTime: 0, duration: 20, effects: [] }], invalidateCache: calls.globalInvalidate,
  })) };
});
const configs = [];
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); useTimelineStore.setState({ isPlaying: false, isExporting: false, playheadPosition: 0 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('cable preview scheduling', () => {
  it('does no render or cache work on inactive playhead updates', () => {
    let renders = 0;
    renderHook(() => { renders++; return useCablePreview('clip', 'effect', configs, false); });
    const initial = renders;
    for (let i = 1; i <= 60; i++) act(() => useTimelineStore.setState({ playheadPosition: i / 30 }));
    expect(renders).toBe(initial);
    expect(calls.simulate).not.toHaveBeenCalled();
    expect(calls.invalidate).not.toHaveBeenCalled();
    expect(calls.render).not.toHaveBeenCalled();
    expect(calls.globalInvalidate).not.toHaveBeenCalled();
  });
  it('clears a draft once when playback begins and ignores subsequent ticks', () => {
    let renders = 0;
    renderHook(() => { renders++; return useCablePreview('clip', 'effect', configs, true); });
    act(() => vi.advanceTimersByTime(80));
    expect(calls.simulate).toHaveBeenCalledTimes(1);
    act(() => useTimelineStore.setState({ isPlaying: true }));
    const initial = renders, refreshes = calls.render.mock.calls.length;
    for (let i = 1; i <= 60; i++) act(() => useTimelineStore.setState({ playheadPosition: i / 30 }));
    act(() => vi.advanceTimersByTime(100));
    expect(renders).toBe(initial);
    expect(calls.render).toHaveBeenCalledTimes(refreshes);
    expect(calls.globalInvalidate).not.toHaveBeenCalled();
    expect(calls.simulate).toHaveBeenCalledTimes(1);
  });
  it('coalesces paused scrubbing and removes the override on unmount', () => {
    const { unmount } = renderHook(() => useCablePreview('clip', 'effect', configs, true));
    for (let i = 1; i <= 20; i++) act(() => useTimelineStore.setState({ playheadPosition: i / 30 }));
    act(() => vi.advanceTimersByTime(80));
    expect(calls.simulate).toHaveBeenCalledTimes(1);
    expect(calls.render).toHaveBeenCalledTimes(1);
    unmount();
    expect(calls.render).toHaveBeenCalledTimes(2);
    expect(calls.globalInvalidate).not.toHaveBeenCalled();
  });
});
