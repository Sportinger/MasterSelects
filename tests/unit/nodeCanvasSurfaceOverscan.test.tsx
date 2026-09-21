import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import type { CanvasMessage } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

const renderer = vi.hoisted(() => ({
  update: vi.fn(), viewport: vi.fn(), present: (_revision: number) => {},
}));
vi.mock('../../src/components/panels/nodes/canvas/rendering/nodeCanvasRuntime', async importOriginal => ({
  ...await importOriginal<object>(),
  createNodeCanvasRuntime: (_host: HTMLElement, _ready: unknown, presented: (revision: number) => void) => {
    renderer.present = presented;
    return { update: renderer.update, dispose: vi.fn() };
  },
}));
vi.mock('../../src/components/panels/nodes/previews/NodePreviewController', () => ({
  NodePreviewController: class {
    scene() {} visibility() {} suspend() {} reset() {} dispose() {}
    viewport = renderer.viewport;
  },
}));

import { NodeGraphCanvasSurface } from '../../src/components/panels/nodes/canvas/rendering/NodeGraphCanvasSurface';

describe('node canvas overscan presentation', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('prepares previews outside the screen and acknowledges the logical view of each presented frame', () => {
    const initial = { panX: -400, panY: -200, zoom: 0.26 };
    const rendered = vi.fn();
    const nodes = connectionFixture.nodes.map(node => node.id === 'Geometry'
      ? { ...node, layout: { x: 5000, y: 270 } } : node);
    const graph = { ...connectionFixture, nodes, groups: [{ id: 'wide', label: 'Wide group', color: '#55a6c4',
      collapsed: false, nodeIds: nodes.map(node => node.id), proxyId: 'proxy' }] };
    const props = { graph, nodes, plugs: [],
      selection: new Set<string>(), selectedNodeId: null, selectedEdgeId: null, hoveredEdgeId: null,
      hoveredPort: null, draft: null, canBypass: false, surfaceRef: createRef<HTMLDivElement>(), backgroundRef: createRef<HTMLDivElement>(),
      onReady: vi.fn(), onViewRendered: rendered };
    const surface = render(<NodeGraphCanvasSurface {...props} viewport={initial} />);
    const lastView = () => renderer.update.mock.calls.map(([message]) => message as CanvasMessage)
      .filter(message => message.type === 'view').at(-1)!;
    const first = lastView();
    expect(first.view).toMatchObject({ panX: -144, panY: 56, width: 1512, height: 1212, zoom: 0.26 });
    expect(renderer.viewport).toHaveBeenLastCalledWith(first.view);
    expect(props.surfaceRef.current?.style.getPropertyValue('--node-canvas-overscan')).toBe('256px');
    const fill = props.backgroundRef.current!.firstElementChild as HTMLElement;
    const fullWidth = fill.style.width;
    expect(parseFloat(fullWidth)).toBeGreaterThan(5000);

    const next = { panX: -300, panY: -150, zoom: 0.18 };
    surface.rerender(<NodeGraphCanvasSurface {...props} viewport={next} />);
    expect(fill.style.width).toBe(fullWidth);
    const second = lastView();
    // The old bitmap can arrive after a new pan/zoom request. Correct against
    // that bitmap's original logical origin, never the padded or newest view.
    renderer.present(first.revision!);
    expect(rendered).toHaveBeenLastCalledWith(initial);
    renderer.present(second.revision!);
    expect(rendered).toHaveBeenLastCalledWith(next);
    expect(renderer.viewport).toHaveBeenLastCalledWith(second.view);
  });
});
