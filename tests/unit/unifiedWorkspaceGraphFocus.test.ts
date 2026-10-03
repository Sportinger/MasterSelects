import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { useRequestedGroupFocus } from '../../src/components/panels/nodes/canvas/useRequestedGroupFocus';
import { useNodeFoldViewport } from '../../src/components/panels/nodes/canvas/useNodeFoldViewport';
import { fittedNodeViewport } from '../../src/components/panels/nodes/canvas/useNodeGraphViewport';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const group = { id: 'comp:clip:c:processing', label: 'Clip', color: '#888', proxyId: 'Source', nodeIds: ['Source'], collapsed: true };
const closed: NodeGraph = { ...connectionFixture, workspace: { clips: {}, defaultNodes: {} }, groups: [group] };
const open: NodeGraph = { ...closed, groups: [{ ...group, collapsed: false }] };
function canvas() {
  const element = document.createElement('div');
  Object.defineProperties(element, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  return { current: element };
}

describe('expanded clip viewport requests', () => {
  it('waits through root changes, controller loading and fold animation, then focuses once', () => {
    const element = canvas(), focus = vi.fn(), request = { id: group.id, nonce: 1 };
    const view = renderHook(({ graph, animating }) => useRequestedGroupFocus(element, graph, animating, request, focus),
      { initialProps: { graph: connectionFixture, animating: false } });
    view.rerender({ graph: closed, animating: false });
    view.rerender({ graph: open, animating: true });
    expect(focus).not.toHaveBeenCalled();
    view.rerender({ graph: open, animating: false });
    expect(focus).toHaveBeenCalledExactlyOnceWith(group.id);
    view.rerender({ graph: { ...open }, animating: false });
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it('yields to a manual gesture and accepts a new expansion request for the same group', () => {
    const element = canvas(), focus = vi.fn(), request = { id: group.id, nonce: 1 };
    const view = renderHook(({ graph, request }) => useRequestedGroupFocus(element, graph, false, request, focus),
      { initialProps: { graph: closed, request } });
    act(() => element.current.dispatchEvent(new Event('pointerdown')));
    view.rerender({ graph: open, request });
    expect(focus).not.toHaveBeenCalled();
    view.rerender({ graph: open, request: { ...request, nonce: 2 } });
    expect(focus).toHaveBeenCalledExactlyOnceWith(group.id);
  });
  it('keeps the existing fold camera request while an inline controller is loading', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const element = canvas(), visual = { current: { zoom: 1, panX: 0, panY: 0 } }, change = vi.fn();
    const bounds = { left: 0, top: 0, right: 9000, bottom: 6000 };
    const expandedBounds = { left: 300, top: 80, right: 2500, bottom: 1200 };
    const view = renderHook(({ graph }) => useNodeFoldViewport(element, graph, graph, graph, bounds, false, visual, change,
      new Map([[group.id, expandedBounds]])), { initialProps: { graph: closed } });
    act(() => view.result.current.request(false, group.id));
    view.rerender({ graph: { ...closed } });
    expect(change).not.toHaveBeenCalled();
    view.rerender({ graph: open });
    expect(change).toHaveBeenLastCalledWith(fittedNodeViewport(expandedBounds, 800, 600));
  });
});
