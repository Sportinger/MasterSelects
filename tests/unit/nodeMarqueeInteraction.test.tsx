import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

function pointer(target: Element, type: string, options: { x?: number; y?: number; pointerId?: number; pointerType?: string; button?: number } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const values = {
    clientX: options.x ?? 10,
    clientY: options.y ?? 10,
    pointerId: options.pointerId ?? 7,
    pointerType: options.pointerType ?? 'mouse',
    button: options.button ?? 2,
  };
  Object.defineProperties(event, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])));
  fireEvent(target, event);
}

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const selectNodes = vi.fn();
  const openMenu = vi.fn();
  const view = render(<NodeGraphCanvas graph={connectionFixture} selectedNodeId={null} onSelectNode={vi.fn()}
    onSelectNodes={selectNodes} onOpenAddMenu={openMenu} />);
  return {
    ...view,
    selectNodes,
    openMenu,
    canvas: view.container.querySelector('.node-workspace-canvas')!,
    node: view.container.querySelector('.node-workspace-node') as HTMLElement,
  };
}

describe('node workspace right-drag marquee interaction', () => {
  it('captures a right mouse drag, live-selects nodes, and suppresses its trailing context menu', () => {
    const s = setup();
    pointer(s.canvas, 'pointerdown', { x: -1000, y: -1000 });
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7);
    pointer(s.canvas, 'pointermove', { x: 10000, y: 10000 });
    expect(s.selectNodes).toHaveBeenLastCalledWith(connectionFixture.nodes.map(node => node.id));
    expect(s.container.querySelector('.node-workspace-marquee')).not.toBeNull();
    pointer(s.canvas, 'pointerup', { x: 10000, y: 10000 });
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(7);
    fireEvent.contextMenu(s.canvas, { clientX: 10000, clientY: 10000 });
    expect(s.openMenu).not.toHaveBeenCalled();
  });

  it('keeps a stationary right click on the existing context-menu path', () => {
    const s = setup();
    pointer(s.canvas, 'pointerdown');
    pointer(s.canvas, 'pointerup');
    fireEvent.contextMenu(s.canvas, { clientX: 10, clientY: 10 });
    expect(s.selectNodes).not.toHaveBeenCalled();
    expect(s.openMenu).toHaveBeenCalledOnce();
  });

  it.each(['touch', 'pen'])('does not turn a %s pointer into a right-drag marquee', pointerType => {
    const s = setup();
    pointer(s.canvas, 'pointerdown', { pointerType });
    pointer(s.canvas, 'pointermove', { x: 100, y: 100, pointerType });
    pointer(s.canvas, 'pointerup', { x: 100, y: 100, pointerType });
    expect(s.selectNodes).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
  });

  it('does not clear keyboard focus when right-drag measurement begins on a node', () => {
    const s = setup();
    act(() => s.node.focus());
    expect(document.activeElement).toBe(s.node);
    pointer(s.node, 'pointerdown');
    expect(document.activeElement).toBe(s.node);
  });
});
