import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('synchronous genuine DOM renderer ownership', () => {
  it.each(['missing context', 'incomplete context'])('mounts interactive cards, ports, groups and cables before any frame with %s', kind => {
    vi.stubGlobal('Worker', undefined); vi.stubGlobal('OffscreenCanvas', undefined); vi.stubGlobal('Path2D', undefined);
    // No animation frame can rescue a pending renderer in this regression test.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return kind === 'missing context' ? null : { canvas: this, setTransform: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;
    });
    const graph = { ...connectionFixture, groups: [{ id: 'group', label: 'Example', color: '#fff', collapsed: false,
      proxyId: 'Source', nodeIds: ['Source', 'Surface'] }] };
    const view = render(createElement(NodeGraphCanvas, { graph, selectedNodeId: null, onSelectNode: vi.fn(), onToggleGroup: vi.fn() }));
    expect(view.container.querySelector('.node-graph-canvas-surface')).toHaveAttribute('data-renderer', 'dom');
    expect(view.container.querySelectorAll('.node-workspace-node')).toHaveLength(graph.nodes.length);
    expect(view.container.querySelectorAll('.node-workspace-port')).toHaveLength(8);
    expect(view.container.querySelectorAll('.node-workspace-edge-hit')).toHaveLength(2);
    expect(view.container.querySelectorAll('.node-workspace-plug[data-edge-id]')).toHaveLength(4);
    expect(view.getByRole('button', { name: 'Collapse Example group' })).toBeInTheDocument();
  });
});
