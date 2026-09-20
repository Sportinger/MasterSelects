import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNodeGraphViewport } from '../../src/components/panels/nodes/canvas/useNodeGraphViewport';
import { DEFAULT_VIEWPORT, MAX_ZOOM, MIN_ZOOM } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import type { Viewport } from '../../src/components/panels/nodes/canvas/canvasGeometry';

let now: number;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
let reducedMotion: boolean;

beforeEach(() => {
  now = 0;
  frameId = 0;
  frames = new Map();
  reducedMotion = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reducedMotion; } }));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function tick(ms = 1000 / 60) {
  act(() => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  });
}

function settle() {
  for (let i = 0; frames.size > 0 && i < 120; i++) tick();
  expect(frames.size).toBe(0);
}

function setup() {
  const canvas = document.createElement('div');
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect;
  const ref = { current: canvas };
  const hook = renderHook(() => useNodeGraphViewport(ref));
  const wheel = (deltaY: number, extra: WheelEventInit = {}) => {
    const event = new WheelEvent('wheel', {
      deltaY, clientX: 400, clientY: 250, bubbles: true, cancelable: true, ...extra,
    });
    act(() => { canvas.dispatchEvent(event); });
    return event;
  };
  return { ...hook, canvas, wheel };
}

function point(view: Viewport, x = 300, y = 200) {
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

describe('node graph wheel zoom', () => {
  it('smooths a wheel notch across frames while keeping the cursor point fixed', () => {
    const view = setup();
    const anchor = point(view.result.current.viewport);
    expect(view.wheel(-100).defaultPrevented).toBe(true);
    expect(view.result.current.viewport).toEqual(DEFAULT_VIEWPORT);
    tick();
    const firstZoom = view.result.current.viewport.zoom;
    expect(firstZoom).toBeGreaterThan(DEFAULT_VIEWPORT.zoom);
    tick();
    expect(view.result.current.viewport.zoom).toBeGreaterThan(firstZoom);
    expect(point(view.result.current.viewport).x).toBeCloseTo(anchor.x, 10);
    expect(point(view.result.current.viewport).y).toBeCloseTo(anchor.y, 10);
    settle();
    expect(view.result.current.viewport.zoom).toBeGreaterThan(firstZoom);
    expect(point(view.result.current.viewport).x).toBeCloseTo(anchor.x, 10);
    expect(point(view.result.current.viewport).y).toBeCloseTo(anchor.y, 10);
  });

  it('preserves fractional trackpad input and ignores horizontal-only events', () => {
    const view = setup();
    view.wheel(0, { deltaX: 100 });
    expect(frames.size).toBe(0);
    expect(view.result.current.viewport).toEqual(DEFAULT_VIEWPORT);
    view.wheel(-0.25);
    settle();
    expect(view.result.current.viewport.zoom).toBeGreaterThan(DEFAULT_VIEWPORT.zoom);
    expect(view.result.current.viewport.zoom / DEFAULT_VIEWPORT.zoom).toBeLessThan(1.001);
  });

  it('uses scroll distance rather than event count, including bursts before a frame', () => {
    const view = setup();
    view.wheel(-100);
    settle();
    const single = view.result.current.viewport;
    act(() => view.result.current.setViewport(DEFAULT_VIEWPORT));
    for (let i = 0; i < 100; i++) view.wheel(-1);
    expect(frames.size).toBe(1);
    settle();
    expect(view.result.current.viewport.zoom).toBeCloseTo(single.zoom, 10);
    expect(view.result.current.viewport.panX).toBeCloseTo(single.panX, 10);
  });

  it('applies equal proportional changes at different scales and reverses symmetrically', () => {
    const view = setup();
    view.wheel(-80);
    settle();
    const factor = view.result.current.viewport.zoom / DEFAULT_VIEWPORT.zoom;
    act(() => view.result.current.setViewport({ ...DEFAULT_VIEWPORT, zoom: 0.4 }));
    view.wheel(-80);
    settle();
    expect(view.result.current.viewport.zoom / 0.4).toBeCloseTo(factor, 10);
    view.wheel(80);
    settle();
    expect(view.result.current.viewport.zoom).toBeCloseTo(0.4, 10);
    expect(view.result.current.viewport.panX).toBeCloseTo(DEFAULT_VIEWPORT.panX, 10);
    expect(view.result.current.viewport.panY).toBeCloseTo(DEFAULT_VIEWPORT.panY, 10);
  });

  it('normalizes pixel, line and page wheel units', () => {
    const view = setup();
    const results = [[48, 0], [3, 1], [0.08, 2]].map(([deltaY, deltaMode]) => {
      act(() => view.result.current.setViewport(DEFAULT_VIEWPORT));
      view.wheel(deltaY, { deltaMode });
      settle();
      return view.result.current.viewport.zoom;
    });
    expect(results[1]).toBeCloseTo(results[0], 10);
    expect(results[2]).toBeCloseTo(results[0], 10);
  });

  it.each([[MAX_ZOOM, -100000], [MIN_ZOOM, 100000]])('clamps at %s without accumulating overscroll', (limit, delta) => {
    const view = setup();
    view.wheel(delta);
    settle();
    expect(view.result.current.viewport.zoom).toBeCloseTo(limit, 10);
    const atLimit = view.result.current.viewport;
    for (let i = 0; i < 10; i++) view.wheel(delta);
    settle();
    expect(view.result.current.viewport.panX).toBeCloseTo(atLimit.panX, 10);
    view.wheel(-Math.sign(delta));
    tick();
    expect(Math.sign(view.result.current.viewport.zoom - limit)).toBe(Math.sign(delta));
    settle();
  });

  it('reanchors to the displayed graph when the pointer moves during scrolling', () => {
    const view = setup();
    view.wheel(-100);
    tick();
    const anchor = point(view.result.current.viewport, 500, 350);
    view.wheel(-30, { clientX: 600, clientY: 400 });
    tick();
    expect(point(view.result.current.viewport, 500, 350).x).toBeCloseTo(anchor.x, 10);
    settle();
    expect(point(view.result.current.viewport, 500, 350).y).toBeCloseTo(anchor.y, 10);
  });

  it('uses elapsed time rather than frame count for smoothing', () => {
    const view = setup();
    view.wheel(-100);
    for (let i = 0; i < 6; i++) tick(1000 / 60);
    const at60Hz = view.result.current.viewport.zoom;
    act(() => view.result.current.setViewport(DEFAULT_VIEWPORT));
    view.wheel(-100);
    for (let i = 0; i < 12; i++) tick(1000 / 120);
    expect(view.result.current.viewport.zoom).toBeCloseTo(at60Hz, 10);
  });

  it('cancels pending zoom for pointer gestures and explicit viewport changes', () => {
    const view = setup();
    view.wheel(-100);
    tick();
    act(() => view.canvas.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    const stopped = view.result.current.viewport;
    settle();
    expect(view.result.current.viewport).toEqual(stopped);
    view.wheel(-100);
    act(() => view.result.current.setViewport({ zoom: 0.5, panX: 10, panY: 20 }));
    settle();
    expect(view.result.current.viewport).toEqual({ zoom: 0.5, panX: 10, panY: 20 });
    act(() => view.result.current.setViewport(current => ({ ...current, panX: 15 })));
    expect(view.result.current.viewport.panX).toBe(15);
  });

  it('honors reduced motion, consumes pinch zoom and cleans up on unmount', () => {
    const view = setup();
    reducedMotion = true;
    expect(view.wheel(-1, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(view.result.current.viewport.zoom).toBeGreaterThan(DEFAULT_VIEWPORT.zoom);
    expect(frames.size).toBe(0);
    reducedMotion = false;
    view.wheel(-100);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(view.wheel(-100).defaultPrevented).toBe(false);
  });
});
