import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNodeFoldViewport } from '../../src/components/panels/nodes/canvas/useNodeFoldViewport';
import { fittedNodeViewport } from '../../src/components/panels/nodes/canvas/useNodeGraphViewport';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('viewport following the actual fold animation', () => {
  it('follows agent-driven group changes without a click request, then yields to a wheel gesture', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const canvas = document.createElement('div');
    Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 700 } });
    const element = { current: canvas }, visual = { current: { zoom: 1, panX: 0, panY: 0 } };
    const change = vi.fn((value) => { visual.current = value; });
    const group = { id: 'g', label: 'Group', proxyId: 'Source', nodeIds: ['Source'], collapsed: true };
    const closed = { ...connectionFixture, groups: [group] };
    const open = { ...closed, groups: [{ ...group, collapsed: false }] };
    const bounds = (right: number) => ({ left: 0, top: 0, right, bottom: 300 });
    const view = renderHook(({ source, shown, right, animating }: { source: NodeGraph; shown: NodeGraph; right: number; animating: boolean }) =>
      useNodeFoldViewport(element, source, source, shown, bounds(right), animating, visual, change),
    { initialProps: { source: closed, shown: closed, right: 900, animating: false } });
    view.rerender({ source: open, shown: closed, right: 1800, animating: true });
    expect(change).toHaveBeenCalled();
    view.rerender({ source: open, shown: open, right: 4000, animating: false });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(bounds(4000), 1200, 700));
    view.rerender({ source: closed, shown: open, right: 1800, animating: true });
    const count = change.mock.calls.length;
    act(() => canvas.dispatchEvent(new WheelEvent('wheel')));
    view.rerender({ source: closed, shown: closed, right: 900, animating: false });
    expect(change).toHaveBeenCalledTimes(count);
  });
  it('focuses one growing group and restores the viewport from before its expansion on collapse', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const canvas = document.createElement('div');
    Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 700 } });
    const element = { current: canvas }, original = { zoom: 0.6, panX: 230, panY: -80 }, visual = { current: original };
    const change = vi.fn((value) => { visual.current = value; });
    const group = { id: 'g', label: 'Group', proxyId: 'Source', nodeIds: ['Source'], collapsed: true };
    const initial = { ...connectionFixture, groups: [group] }, open = { ...initial, groups: [{ ...group, collapsed: false }] };
    const all = { left: 0, top: 0, right: 9000, bottom: 6000 }, small = { left: 600, top: 100, right: 1100, bottom: 400 };
    const wide = { ...small, right: 2100 };
    const view = renderHook(({ source, target, shown, bounds, animating }: { source: NodeGraph; target: NodeGraph; shown: NodeGraph; bounds: typeof all; animating: boolean }) =>
      useNodeFoldViewport(element, source, target, shown, all, animating, visual, change, new Map([['g', bounds]])),
    { initialProps: { source: initial, target: initial, shown: initial, bounds: small, animating: false } });
    act(() => view.result.current.request(false, 'g')); now = 240;
    view.rerender({ source: open, target: open, shown: initial, bounds: small, animating: true });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(small, 1200, 700));
    view.rerender({ source: open, target: open, shown: open, bounds: wide, animating: false });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(wide, 1200, 700));
    // Manual navigation after expanding must not overwrite the return address.
    visual.current = { zoom: 1.2, panX: 90, panY: 30 };
    act(() => view.result.current.request(true, 'g')); now = 300;
    view.rerender({ source: initial, target: initial, shown: open, bounds: wide, animating: true });
    expect(change.mock.lastCall![0].zoom).toBeGreaterThan(original.zoom);
    expect(change.mock.lastCall![0].zoom).toBeLessThan(1.2);
    now = 500;
    view.rerender({ source: initial, target: initial, shown: initial, bounds: small, animating: false });
    expect(change).toHaveBeenLastCalledWith(original);
  });
  it.each([false, true])('fits every displayed intermediate size with collapsed=%s and yields to manual navigation', collapsed => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const canvas = document.createElement('div');
    Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 700 } });
    const element = { current: canvas }, visual = { current: { zoom: 0.8, panX: 0, panY: 0 } }, change = vi.fn();
    const group = { id: 'g', label: 'Group', color: '#fff', proxyId: 'Source', nodeIds: ['Source'], collapsed: !collapsed };
    const initial = { ...connectionFixture, groups: [group] }, target = { ...initial, groups: [{ ...group, collapsed }] };
    const size = (right: number) => ({ left: 0, top: 0, right, bottom: 300 });
    const view = renderHook(({ source, shown, width, animating }: { source: NodeGraph; shown: NodeGraph; width: number; animating: boolean }) =>
      useNodeFoldViewport(element, source, target, shown, size(width), animating, visual, change),
    { initialProps: { source: initial, shown: initial, width: 900, animating: false } });
    act(() => view.result.current.request(collapsed));
    now = 240;
    const first = collapsed ? 4000 : 1800, second = collapsed ? 2200 : 4000;
    view.rerender({ source: target, shown: initial, width: first, animating: true });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(size(first), 1200, 700));
    view.rerender({ source: target, shown: initial, width: second, animating: true });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(size(second), 1200, 700));
    const calls = change.mock.calls.length;
    act(() => canvas.dispatchEvent(new WheelEvent('wheel')));
    view.rerender({ source: target, shown: target, width: collapsed ? 900 : 6000, animating: false });
    expect(change).toHaveBeenCalledTimes(calls);
  });
});
