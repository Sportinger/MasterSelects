import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

// Pressing a node card used to blur to the page: Delete then reached the timeline and removed
// the clip that was still selected there, instead of the node.
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('node card focus', () => {
  it('keeps the keyboard focus in the node canvas, so Delete removes the node', () => {
    const node = connectionFixture.nodes[0];
    const deleteNode = vi.fn();
    const view = render(<NodeGraphCanvas graph={connectionFixture} selectedNodeId={node.id} onSelectNode={vi.fn()} onDeleteNode={deleteNode} />);
    const canvas = view.container.querySelector('.node-workspace-canvas') as HTMLElement;
    const card = view.container.querySelector(`.node-workspace-node[data-node-id="${node.id}"]`) as HTMLElement;
    fireEvent.pointerDown(card, { button: 0, pointerType: 'mouse', pointerId: 3 });
    expect(document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(deleteNode).toHaveBeenCalledWith(node.id);
  });
});
