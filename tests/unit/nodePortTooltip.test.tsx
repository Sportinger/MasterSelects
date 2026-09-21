import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NodeGraphPortView } from '../../src/components/panels/nodes/canvas/NodeGraphPortView';
import { projectOperatorPort } from '../../src/services/nodeGraph/effectGraphProjection';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { NodeGraphNode } from '../../src/types/nodeGraph';
import { placePortTooltip } from '../../src/components/panels/nodes/canvas/portTooltipPlacement';

afterEach(cleanup);
const port = projectOperatorPort(getEffectOperator('geometry.merge-surface')!.inputs[1], 'input');
const node: NodeGraphNode = { id: 'stitch', label: 'Stitch Surfaces', kind: 'effect', runtime: 'builtin', inputs: [port], outputs: [], layout: { x: 0, y: 0 } };
const setup = (canvasRendered = false) => {
  const drag = vi.fn(), disconnect = vi.fn(), parentKey = vi.fn();
  render(<div onKeyDown={parentKey}><NodeGraphPortView canvasRendered={canvasRendered} node={node} port={port} connectionDraft={null} onStartConnectionDrag={drag} onDisconnectPortEdges={disconnect} /></div>);
  return { anchor: screen.getByRole('button', { name: 'Input Background: Geometry' }), drag, disconnect, parentKey };
};
describe.each([false, true])('node port information, canvas=%s', canvasRendered => {
  it('keeps details clear of the owning node and inside the viewport at either screen edge', () => {
    for (const left of [8, 400, 780]) {
      const card = { left, right: left + 184, top: 420, bottom: 550 };
      const anchor = { ...card, top: 520, bottom: 534 };
      const position = placePortTooltip(anchor, card, 240, 80, { width: 980, height: 600 }, 'input');
      expect(position.left).toBeGreaterThanOrEqual(8);
      expect(position.left + 240).toBeLessThanOrEqual(972);
      expect(position.top + 80).toBeLessThanOrEqual(592);
      expect(position.left + 240 <= card.left || position.left >= card.right).toBe(true);
    }
  });
  it('exposes format details on keyboard focus and dismisses with Escape without affecting the node', () => {
    const { anchor, parentKey } = setup(canvasRendered);
    fireEvent.focus(anchor);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reconstructed depth mesh');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Optional');
    fireEvent.keyDown(anchor, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull(); expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(anchor, { key: 'Enter' });
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.blur(anchor); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('keeps hover details separate from dragging and never disconnects from the socket context menu', () => {
    const { anchor, drag, disconnect } = setup(canvasRendered);
    fireEvent.pointerEnter(anchor);
    expect(screen.getByRole('tooltip')).toHaveTextContent('In · Geometry');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Spatial geometry');
    fireEvent.pointerDown(anchor);
    expect(drag).toHaveBeenCalledWith(expect.anything(), node, port);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.contextMenu(anchor);
    expect(disconnect).not.toHaveBeenCalled();
  });
  it('opens on a touch tap even when the canvas captures pointerup, but not after a drag', () => {
    const { anchor } = setup(canvasRendered);
    const pointer = (target: Element | Window, type: string, x: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 3 }, clientX: { value: x }, clientY: { value: 10 } });
      fireEvent(target, event);
    };
    pointer(anchor, 'pointerdown', 10); pointer(window, 'pointerup', 10);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reconstructed depth mesh');
    pointer(anchor, 'pointerdown', 10); pointer(window, 'pointerup', 50);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
