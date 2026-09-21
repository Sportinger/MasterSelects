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
  }) => {
    mocks.renders.set(props.node.id, (mocks.renders.get(props.node.id) ?? 0) + 1);
    return <div className="node-workspace-node" data-node-id={props.node.id}>
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
    expect(initial.size).toBe(200);
    pointer(view.canvas, 'pointerdown', 40, 40);
    pointer(view.canvas, 'pointermove', 90, 75);
    pointer(view.canvas, 'pointerup', 90, 75);
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
});
