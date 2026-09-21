import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNodeFoldViewport } from '../../src/components/panels/nodes/canvas/useNodeFoldViewport';
import { fittedNodeViewport } from '../../src/components/panels/nodes/canvas/useNodeGraphViewport';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('viewport following the actual fold animation', () => {
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
