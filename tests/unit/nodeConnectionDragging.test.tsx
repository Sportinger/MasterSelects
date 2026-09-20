import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { reconnectNodePorts } from '../../src/components/panels/nodes/canvas/reconnectNodePorts';

function pointer(target: Element, type: string, x = 30, y = 30, pointerId = 1, pointerType = 'mouse') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ clientX: x, clientY: y, pointerId, pointerType, button: 0 }).map(([key, value]) => [key, { value }])));
  fireEvent(target, event);
}

const hit = vi.fn();
beforeEach(() => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); hit.mockReset(); });

function setup() {
  const disconnect = vi.fn(), connect = vi.fn(), reconnect = vi.fn(), select = vi.fn();
  const view = render(<NodeGraphCanvas graph={connectionFixture} selectedNodeId={null} onSelectNode={select}
    onConnectPorts={connect} onReconnectPorts={reconnect} onDisconnectEdge={disconnect} />);
  const canvas = view.container.querySelector('.node-workspace-canvas')!;
  const plug = (edge: string, direction = 'input') => view.container.querySelector(`.node-workspace-plug[data-edge-id="${edge}"][data-direction="${direction}"]`)!;
  const port = (node: string, direction = 'input') => view.container.querySelector(`.node-workspace-port[data-node-id="${node}"][data-direction="${direction}"]`)!;
  return { ...view, disconnect, connect, reconnect, select, canvas, plug, port };
}

describe('node cable plugs', () => {
  it.each(['mouse', 'touch', 'pen'])('unplugs only the dragged cable on empty release (%s)', pointerType => {
    const s = setup(); hit.mockReturnValue(s.canvas);
    pointer(s.plug('surface-link'), 'pointerdown', 30, 30, 1, pointerType);
    expect(s.disconnect).not.toHaveBeenCalled();
    pointer(s.canvas, 'pointermove', 100, 100, 1, pointerType);
    expect(s.container.querySelectorAll('.node-workspace-edge-hit')).toHaveLength(1);
    pointer(s.canvas, 'pointerup', 100, 100, 1, pointerType);
    expect(s.disconnect).toHaveBeenCalledExactlyOnceWith('surface-link');
    expect(s.reconnect).not.toHaveBeenCalled();
  });
  it('keeps clicks and tiny pointer movements non-destructive', () => {
    const s = setup(); hit.mockReturnValue(s.canvas);
    pointer(s.plug('surface-link'), 'pointerdown');
    pointer(s.canvas, 'pointermove', 32, 32);
    pointer(s.canvas, 'pointerup', 32, 32);
    expect(s.disconnect).not.toHaveBeenCalled(); expect(s.reconnect).not.toHaveBeenCalled();
  });
  it.each(['input', 'output'])('reconnects from the %s end while keeping the other endpoint fixed', direction => {
    const s = setup(); hit.mockReturnValue(s.port('Depth', direction));
    pointer(s.plug('surface-link', direction), 'pointerdown');
    pointer(s.canvas, 'pointermove', 100, 100);
    pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.reconnect).toHaveBeenCalledExactlyOnceWith('surface-link', direction === 'input'
      ? { fromNodeId: 'Source', fromPortId: 'out', toNodeId: 'Depth', toPortId: 'in' }
      : { fromNodeId: 'Depth', fromPortId: 'out', toNodeId: 'Surface', toPortId: 'in' });
    expect(s.disconnect).not.toHaveBeenCalled();
  });
  it('restores a cable on an incompatible port', () => {
    const s = setup(); hit.mockReturnValue(s.port('Geometry'));
    pointer(s.plug('surface-link'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100); pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.disconnect).not.toHaveBeenCalled(); expect(s.reconnect).not.toHaveBeenCalled();
    expect(s.container.querySelectorAll('.node-workspace-edge-hit')).toHaveLength(2);
  });
  it.each(['Escape', 'pointercancel', 'lostpointercapture'])('cancels without deleting on %s', cancel => {
    const s = setup(); hit.mockReturnValue(s.canvas);
    pointer(s.plug('surface-link'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100);
    if (cancel === 'Escape') fireEvent.keyDown(s.canvas, { key: 'Escape' }); else pointer(s.canvas, cancel, 100, 100);
    pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.disconnect).not.toHaveBeenCalled(); expect(s.reconnect).not.toHaveBeenCalled();
    expect(s.container.querySelector('.node-workspace-edge-draft')).toBeNull();
  });
  it('gives each fan-out cable a separate grip and supports keyboard removal', () => {
    const s = setup();
    const grips = ['surface-link', 'depth-link'].map(id => s.plug(id, 'output').querySelector('.node-workspace-plug-hit')!.getAttribute('x'));
    expect(grips[0]).not.toEqual(grips[1]);
    fireEvent.keyDown(s.plug('depth-link', 'output'), { key: 'Delete' });
    expect(s.disconnect).toHaveBeenCalledExactlyOnceWith('depth-link'); expect(s.select).not.toHaveBeenCalled();
  });
  it('highlights only the cable belonging to the hovered fan-out grip and clears it on leave', () => {
    const s = setup();
    fireEvent.pointerOver(s.plug('depth-link', 'output'));
    const highlighted = s.container.querySelectorAll('.node-workspace-edge.hovered');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].parentElement).toHaveAttribute('data-edge-id', 'depth-link');
    fireEvent.pointerOut(s.plug('depth-link', 'output'), { relatedTarget: s.canvas });
    expect(s.container.querySelector('.node-workspace-edge.hovered')).toBeNull();
  });
  it('still creates connections from an empty socket', () => {
    const s = setup(); hit.mockReturnValue(s.port('Depth'));
    pointer(s.port('Surface', 'output'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100); pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.connect).toHaveBeenCalledExactlyOnceWith({ fromNodeId: 'Surface', fromPortId: 'out', toNodeId: 'Depth', toPortId: 'in' });
    expect(s.disconnect).not.toHaveBeenCalled();
  });
  it('reveals an empty socket plug on hover and keeps it visible when moving onto its grip', () => {
    const s = setup();
    const preview = s.container.querySelector('.node-workspace-plug-preview[data-node-id="Surface"][data-direction="output"]')!;
    fireEvent.pointerOver(s.port('Surface', 'output'));
    expect(preview).toHaveClass('revealed');
    fireEvent.pointerOut(s.port('Surface', 'output'), { relatedTarget: preview });
    fireEvent.pointerOver(preview);
    expect(preview).toHaveClass('revealed');
    pointer(preview, 'pointerdown');
    hit.mockReturnValue(s.port('Depth'));
    pointer(s.canvas, 'pointermove', 100, 100); pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.connect).toHaveBeenCalledExactlyOnceWith({ fromNodeId: 'Surface', fromPortId: 'out', toNodeId: 'Depth', toPortId: 'in' });
  });
  it('also reveals the empty socket plug for keyboard focus', () => {
    const s = setup();
    const preview = s.container.querySelector('.node-workspace-plug-preview[data-node-id="Surface"][data-direction="output"]')!;
    fireEvent.focus(s.port('Surface', 'output')); expect(preview).toHaveClass('revealed');
    fireEvent.blur(s.port('Surface', 'output')); expect(preview).not.toHaveClass('revealed');
  });
  it('previews a docked ghost and snaps the draft only while hovering a compatible socket', () => {
    const s = setup(); hit.mockReturnValue(s.port('Depth'));
    pointer(s.plug('surface-link'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100);
    expect(s.container.querySelector('.node-workspace-plug-ghost')).toHaveAttribute('data-node-id', 'Depth');
    expect(s.container.querySelector('.node-workspace-draft-plug')).toBeNull();
    expect(s.connect).not.toHaveBeenCalled(); expect(s.reconnect).not.toHaveBeenCalled(); expect(s.disconnect).not.toHaveBeenCalled();
    hit.mockReturnValue(s.port('Geometry'));
    pointer(s.canvas, 'pointermove', 110, 110);
    expect(s.container.querySelector('.node-workspace-plug-ghost')).toBeNull();
    expect(s.container.querySelector('.node-workspace-draft-plug')).not.toBeNull();
  });
  it('shows the same docking preview for a new wire before committing on release', () => {
    const s = setup(); hit.mockReturnValue(s.port('Depth'));
    pointer(s.port('Surface', 'output'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100);
    expect(s.container.querySelector('.node-workspace-plug-ghost')).toHaveAttribute('data-node-id', 'Depth');
    expect(s.connect).not.toHaveBeenCalled();
    pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.connect).toHaveBeenCalledExactlyOnceWith({ fromNodeId: 'Surface', fromPortId: 'out', toNodeId: 'Depth', toPortId: 'in' });
    expect(s.container.querySelector('.node-workspace-plug-ghost')).toBeNull();
  });
  it('ignores a second pointer and cancels when the graph changes', () => {
    const s = setup(); hit.mockReturnValue(s.canvas);
    pointer(s.plug('surface-link'), 'pointerdown'); pointer(s.canvas, 'pointermove', 100, 100);
    pointer(s.canvas, 'pointerup', 100, 100, 2);
    expect(s.disconnect).not.toHaveBeenCalled();
    s.rerender(<NodeGraphCanvas graph={{ ...connectionFixture, id: 'different-graph' }} selectedNodeId={null} onSelectNode={s.select} onDisconnectEdge={s.disconnect} />);
    pointer(s.canvas, 'pointerup', 100, 100);
    expect(s.disconnect).not.toHaveBeenCalled();
  });
});

describe('canonical reconnect acceptance', () => {
  const next = { fromNodeId: 'Depth', fromPortId: 'out', toNodeId: 'Surface', toPortId: 'in' };
  it('preserves the original cable when a domain rejects the replacement', () => {
    const disconnect = vi.fn(), connect = vi.fn();
    reconnectNodePorts(connectionFixture, 'surface-link', next, () => 1, connect, disconnect);
    expect(connect).toHaveBeenCalledWith(next); expect(disconnect).not.toHaveBeenCalled();
  });
  it('disconnects only after the replacement was accepted', () => {
    const events: string[] = []; let revision = 1;
    reconnectNodePorts(connectionFixture, 'surface-link', next, () => revision,
      () => { revision++; events.push('connect'); }, id => events.push(id));
    expect(events).toEqual(['connect', 'surface-link']);
  });
  it('treats plugging back into the original socket as a no-op', () => {
    const connect = vi.fn(), disconnect = vi.fn();
    reconnectNodePorts(connectionFixture, 'surface-link', connectionFixture.edges[0], () => 1, connect, disconnect);
    expect(connect).not.toHaveBeenCalled(); expect(disconnect).not.toHaveBeenCalled();
  });
  it('removes only the dragged duplicate when dropped on an already connected destination', () => {
    const connect = vi.fn(), disconnect = vi.fn();
    reconnectNodePorts(connectionFixture, 'surface-link', connectionFixture.edges[1], () => 1, connect, disconnect);
    expect(connect).not.toHaveBeenCalled(); expect(disconnect).toHaveBeenCalledExactlyOnceWith('surface-link');
  });
});
