import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeGraphEdges } from '../../src/components/panels/nodes/canvas/NodeGraphEdges';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

vi.mock('../../src/components/panels/nodes/canvas/useNodeFlowActivity', () => ({ useNodeFlowActivity: () => undefined }));
const flow = vi.hoisted(() => vi.fn(() => null));
vi.mock('../../src/components/panels/nodes/canvas/NodeGraphFlowSignals', () => ({ NodeGraphFlowSignals: flow }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ nodeCableStyle: 'smart' }) }));
afterEach(() => vi.clearAllMocks());

describe('bounded genuine DOM fallback', () => {
  it('mounts at most 256 simple cables out of 3000, respects the viewport, and retains selection', () => {
    const nodesById = new Map(connectionFixture.nodes.map(node => [node.id, node]));
    const edges = Array.from({ length: 3000 }, (_, i) => ({ ...connectionFixture.edges[0], id: `edge${i}` }));
    const endpoints = getConnectionPlugs([edges[0]], nodesById);
    const plugs = edges.flatMap(edge => endpoints.map(plug => ({ ...plug, edge })));
    const graph = { ...connectionFixture, edges, get groups(): never { throw new Error('Large fallback must not partition groups'); } };
    const render = (visibleEdgeIds?: Set<string>) => renderToStaticMarkup(createElement(NodeGraphEdges, {
      graph, edges, plugs, nodesById, graphBounds: { left: 0, top: 0, right: 1000, bottom: 1000 }, zoom: 1,
      selectedEdgeId: 'edge2999', hoveredEdgeId: null, connectionDraft: null, visibleEdgeIds,
      onSelectEdge: () => {}, onClearSelectedEdge: () => {},
    }));
    const overview = render();
    expect(overview.match(/data-edge-id=/g)).toHaveLength(256);
    expect(overview).toContain('data-edge-id="edge2999"');
    expect(overview).not.toContain('<clipPath');
    const zoomed = render(new Set(['edge2997', 'edge2998', 'edge2999']));
    expect(zoomed.match(/data-edge-id=/g)).toHaveLength(3);
    expect(zoomed).not.toContain('data-edge-id="edge0"');
    expect(flow).not.toHaveBeenCalled();
  });
  it.each([2, 3000])('retains selected, hovered and captured cables outside the viewport in a %s-edge graph', count => {
    const nodesById = new Map(connectionFixture.nodes.map(node => [node.id, node]));
    const edges = Array.from({ length: count }, (_, i) => ({ ...connectionFixture.edges[0], id: `edge${i}` }));
    const endpoints = getConnectionPlugs([edges[0]], nodesById);
    const plugs = edges.flatMap(edge => endpoints.map(plug => ({ ...plug, edge })));
    for (const retained of ['selected', 'hovered', 'dragged']) {
      const markup = renderToStaticMarkup(createElement(NodeGraphEdges, {
        graph: { ...connectionFixture, edges }, edges, plugs, nodesById, graphBounds: { left: 0, top: 0, right: 1000, bottom: 1000 }, zoom: 1,
        selectedEdgeId: retained === 'selected' ? 'edge0' : null, hoveredEdgeId: retained === 'hovered' ? 'edge0' : null,
        connectionDraft: retained === 'dragged' ? { reconnectEdgeId: 'edge0', nodeId: 'Source', portId: 'out', direction: 'output',
          type: 'video', compatibilityKey: 'video', pointerId: 1, start: { x: 30, y: 30 }, end: { x: 100, y: 100 }, moved: false } : null,
        visibleEdgeIds: new Set(edges.slice(1).map(edge => edge.id)), onSelectEdge: () => {}, onClearSelectedEdge: () => {},
      }));
      expect(markup).toContain('data-edge-id="edge0"');
      expect(markup.match(/data-edge-id=/g)).toHaveLength(Math.min(256, count));
    }
    if (count > 256) expect(flow).not.toHaveBeenCalled();
  });
});
