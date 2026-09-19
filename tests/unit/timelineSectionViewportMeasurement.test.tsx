import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTimelineSectionViewportMeasurement } from '../../src/components/timeline/hooks/useTimelineSectionViewportMeasurement';

let notify: ResizeObserverCallback;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function element(width: number, height: number) {
  const node = document.createElement('div');
  const size = { width, height };
  Object.defineProperties(node, {
    clientWidth: { get: () => size.width },
    clientHeight: { get: () => size.height },
  });
  return { node, size };
}

function setup() {
  const wrapper = element(1000, 320);
  const timeline = element(800, 320);
  const video = element(800, 200);
  const audio = element(800, 118);
  const setWidth = vi.fn();
  const props = {
    scrollWrapperRef: { current: wrapper.node },
    timelineRef: { current: timeline.node },
    timelineBodyRef: { current: null },
    trackHeaderWidth: 200,
    setTimelineViewportWidth: setWidth,
  };
  const hook = renderHook(() => {
    const result = useTimelineSectionViewportMeasurement(props);
    result.videoSectionViewportRef.current = video.node;
    result.audioSectionViewportRef.current = audio.node;
    return result;
  });
  const resize = (node: HTMLDivElement, width: number, height: number) => act(() => {
    notify([{
      target: node,
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
      contentRect: { width, height },
    } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  });
  return { ...hook, wrapper, timeline, video, audio, setWidth, resize };
}

it('keeps the measured split stable while a child reports a resize during track reflow', () => {
  const view = setup();
  expect(view.result.current.splitViewportHeight).toBe(320);
  view.setWidth.mockClear();
  // A child-only observation must not turn transient parent measurements into
  // new section targets (the reported 320 -> 155 -> 125 px jitter).
  view.wrapper.size.height = 155;
  view.timeline.size.width = 450;
  view.video.size.height = 90;
  view.resize(view.audio.node, 800, 110);
  expect(view.result.current.audioViewportHeight).toBe(110);
  expect(view.result.current.videoViewportHeight).toBe(200);
  expect(view.result.current.splitViewportHeight).toBe(320);
  expect(view.setWidth).not.toHaveBeenCalled();
  view.wrapper.size.height = 125;
  view.rerender();
  view.resize(view.audio.node, 800, 100);
  expect(view.result.current.splitViewportHeight).toBe(320);
});

it('accepts real container and timeline resizes independently', () => {
  const view = setup();
  view.resize(view.wrapper.node, 900, 240);
  expect(view.result.current.splitViewportHeight).toBe(240);
  expect(view.result.current.videoViewportHeight).toBe(200);
  view.resize(view.timeline.node, 700, 240);
  expect(view.setWidth).toHaveBeenLastCalledWith(700);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('still measures all viewports on an explicit window resize', () => {
  const view = setup();
  view.wrapper.size.height = 240;
  view.video.size.height = 140;
  view.audio.size.height = 98;
  view.timeline.size.width = 640;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(view.result.current.splitViewportHeight).toBe(240);
  expect(view.result.current.videoViewportHeight).toBe(140);
  expect(view.result.current.audioViewportHeight).toBe(98);
  expect(view.setWidth).toHaveBeenLastCalledWith(640);
});
