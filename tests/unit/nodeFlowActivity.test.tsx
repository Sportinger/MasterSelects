import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNodeFlowActivity } from '../../src/components/panels/nodes/canvas/useNodeFlowActivity';
import { useTimelineStore } from '../../src/stores/timeline';
import { getConnectionArrowTransform } from '../../src/components/panels/nodes/canvas/canvasGeometry';

vi.mock('../../src/stores/timeline', async () => {
  const { create } = await import('zustand');
  return { useTimelineStore: create(() => ({ isPlaying: false, playheadPosition: 0, isDraggingPlayhead: false })) };
});

function ActivityProbe() {
  return <svg ref={useNodeFlowActivity()} data-testid="flow" />;
}

beforeEach(() => {
  vi.useFakeTimers();
  useTimelineStore.setState({ isPlaying: false, playheadPosition: 0, isDraggingPlayhead: false });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('node connection flow activity', () => {
  it('starts with playback, keeps running without store ticks and stops on the final pause position', () => {
    const view = render(<ActivityProbe />);
    const flow = view.getByTestId('flow');
    expect(flow).toHaveAttribute('data-flow-active', 'false');
    act(() => useTimelineStore.setState({ isPlaying: true }));
    act(() => vi.advanceTimersByTime(5000));
    expect(flow).toHaveAttribute('data-flow-active', 'true');
    act(() => useTimelineStore.setState({ isPlaying: false, playheadPosition: 5 }));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
  });

  it('bridges scrub updates in either direction, but settles even with the pointer held down', () => {
    const view = render(<ActivityProbe />);
    const flow = view.getByTestId('flow');
    act(() => useTimelineStore.setState({ isDraggingPlayhead: true }));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
    act(() => useTimelineStore.setState({ playheadPosition: 5 }));
    act(() => vi.advanceTimersByTime(150));
    act(() => useTimelineStore.setState({ playheadPosition: 4 }));
    act(() => vi.advanceTimersByTime(150));
    expect(flow).toHaveAttribute('data-flow-active', 'true');
    act(() => vi.advanceTimersByTime(100));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
  });

  it('does not cancel a scrub pulse on unrelated state changes or restart on the same position', () => {
    const view = render(<ActivityProbe />);
    const flow = view.getByTestId('flow');
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    act(() => vi.advanceTimersByTime(100));
    act(() => useTimelineStore.setState({ isDraggingPlayhead: false, playheadPosition: 1 }));
    expect(flow).toHaveAttribute('data-flow-active', 'true');
    act(() => vi.advanceTimersByTime(100));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
  });

  it('mounts during playback and pauses in hidden tabs, then resumes current playback', () => {
    useTimelineStore.setState({ isPlaying: true });
    const view = render(<ActivityProbe />);
    const flow = view.getByTestId('flow');
    expect(flow).toHaveAttribute('data-flow-active', 'true');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(flow).toHaveAttribute('data-flow-active', 'false');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(flow).toHaveAttribute('data-flow-active', 'true');
  });

  it('cleans up a pending scrub timeout and subscriptions on unmount', () => {
    const view = render(<ActivityProbe />);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    const flow = view.getByTestId('flow');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => useTimelineStore.setState({ isPlaying: true }));
    act(() => useTimelineStore.setState({ isPlaying: false }));
    expect(flow).toHaveAttribute('data-flow-active', 'true');
  });
});

describe('cable direction arrows', () => {
  it('follows the cubic tangent for forward, vertically curved and backward connections', () => {
    expect(getConnectionArrowTransform({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe('translate(150 0) rotate(0)');
    expect(getConnectionArrowTransform({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe('translate(150 0) rotate(180)');
    // Short horizontal spans bend back through their midpoint; use the curve's tangent.
    expect(getConnectionArrowTransform({ x: 0, y: 0 }, { x: 60, y: 0 })).toBe('translate(30 0) rotate(180)');
    expect(getConnectionArrowTransform({ x: 0, y: 0 }, { x: 72, y: 100 })).toBe('translate(36 50) rotate(90)');
  });
});
