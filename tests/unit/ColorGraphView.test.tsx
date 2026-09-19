import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorGraphView } from '../../src/components/panels/color/ColorGraphView';
import type {
  ConnectionDragState,
  ColorEditorEdge,
  ColorEditorNode,
} from '../../src/components/panels/color/colorEditorTypes';

const nodes: ColorEditorNode[] = [
  {
    id: 'input',
    type: 'input',
    name: 'Input',
    enabled: true,
    params: {},
    position: { x: 0, y: 80 },
    inputs: [],
    outputs: [{ id: 'out', label: 'Image', type: 'texture' }],
  },
  {
    id: 'grade',
    type: 'primary',
    name: 'Primary',
    enabled: true,
    params: {},
    position: { x: 160, y: 80 },
    inputs: [
      { id: 'in', label: 'Image', type: 'texture' },
      { id: 'key-in', label: 'Key', type: 'mask' },
    ],
    outputs: [
      { id: 'out', label: 'Image', type: 'texture' },
      { id: 'key-out', label: 'Key', type: 'mask' },
    ],
  },
  {
    id: 'layer',
    type: 'layer-mixer',
    name: 'Layer Mixer',
    enabled: true,
    params: {},
    position: { x: 280, y: 120 },
    inputs: [
      { id: 'in', label: 'Image 1', type: 'texture' },
      { id: 'in-2', label: 'Image 2', type: 'texture' },
    ],
    outputs: [{ id: 'out', label: 'Image', type: 'texture' }],
  },
  {
    id: 'source',
    type: 'source',
    name: 'Source',
    enabled: true,
    params: {},
    position: { x: 0, y: 116 },
    inputs: [],
    outputs: [{ id: 'out', label: 'Image', type: 'texture' }],
  },
  {
    id: 'alpha-output',
    type: 'alpha-output',
    name: 'Alpha Output',
    enabled: true,
    params: {},
    position: { x: 400, y: 116 },
    inputs: [{ id: 'key-in', label: 'Key', type: 'mask' }],
    outputs: [],
  },
];

function renderGraph(
  edges: ColorEditorEdge[] = [],
  selectedNodeId = 'grade',
  connectionDrag: ConnectionDragState | null = null,
  selectedEdgeId: string | null = null,
) {
  const onAddNode = vi.fn();
  const onEdgeRemove = vi.fn();
  const onEdgeSelect = vi.fn();
  const onNodeRemove = vi.fn();
  const onNodeEnabledChange = vi.fn();
  const props = {
    canvasRef: createRef<HTMLDivElement>(),
    nodes,
    edges,
    workspace: true,
    isPanning: false,
    selectedNodeId,
    selectedNodeIds: [],
    selectedEdgeId,
    connectionDrag,
    marquee: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodeDisplayMode: 'thumbnail' as const,
    addNodeDisabled: false,
    onCanvasPointerDown: vi.fn(),
    onCanvasWheel: vi.fn(),
    onCanvasClick: vi.fn(),
    onResetAll: vi.fn(),
    onResetNodeStackLayers: vi.fn(),
    onAddNode,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomToWindow: vi.fn(),
    onOriginalSize: vi.fn(),
    onToggleDisplayMode: vi.fn(),
    onResetNodePositions: vi.fn(),
    onNodeRemove,
    onNodePointerDown: vi.fn(),
    onNodeSelect: vi.fn(),
    onNodeEnabledChange,
    onConnectionStart: vi.fn(),
    onEdgeSelect,
    onEdgeRemove,
  };
  const rendered = render(<ColorGraphView {...props} />);
  return {
    ...rendered,
    onAddNode,
    onEdgeRemove,
    onEdgeSelect,
    onNodeEnabledChange,
    onNodeRemove,
  };
}

describe('ColorGraphView', () => {
  it('shows the full Resolve-style graph menu and dispatches node types', () => {
    const { container, onAddNode } = renderGraph();
    const canvas = container.querySelector('.color-graph-canvas')!;

    fireEvent.contextMenu(canvas, { clientX: 300, clientY: 180 });

    expect(screen.getByText('Reset All Grades and Nodes')).toBeInTheDocument();
    expect(screen.getByText('Reset All Node Stack Layers')).toBeInTheDocument();
    expect(screen.getByText('Parallel Mixer')).toBeInTheDocument();
    expect(screen.getByText('Layer Mixer')).toBeInTheDocument();
    expect(screen.getByText('Key Mixer')).toBeInTheDocument();
    expect(screen.getByText('Splitter')).toBeInTheDocument();
    expect(screen.getByText('Combiner')).toBeInTheDocument();
    expect(screen.getByText('Add Alpha Output')).toBeInTheDocument();
    expect(screen.getByText('Zoom to Window')).toBeInTheDocument();
    expect(screen.getByText('Toggle Display Mode')).toBeInTheDocument();
    expect(screen.getByText('Cleanup Node Graph')).toBeInTheDocument();
    expect(screen.queryByText('Reset Node Positions')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add Source'));
    expect(onAddNode).toHaveBeenCalledWith('source');
  });

  it('renders separate image and key ports for correctors', () => {
    const { container } = renderGraph();
    const grade = container.querySelector<HTMLElement>('[data-color-node-id="grade"][data-color-node-role="grade"]')!;
    const input = container.querySelector<HTMLElement>('[data-color-node-id="input"][data-color-node-role="anchor"]')!;

    expect(grade.querySelectorAll('.color-graph-port.texture')).toHaveLength(2);
    expect(grade.querySelectorAll('.color-graph-port.mask')).toHaveLength(2);
    expect(grade).toHaveAttribute('title', 'Corrector');
    expect(grade.style.width).toBe('64px');
    expect(grade.style.height).toBe('58px');
    expect(parseFloat(grade.querySelector<HTMLElement>('[data-color-port-id="in"]')!.style.top)).toBeCloseTo(58 * 0.28);
    expect(parseFloat(grade.querySelector<HTMLElement>('[data-color-port-id="key-in"]')!.style.top)).toBeCloseTo(58 * 0.72);
    expect(input.style.width).toBe('14px');
    expect(input.style.height).toBe('24px');
  });

  it('toggles a corrector from its number and renders no separate FX button', () => {
    const { container, onNodeEnabledChange } = renderGraph();
    const number = screen.getByRole('button', { name: 'Disable Corrector' });

    expect(number).toHaveTextContent('01');
    expect(number).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.color-graph-node-enable')).not.toBeInTheDocument();

    fireEvent.click(number);
    expect(onNodeEnabledChange).toHaveBeenCalledWith('grade', false);
  });

  it('renders compact Resolve-style structure nodes with their node-type icons', () => {
    const { container } = renderGraph([], 'layer');
    const layer = container.querySelector<HTMLElement>('[data-color-node-id="layer"]')!;

    expect(layer.style.width).toBe('30px');
    expect(layer.style.height).toBe('54px');
    expect(layer).toHaveClass('selected');
    expect(layer.querySelector('.color-graph-structure-icon')).toBeInTheDocument();
    expect(layer).not.toHaveTextContent('Layer Mixer');
  });

  it('keeps added anchors immovable-looking but offers deletion only for the added ones', () => {
    const { container, onNodeRemove } = renderGraph();
    const input = container.querySelector<HTMLElement>('[data-color-node-id="input"]')!;
    const source = container.querySelector<HTMLElement>('[data-color-node-id="source"]')!;
    const alphaOutput = container.querySelector<HTMLElement>('[data-color-node-id="alpha-output"]')!;

    expect(source).toHaveAttribute('data-color-node-role', 'anchor');
    expect(source.style.width).toBe('14px');
    expect(source.style.height).toBe('24px');
    expect(alphaOutput).toHaveAttribute('data-color-node-role', 'anchor');

    fireEvent.contextMenu(input, { clientX: 20, clientY: 100 });
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();

    fireEvent.contextMenu(source, { clientX: 40, clientY: 160 });
    fireEvent.click(screen.getByText('Delete Node'));
    expect(onNodeRemove).toHaveBeenCalledWith('source');

    fireEvent.contextMenu(alphaOutput, { clientX: 420, clientY: 160 });
    fireEvent.click(screen.getByText('Delete Node'));
    expect(onNodeRemove).toHaveBeenCalledWith('alpha-output');
  });

  it('highlights a connected edge and shows its signal while a port is hovered', () => {
    const edge: ColorEditorEdge = {
      id: 'edge-hover',
      fromNodeId: 'input',
      fromPortId: 'out',
      toNodeId: 'grade',
      toPortId: 'in',
      type: 'texture',
    };
    const { container } = renderGraph([edge]);
    const inputPort = container.querySelector<HTMLElement>(
      '[data-color-node-id="grade"][data-color-port-direction="input"][data-color-port-id="in"]',
    )!;
    const pathValues = container
      .querySelector('[data-color-edge-id="edge-hover"] .color-graph-edge')!
      .getAttribute('d')!
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);

    expect(pathValues[0]).toBeCloseTo(11);
    expect(pathValues[2]).toBeCloseTo(148);

    const targetHalfValues = container
      .querySelector('[data-color-edge-id="edge-hover"] [data-color-edge-half="target"]')!
      .getAttribute('d')!
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number);
    expect(targetHalfValues[0]).toBeCloseTo((pathValues[0] + pathValues[2]) / 2);
    expect(targetHalfValues[1]).toBeCloseTo((pathValues[1] + pathValues[3]) / 2);
    expect(targetHalfValues.slice(2)).toEqual(pathValues.slice(2));

    fireEvent.pointerEnter(inputPort);

    expect(container.querySelector('[data-color-edge-id="edge-hover"] .color-graph-edge')).toHaveClass('port-hover');
    expect(screen.getByRole('tooltip')).toHaveTextContent('RGB');

    fireEvent.pointerLeave(inputPort);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('marks only the valid connection-drag target pin', () => {
    const connectionDrag: ConnectionDragState = {
      fromNodeId: 'input',
      fromPortId: 'out',
      type: 'texture',
      start: { x: 12.5, y: 109 },
      current: { x: 148, y: 96 },
      validTarget: { nodeId: 'grade', portId: 'in' },
    };
    const { container } = renderGraph([], 'grade', connectionDrag);
    const imageInput = container.querySelector(
      '[data-color-node-id="grade"][data-color-port-id="in"]',
    );
    const keyInput = container.querySelector(
      '[data-color-node-id="grade"][data-color-port-id="key-in"]',
    );

    expect(imageInput).toHaveClass('connection-valid-target');
    expect(keyInput).not.toHaveClass('connection-valid-target');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Image');
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '158px', top: '108px' });
  });

  it('offers Delete Edge in a context menu before removing a connection', () => {
    const edge: ColorEditorEdge = {
      id: 'edge-1',
      fromNodeId: 'input',
      fromPortId: 'out',
      toNodeId: 'grade',
      toPortId: 'in',
      type: 'texture',
    };
    const { container, onEdgeRemove } = renderGraph([edge]);

    fireEvent.contextMenu(container.querySelector('.color-graph-edge-hit')!, {
      clientX: 120,
      clientY: 80,
    });

    expect(screen.getByText('Delete Edge')).toBeInTheDocument();
    expect(screen.queryByText('Reset All Grades and Nodes')).not.toBeInTheDocument();
    expect(onEdgeRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Delete Edge'));
    expect(onEdgeRemove).toHaveBeenCalledWith('edge-1');
  });

  it('selects an edge on the first click and removes it when clicked again', () => {
    const edge: ColorEditorEdge = {
      id: 'edge-click',
      fromNodeId: 'input',
      fromPortId: 'out',
      toNodeId: 'grade',
      toPortId: 'in',
      type: 'texture',
    };
    const firstClick = renderGraph([edge]);

    fireEvent.click(firstClick.container.querySelector('.color-graph-edge-hit')!);
    expect(firstClick.onEdgeSelect).toHaveBeenCalledWith('edge-click');
    expect(firstClick.onEdgeRemove).not.toHaveBeenCalled();
    firstClick.unmount();

    const secondClick = renderGraph([edge], 'grade', null, 'edge-click');
    expect(secondClick.container.querySelector('.color-graph-edge')).toHaveClass('selected');
    fireEvent.click(secondClick.container.querySelector('.color-graph-edge-hit')!);
    expect(secondClick.onEdgeRemove).toHaveBeenCalledWith('edge-click');
    expect(secondClick.onEdgeSelect).not.toHaveBeenCalled();
  });

  it('disconnects an edge immediately from its blue target half', () => {
    const edge: ColorEditorEdge = {
      id: 'edge-flow-click',
      fromNodeId: 'input',
      fromPortId: 'out',
      toNodeId: 'grade',
      toPortId: 'in',
      type: 'texture',
    };
    const { container, onEdgeRemove, onEdgeSelect } = renderGraph([edge]);

    fireEvent.click(container.querySelector('[data-color-edge-action="disconnect-target"]')!);
    expect(onEdgeRemove).toHaveBeenCalledWith('edge-flow-click');
    expect(onEdgeSelect).not.toHaveBeenCalled();
  });

  it('moves and scales the grid with the graph viewport', () => {
    const { container } = render(
      <ColorGraphView
        canvasRef={createRef<HTMLDivElement>()}
        nodes={nodes}
        edges={[]}
        workspace
        isPanning={false}
        selectedNodeId="grade"
        selectedNodeIds={[]}
        selectedEdgeId={null}
        connectionDrag={null}
        marquee={null}
        viewport={{ x: 24, y: -18, zoom: 1.5 }}
        nodeDisplayMode="thumbnail"
        addNodeDisabled={false}
        onCanvasPointerDown={vi.fn()}
        onCanvasWheel={vi.fn()}
        onCanvasClick={vi.fn()}
        onResetAll={vi.fn()}
        onResetNodeStackLayers={vi.fn()}
        onAddNode={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomToWindow={vi.fn()}
        onOriginalSize={vi.fn()}
        onToggleDisplayMode={vi.fn()}
        onResetNodePositions={vi.fn()}
        onNodeRemove={vi.fn()}
        onNodePointerDown={vi.fn()}
        onNodeSelect={vi.fn()}
        onNodeEnabledChange={vi.fn()}
        onConnectionStart={vi.fn()}
        onEdgeSelect={vi.fn()}
        onEdgeRemove={vi.fn()}
      />,
    );
    const graph = container.querySelector('.color-graph-scroll') as HTMLElement;
    const grade = container.querySelector<HTMLElement>('[data-color-node-id="grade"]')!;
    expect(graph.style.backgroundPosition).toBe('24px -18px');
    expect(graph.style.backgroundSize).toBe('78px 78px');
    expect(grade.style.transform).toBe(`scale(${1 / 1.5})`);
    expect(grade.style.width).toBe('64px');
    expect(grade.style.height).toBe('58px');
  });
});
