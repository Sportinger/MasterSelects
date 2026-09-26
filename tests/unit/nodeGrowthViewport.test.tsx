import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { useNodeGrowthViewport } from '../../src/components/panels/nodes/canvas/useNodeGrowthViewport';

afterEach(cleanup);
const graph = (...ids: string[]) => ({ id: 'clip-a', nodes: ids.map(id => ({ id })), edges: [] }) as unknown as NodeGraph;
const small = { left: 0, top: 0, right: 100, bottom: 100 };
const large = { ...small, right: 1400 };
function setup() {
  const element = document.createElement('div');
  Object.defineProperties(element, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const canvas = { current: element }, fit = vi.fn();
  const hook = renderHook(({ value, bounds, animating }) => useNodeGrowthViewport(canvas, value, bounds, animating, fit),
    { initialProps: { value: graph('source'), bounds: small, animating: false } });
  return { ...hook, element, fit };
}
describe('node graph growth framing', () => {
  it('follows offscreen additions during layout, but not ordinary changes', () => {
    const { rerender, fit } = setup();
    rerender({ value: graph('source', 'mix'), bounds: large, animating: true });
    expect(fit).toHaveBeenCalledExactlyOnceWith(large);
    const intermediate = { ...large, right: 1700 };
    rerender({ value: graph('source', 'mix'), bounds: intermediate, animating: true });
    expect(fit).toHaveBeenLastCalledWith(intermediate);
    rerender({ value: graph('source', 'mix'), bounds: large, animating: false });
    expect(fit).toHaveBeenLastCalledWith(large);
    fit.mockClear();
    rerender({ value: graph('source', 'mix'), bounds: { ...large, right: 1800 }, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
  it('refits remaining nodes throughout removal layout, then leaves manual moves alone', () => {
    const { rerender, fit } = setup();
    rerender({ value: graph('source', 'mix'), bounds: large, animating: false });
    fit.mockClear();
    rerender({ value: graph('source'), bounds: small, animating: true });
    expect(fit).toHaveBeenCalledExactlyOnceWith(small);
    const settled = { ...small, right: 200 };
    rerender({ value: graph('source'), bounds: settled, animating: false });
    expect(fit).toHaveBeenLastCalledWith(settled);
    fit.mockClear();
    rerender({ value: graph('source'), bounds: large, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
  it('detects replacement at the same node count and safely handles an empty graph', () => {
    const { rerender, fit } = setup();
    rerender({ value: graph('replacement'), bounds: small, animating: false });
    expect(fit).toHaveBeenCalledExactlyOnceWith(small);
    fit.mockClear();
    rerender({ value: graph(), bounds: small, animating: false });
    expect(fit).not.toHaveBeenCalled();
    rerender({ value: graph('new'), bounds: large, animating: false });
    expect(fit).toHaveBeenCalledExactlyOnceWith(large);
  });
  it.each(['pointerdown', 'wheel'])('lets %s cancel removal framing', event => {
    const { rerender, fit, element } = setup();
    rerender({ value: graph('source', 'mix'), bounds: large, animating: false });
    rerender({ value: graph('source'), bounds: small, animating: true });
    fit.mockClear();
    act(() => element.dispatchEvent(new Event(event)));
    rerender({ value: graph('source'), bounds: small, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
  it('refits visible additions and lets manual navigation cancel the follow', () => {
    const { rerender, element, fit } = setup();
    rerender({ value: graph('source', 'mix'), bounds: small, animating: false });
    expect(fit).toHaveBeenCalledExactlyOnceWith(small);
    rerender({ value: graph('source', 'mix', 'output'), bounds: large, animating: true });
    fit.mockClear();
    act(() => element.dispatchEvent(new Event('wheel')));
    rerender({ value: graph('source', 'mix', 'output'), bounds: large, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
  it('leaves graph switches and existing group folding to their own camera handling', () => {
    const { rerender, fit } = setup();
    const folded = { ...graph('source'), groups: [{ id: 'effect', collapsed: true, nodeIds: [] }] } as unknown as NodeGraph;
    rerender({ value: folded, bounds: small, animating: false });
    rerender({ value: { ...folded, nodes: graph('source', 'mix').nodes,
      groups: folded.groups!.map(group => ({ ...group, collapsed: false })) }, bounds: large, animating: false });
    rerender({ value: { ...graph('new-source'), id: 'clip-b' }, bounds: large, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
});
