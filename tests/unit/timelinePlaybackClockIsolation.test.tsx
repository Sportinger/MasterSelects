import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  readTimelinePlaybackPosition,
  useTimelineEditorPlaybackState,
} from '../../src/components/timeline/hooks/useTimelineEditorPlaybackState';
import { useTimelinePlaybackAutoScroll } from '../../src/components/timeline/hooks/useTimelinePlaybackAutoScroll';
import { TimelineCurrentTimeValue } from '../../src/components/timeline/components/TimelineCurrentTimeValue';

vi.mock('../../src/stores/timeline', async () => {
  const { create } = await import('zustand');
  const { subscribeWithSelector } = await import('zustand/middleware');
  return {
    useTimelineStore: create(subscribeWithSelector(() => ({
      isPlaying: false, isDraggingPlayhead: false, isRamPreviewing: false,
      isExporting: false, playheadPosition: 10,
    }))),
  };
});
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({
  getPlayheadPosition: (position: number) => position,
}));

beforeEach(() => {
  useTimelineStore.setState({
    isPlaying: false, isDraggingPlayhead: false, isRamPreviewing: false,
    isExporting: false, playheadPosition: 10,
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Timeline playback clock ownership', () => {
  it('updates the time leaf without rerendering the editor, then publishes the paused position', () => {
    const editorRender = vi.fn();
    function Editor() {
      const state = useTimelineEditorPlaybackState();
      editorRender();
      return <>
        <output data-testid="editor">{state.playheadPosition}</output>
        <output data-testid="clock"><TimelineCurrentTimeValue formatTime={String} frameRate={25}
          inPoint={null} rangeActive={false} rangeDuration={100} totalFrames={2500}
          displayMode="time" fallbackFrame={state.playheadPosition * 25} fallbackTime={state.playheadPosition} /></output>
      </>;
    }
    const view = render(<Editor />);
    act(() => useTimelineStore.setState({ isPlaying: true }));
    expect(editorRender).toHaveBeenCalledTimes(2);
    for (const position of [11, 12, 13, 4]) {
      act(() => useTimelineStore.setState({ playheadPosition: position }));
      expect(view.getByTestId('clock').textContent).toBe(String(position));
    }
    expect(editorRender).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('editor').textContent).toBe('10');
    expect(readTimelinePlaybackPosition(10)).toBe(4);
    act(() => useTimelineStore.setState({ isPlaying: false, playheadPosition: 4.25 }));
    expect(view.getByTestId('editor').textContent).toBe('4.25');
    expect(view.getByTestId('clock').textContent).toBe('4.25');
  });

  it('keeps pointer scrub ticks outside the editor and publishes the final release position', () => {
    const editorRender = vi.fn();
    function Editor() {
      const state = useTimelineEditorPlaybackState();
      editorRender();
      return <>
        <output data-testid="editor">{state.playheadPosition}</output>
        <output data-testid="clock"><TimelineCurrentTimeValue formatTime={String} frameRate={25}
          inPoint={null} rangeActive={false} rangeDuration={100} totalFrames={2500}
          displayMode="time" fallbackFrame={state.playheadPosition * 25} fallbackTime={state.playheadPosition} /></output>
      </>;
    }
    const view = render(<Editor />);
    act(() => useTimelineStore.setState({ isDraggingPlayhead: true }));
    for (const position of [20, 50, 2]) {
      act(() => useTimelineStore.setState({ playheadPosition: position }));
      expect(view.getByTestId('clock').textContent).toBe(String(position));
      expect(readTimelinePlaybackPosition(10)).toBe(position);
    }
    expect(editorRender).toHaveBeenCalledTimes(2);
    act(() => useTimelineStore.setState({ isDraggingPlayhead: false }));
    expect(view.getByTestId('editor').textContent).toBe('2');
  });

  it.each(['isRamPreviewing', 'isExporting'] as const)(
    'keeps exact editor position updates during %s', flag => {
      useTimelineStore.setState({ isPlaying: true, [flag]: true });
      const hook = renderHook(useTimelineEditorPlaybackState);
      act(() => useTimelineStore.setState({ playheadPosition: 27 }));
      expect(hook.result.current.playheadPosition).toBe(27);
    },
  );

  it('formats the running frame count using the exact frame rate and In/Out range', () => {
    useTimelineStore.setState({ isPlaying: true, playheadPosition: 12 });
    const view = render(<output><TimelineCurrentTimeValue formatTime={String} frameRate={30000 / 1001}
      inPoint={10} rangeActive rangeDuration={3} totalFrames={90}
      displayMode="frames" fallbackFrame={0} fallbackTime={0} /></output>);
    expect(view.getByRole('status').textContent).toBe('59');
    act(() => useTimelineStore.setState({ playheadPosition: 20 }));
    expect(view.getByRole('status').textContent).toBe('89');
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(view.getByRole('status').textContent).toBe('0');
  });

  it('follows viewport crossings and loops without a host render or repeated layout reads', () => {
    useTimelineStore.setState({ isPlaying: true, playheadPosition: 10 });
    const element = document.createElement('div');
    const measure = vi.fn(() => 500);
    Object.defineProperty(element, 'clientWidth', { get: measure });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const setScrollX = vi.fn();
    const input = { duration: 100, zoom: 10, isPlaying: true, isDraggingPlayhead: false,
      playheadPosition: 10, scrollX: 0, setScrollX, timeToPixel: (time: number) => time * 10,
      timelineRef: { current: element } };
    const hook = renderHook(useTimelinePlaybackAutoScroll, { initialProps: input });
    act(() => useTimelineStore.setState({ playheadPosition: 51 }));
    expect(setScrollX).toHaveBeenLastCalledWith(510);
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(setScrollX).toHaveBeenLastCalledWith(20);
    // A host rerender still carries its old clock snapshot. Follow the live
    // clock when scrolling/zooming causes this effect to reattach.
    act(() => useTimelineStore.setState({ playheadPosition: 60 }));
    setScrollX.mockClear();
    hook.rerender({ ...input, scrollX: 550 });
    expect(setScrollX).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledOnce();
    act(() => useTimelineStore.setState({ isDraggingPlayhead: true, playheadPosition: 1 }));
    expect(setScrollX).not.toHaveBeenCalled();
    hook.unmount();
    act(() => useTimelineStore.setState({ isDraggingPlayhead: false, playheadPosition: 99 }));
    expect(setScrollX).not.toHaveBeenCalled();
  });
});
