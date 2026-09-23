import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { useNodeGrowthViewport } from '../../src/components/panels/nodes/canvas/useNodeGrowthViewport';

afterEach(cleanup);
const graph = (...ids: string[]) => ({ id: 'clip-a', nodes: ids.map(id => ({ id })) }) as NodeGraph;
const small = { left: 0, top: 0, right: 100, bottom: 100 };
const large = { ...small, right: 1400 };
function setup() {
  const element = document.createElement('div');
  Object.defineProperties(element, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const canvas = { current: element }, visual = { current: { zoom: 1, panX: 50, panY: 50 } }, fit = vi.fn();
  const hook = renderHook(({ value, bounds, animating }) => useNodeGrowthViewport(canvas, value, bounds, animating, visual, fit),
    { initialProps: { value: graph('source'), bounds: small, animating: false } });
  return { ...hook, element, fit };
}
describe('node graph growth framing', () => {
  it('fits new offscreen nodes after layout settles, but not ordinary changes or removals', () => {
    const { rerender, fit } = setup();
    rerender({ value: graph('source', 'mix'), bounds: large, animating: true });
    expect(fit).not.toHaveBeenCalled();
    rerender({ value: graph('source', 'mix'), bounds: large, animating: false });
    expect(fit).toHaveBeenCalledExactlyOnceWith(large);
    fit.mockClear();
    rerender({ value: graph('source', 'mix'), bounds: { ...large, right: 1800 }, animating: false });
    rerender({ value: graph('source'), bounds: large, animating: false });
    expect(fit).not.toHaveBeenCalled();
  });
  it('keeps visible additions and manual navigation in place', () => {
    const { rerender, element, fit } = setup();
    rerender({ value: graph('source', 'mix'), bounds: small, animating: false });
    expect(fit).not.toHaveBeenCalled();
    rerender({ value: graph('source', 'mix', 'output'), bounds: large, animating: true });
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
