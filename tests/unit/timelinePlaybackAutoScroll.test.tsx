import { renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTimelinePlaybackAutoScroll } from '../../src/components/timeline/hooks/useTimelinePlaybackAutoScroll';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('follows forward and reverse playback without measuring layout on each transport tick', () => {
  const element = document.createElement('div'), measure = vi.fn(() => 500), disconnect = vi.fn();
  Object.defineProperty(element, 'clientWidth', { get: measure });
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  const props = { duration: 100, zoom: 10, isPlaying: true, isDraggingPlayhead: false, playheadPosition: 0,
    scrollX: 0, setScrollX: vi.fn(), timeToPixel: (time: number) => time * 10, timelineRef: { current: element } };
  const hook = renderHook(useTimelinePlaybackAutoScroll, { initialProps: props });
  for (let i = 1; i <= 50; i++) hook.rerender({ ...props, playheadPosition: i });
  expect(measure).toHaveBeenCalledTimes(1); expect(props.setScrollX).not.toHaveBeenCalled();
  hook.rerender({ ...props, playheadPosition: 51 }); expect(props.setScrollX).toHaveBeenLastCalledWith(510);
  hook.rerender({ ...props, scrollX: 510, playheadPosition: 45 }); expect(props.setScrollX).toHaveBeenLastCalledWith(450);
  measure.mockReturnValue(300); resize(); props.setScrollX.mockClear();
  hook.rerender({ ...props, playheadPosition: 35 }); expect(props.setScrollX).toHaveBeenLastCalledWith(350);
  props.setScrollX.mockClear(); hook.rerender({ ...props, playheadPosition: 80, isDraggingPlayhead: true });
  expect(props.setScrollX).not.toHaveBeenCalled(); hook.unmount(); expect(disconnect).toHaveBeenCalledOnce();
});
