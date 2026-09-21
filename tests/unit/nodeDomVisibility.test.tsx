import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { cableDomVisible, nodeDomVisible, nodeDomViewport, retainNodeDomViewport } from '../../src/components/panels/nodes/canvas/nodeDomVisibility';
import { useNodeDomViewport } from '../../src/components/panels/nodes/canvas/useNodeDomViewport';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { useNodeDomVisibility } from '../../src/components/panels/nodes/canvas/useNodeDomVisibility';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';

afterEach(cleanup);
const viewport = { panX: 0, panY: 0, zoom: 1 };
describe('node DOM viewport', () => {
  it('keeps the mounted region stable for small pans and replenishes before exposure', () => {
    const initial = nodeDomViewport(viewport, 800, 600);
    expect(retainNodeDomViewport(initial, { ...viewport, panX: 90, panY: -120 }, 800, 600)).toBe(initial);
    const shifted = retainNodeDomViewport(initial, { ...viewport, panX: 129 }, 800, 600);
    expect(shifted).not.toBe(initial);
    expect(shifted?.left).toBe(-385);
    expect(retainNodeDomViewport(initial, { ...viewport, zoom: 0.5 }, 800, 600)).not.toBe(initial);
    expect(retainNodeDomViewport(initial, { ...viewport, zoom: 2 }, 800, 600)).not.toBe(initial);
    expect(retainNodeDomViewport(initial, viewport, 1600, 600)).not.toBe(initial);
  });
  it('keeps DOM subtree props stable until viewport membership changes', () => {
    const nodes = connectionFixture.nodes, plugs = getConnectionPlugs(connectionFixture.edges, new Map(nodes.map(n => [n.id, n])));
    const view = { left: -10000, top: -10000, right: 10000, bottom: 10000 };
    const hook = renderHook(({ bounds }) => useNodeDomVisibility(nodes, plugs, bounds), { initialProps: { bounds: view } });
    const before = hook.result.current;
    hook.rerender({ bounds: { ...view, left: -9999 } });
    expect(hook.result.current.nodes).toBe(before.nodes);
    expect(hook.result.current.edgeIds).toBe(before.edgeIds);
    expect(hook.result.current.plugIds).toBe(before.plugIds);
    expect(hook.result.current.nodeIds).toBe(before.nodeIds);
    hook.rerender({ bounds: { left: 9000, top: 9000, right: 10000, bottom: 10000 } });
    expect(hook.result.current.nodes).toHaveLength(0);
    expect(hook.result.current.edgeIds.size).toBe(0);
  });
  it('retains a fixed screen-space margin across pan and zoom and reveals nodes on zoom out', () => {
    const node = { ...connectionFixture.nodes[0], layout: { x: 1400, y: 200 } };
    expect(nodeDomVisible(node, nodeDomViewport(viewport, 800, 600))).toBe(false);
    expect(nodeDomVisible(node, nodeDomViewport({ ...viewport, panX: -500 }, 800, 600))).toBe(true);
    expect(nodeDomVisible(node, nodeDomViewport({ ...viewport, zoom: 0.5 }, 800, 600))).toBe(true);
    expect(nodeDomViewport({ zoom: 0.5, panX: 100, panY: -100 }, 800, 600)).toEqual({ left: -712, right: 1912, top: -312, bottom: 1912 });
    expect(nodeDomVisible(node, nodeDomViewport(viewport, 0, 0))).toBe(true);
  });
  it('keeps crossing cables and backward bends with both nodes outside the viewport', () => {
    const view = { left: 0, top: 0, right: 800, bottom: 600 };
    expect(cableDomVisible({ x: -500, y: 300 }, { x: 1500, y: 300 }, view)).toBe(true);
    expect(cableDomVisible({ x: 830, y: 100 }, { x: 820, y: 400 }, view)).toBe(true);
    expect(cableDomVisible({ x: 1500, y: 100 }, { x: 2000, y: 400 }, view)).toBe(false);
    expect(cableDomVisible({ x: -500, y: -200 }, { x: 1500, y: -200 }, view)).toBe(false);
  });
  it('keeps focused controls and drag targets mounted until their interaction ends', () => {
    const canvas = document.createElement('div'), button = document.createElement('button');
    button.dataset.nodeId = 'node'; canvas.append(button); document.body.append(canvas);
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const ref = { current: canvas };
    const hook = renderHook(({ dragging }) => useNodeDomViewport(ref, viewport, dragging), { initialProps: { dragging: false } });
    expect(hook.result.current).not.toBeNull();
    act(() => button.focus()); expect(hook.result.current).toBeNull();
    act(() => button.blur()); expect(hook.result.current).not.toBeNull();
    hook.rerender({ dragging: true }); expect(hook.result.current).toBeNull();
    hook.rerender({ dragging: false }); expect(hook.result.current).not.toBeNull();
    hook.unmount(); canvas.remove();
  });
});
