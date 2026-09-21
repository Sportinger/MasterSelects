import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { memo } from 'react';
import type { NodeGraphNode } from '../../src/types/nodeGraph';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

const mocks = vi.hoisted(() => ({
  renders: new Map<string, number>(),
  toggleNode: vi.fn(),
  selectOutput: vi.fn(),
  preferences: { enabled: true, nodes: {} },
}));

vi.mock('../../src/components/panels/nodes/previews/useNodePreviewPreferences', () => ({
  useNodePreviewPreferences: () => ({
    preferences: mocks.preferences,
    toggleGlobal: vi.fn(),
    toggleNode: mocks.toggleNode,
    selectOutput: mocks.selectOutput,
    aspectRatio: 16 / 9,
  }),
}));

vi.mock('../../src/components/panels/nodes/canvas/NodeGraphNodeCard', () => ({
  NodeGraphNodeCard: memo((props: {
    node: NodeGraphNode;
    onTogglePreview?: (nodeId: string) => void;
    onPreviewOutput?: (nodeId: string, portId: string) => void;
    collapsedGroupId?: string;
    onToggleGroup?: (groupId: string) => void;
  }) => {
    mocks.renders.set(props.node.id, (mocks.renders.get(props.node.id) ?? 0) + 1);
    return <div className="node-workspace-node" data-node-id={props.node.id}>
      {props.collapsedGroupId && <button aria-label={`Expand ${props.node.label} group`} onClick={() => props.onToggleGroup?.(props.collapsedGroupId!)}>Expand</button>}
      <button type="button" aria-label={`toggle ${props.node.id}`} onClick={() => props.onTogglePreview?.(props.node.id)}>toggle</button>
      <button type="button" aria-label={`output ${props.node.id}`} onClick={() => props.onPreviewOutput?.(props.node.id, 'out')}>output</button>
    </div>;
  }),
}));

import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({
    clientX: x, clientY: y, pointerId: 3, pointerType: 'mouse', button: 0,
  }).map(([key, value]) => [key, { value }])));
  fireEvent(target, event);
}

describe('node canvas navigation render boundaries', () => {
  beforeEach(() => {
    mocks.renders.clear(); mocks.toggleNode.mockReset(); mocks.selectOutput.mockReset();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function setup(nodeCount = connectionFixture.nodes.length) {
    const extraNodes = Array.from({ length: Math.max(0, nodeCount - connectionFixture.nodes.length) }, (_, index) => ({
      ...connectionFixture.nodes[0], id: `Extra-${index}`, label: `Extra ${index}`,
      layout: { x: (index % 20) * 340, y: 600 + Math.floor(index / 20) * 240 },
    }));
    const graph = {
      ...connectionFixture,
      nodes: connectionFixture.nodes.map((node, index) => index ? node : ({
        ...node,
        binding: { kind: 'color-node' as const, versionId: 'version-a', nodeId: 'color-source', nodeType: 'input' as const },
      })).concat(extraNodes),
    };
    const view = render(<NodeGraphCanvas graph={graph} selectedNodeId={null} onSelectNode={vi.fn()} />);
    return { ...view, canvas: view.container.querySelector('.node-workspace-canvas')! };
  }

  it('does not reconcile stable node cards while panning or wheel zooming', () => {
    const view = setup(200), initial = new Map(mocks.renders);
    const grid = view.container.querySelector<HTMLElement>('.node-workspace-grid')!;
    const board = view.container.querySelector<HTMLElement>('.node-workspace-board')!;
    const gridBefore = grid.style.transform;
    expect(initial.size).toBe(200);
    pointer(view.canvas, 'pointerdown', 40, 40);
    pointer(view.canvas, 'pointermove', 90, 75);
    pointer(view.canvas, 'pointerup', 90, 75);
    expect(grid.style.transform).not.toBe(gridBefore);
    expect(board.getAttribute('style')).toBeNull();
    fireEvent.wheel(view.canvas, { deltaY: -120, clientX: 60, clientY: 50 });
    expect(mocks.renders).toEqual(initial);
  });

  it('keeps preview callbacks routed through each node preference key', () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'toggle Source' }));
    fireEvent.click(view.getByRole('button', { name: 'output Source' }));
    expect(mocks.toggleNode).toHaveBeenCalledExactlyOnceWith('clip-graph:plug-fixture:color:version-a/color-source', 'Source');
    expect(mocks.selectOutput).toHaveBeenCalledExactlyOnceWith('clip-graph:plug-fixture:color:version-a/color-source', 'out');
  });

  it('keeps zoom and pan when a group opens or closes after a user pan', () => {
    const group = { id: 'effect', label: 'Example', color: '#fff', collapsed: true, proxyId: 'Source', nodeIds: ['Source'] };
    const graph = { ...connectionFixture, groups: [group] };
    const toggle = vi.fn();
    const view = render(<NodeGraphCanvas graph={graph} selectedNodeId={null} onSelectNode={vi.fn()} onToggleGroup={toggle} />);
    const canvas = view.container.querySelector('.node-workspace-canvas')!, inner = view.container.querySelector<HTMLElement>('.node-workspace-canvas-inner')!;
    pointer(canvas, 'pointerdown', 40, 40); pointer(canvas, 'pointermove', 240, 170); pointer(canvas, 'pointerup', 240, 170);
    const transform = inner.style.transform;
    fireEvent.click(view.getByRole('button', { name: 'Expand Source group' }));
    expect(toggle).toHaveBeenCalledWith('effect');
    view.rerender(<NodeGraphCanvas graph={{ ...graph, nodes: graph.nodes.map(node => ({ ...node, layout: { x: node.layout.x + 2000, y: node.layout.y } })),
      groups: [{ ...group, collapsed: false, nodeIds: graph.nodes.map(node => node.id) }] }} selectedNodeId={null} onSelectNode={vi.fn()} onToggleGroup={toggle} />);
    expect(inner.style.transform).toBe(transform);
  });

  it('moves full group backgrounds with the immediate viewport before a worker frame arrives', () => {
    const view = setup();
    const background = view.container.querySelector<HTMLElement>('.node-graph-group-backgrounds')!;
    const inner = view.container.querySelector<HTMLElement>('.node-workspace-canvas-inner')!;
    const initial = background.style.transform;
    pointer(view.canvas, 'pointerdown', 40, 40);
    pointer(view.canvas, 'pointermove', 240, 170);
    expect(background.style.transform).not.toBe(initial);
    expect(background.style.transform).toBe(inner.style.transform);
    pointer(view.canvas, 'pointerup', 240, 170);
    const panned = background.style.transform;
    fireEvent.wheel(view.canvas, { deltaY: 900, clientX: 60, clientY: 50 });
    expect(background.style.transform).not.toBe(panned);
    expect(background.style.transform).toBe(inner.style.transform);
  });

  it('fits the complete fold destination and clears pointer focus while keeping keyboard focus', () => {
    const group = { id: 'effect', label: 'Example', color: '#fff', collapsed: true, proxyId: 'Source', nodeIds: ['Source'] };
    const graph = { ...connectionFixture, groups: [group] }, fold = vi.fn(), select = vi.fn();
    const view = render(<NodeGraphCanvas graph={graph} selectedNodeId={null} onSelectNode={select} onSetAllGroupsCollapsed={fold} />);
    const canvas = view.container.querySelector('.node-workspace-canvas')!, inner = view.container.querySelector<HTMLElement>('.node-workspace-canvas-inner')!;
    pointer(canvas, 'pointerdown', 40, 40); pointer(canvas, 'pointermove', 240, 170); pointer(canvas, 'pointerup', 240, 170);
    const transform = inner.style.transform, button = view.getByRole('button', { name: 'Expand all' });
    button.focus(); fireEvent.click(button, { detail: 1 });
    expect(button).not.toHaveFocus(); expect(fold).toHaveBeenLastCalledWith(false);
    view.rerender(<NodeGraphCanvas graph={{ ...graph, groups: [{ ...group, collapsed: false }] }} selectedNodeId={null} onSelectNode={select} onSetAllGroupsCollapsed={fold} />);
    const collapse = view.getByRole('button', { name: 'Collapse all' });
    collapse.focus(); fireEvent.click(collapse, { detail: 0 });
    expect(collapse).toHaveFocus(); expect(fold).toHaveBeenLastCalledWith(true);
    expect(inner.style.transform).not.toBe(transform);
  });
});
