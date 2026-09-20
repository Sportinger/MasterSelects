import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { NodeGraphNodeCard } from '../../src/components/panels/nodes/canvas/NodeGraphNodeCard';

const graph = { ...connectionFixture, groups: [{ id: 'flock', label: 'Flock', color: '#7ea65b', collapsed: false,
  proxyId: 'proxy', nodeIds: connectionFixture.nodes.slice(0, 2).map(node => node.id) }] };
function pointer(target: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ clientX: x, clientY: y, pointerId: 1, pointerType, button: 0 }).map(([key, value]) => [key, { value }])));
  fireEvent(target, event);
}
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const toggle = vi.fn(), move = vi.fn();
  const view = render(<NodeGraphCanvas graph={graph} selectedNodeId={null} onSelectNode={vi.fn()} onToggleGroup={toggle} onMoveNode={move} />);
  fireEvent.click(view.getByText('Reset'));
  const header = view.container.querySelector('.node-workspace-group-header')!;
  const position = (id: string) => {
    const node = view.container.querySelector<HTMLElement>(`.node-workspace-node[data-node-id="${id}"]`)!;
    return { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
  };
  return { ...view, header, position, toggle, move };
}

describe('group header dragging', () => {
  it('draws keyboard focus separately from node paint and clears it on pointer activation', () => {
    const view = render(<NodeGraphNodeCard node={graph.nodes[0]} canvasRendered selectedNodeId={null} connectionDraft={null}
      onSelectNode={vi.fn()} onStartNodeDrag={vi.fn()} onNodePointerMove={vi.fn()} onFinishNodeDrag={vi.fn()}
      onStartConnectionDrag={vi.fn()} onDisconnectPortEdges={vi.fn()} />);
    const card = view.container.querySelector<HTMLElement>('.node-workspace-node')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 184, bottom: 300, width: 184, height: 300, toJSON: () => ({}) });
    act(() => card.focus());
    expect(view.container.querySelector('.node-workspace-keyboard-focus')).not.toBeNull();
    pointer(card, 'pointerdown', 100, 100);
    expect(view.container.querySelector('.node-workspace-keyboard-focus')).toBeNull();
    expect(card).not.toHaveFocus();
  });
  it.each(['mouse', 'touch', 'pen'])('moves the whole group without panning or collapsing (%s)', pointerType => {
    const view = setup(), before = graph.nodes.map(node => view.position(node.id));
    const canvas = view.container.querySelector<HTMLElement>('.node-workspace-canvas-inner')!;
    const transform = canvas.style.transform;
    const zoom = Number(transform.match(/scale\(([^)]+)\)/)![1]);
    pointer(view.header, 'pointerdown', 100, 100, pointerType);
    pointer(view.header, 'pointermove', 180, 140, pointerType);
    pointer(view.header, 'pointerup', 180, 140, pointerType);
    graph.nodes.forEach((node, index) => expect(view.position(node.id)).toEqual(index < 2
      ? { x: Math.round(before[index].x + 80 / zoom), y: Math.round(before[index].y + 40 / zoom) } : before[index]));
    expect(canvas.style.transform).toBe(transform);
    expect(view.toggle).not.toHaveBeenCalled();
    expect(view.move).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture'])('discards a cancelled group drag (%s)', ending => {
    const view = setup(), before = view.position(graph.nodes[0].id);
    pointer(view.header, 'pointerdown', 100, 100); pointer(view.header, 'pointermove', 170, 140);
    pointer(view.header, ending, 170, 140);
    expect(view.position(graph.nodes[0].id)).toEqual(before);
  });

  it('keeps arrow and Focus actions separate from dragging and clears pointer focus', () => {
    const view = setup(), before = view.position(graph.nodes[0].id);
    const button = view.getByRole('button', { name: 'Collapse Flock group' });
    button.focus(); pointer(button, 'pointerdown', 100, 100); fireEvent.click(button, { detail: 1 });
    expect(view.toggle).toHaveBeenCalledExactlyOnceWith('flock');
    expect(button).not.toHaveFocus();
    const focus = view.getByRole('button', { name: 'Focus Flock group' });
    focus.focus(); fireEvent.click(focus, { detail: 0 });
    expect(focus).toHaveFocus();
    expect(view.position(graph.nodes[0].id)).toEqual(before);
  });

  it('freezes an unlocked source frame while a member is dragged out', () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Unlock Flock group' }), { detail: 1 });
    expect(view.getByRole('button', { name: 'Lock Flock group' })).toHaveAttribute('aria-pressed', 'false');
    const frame = view.container.querySelector<HTMLElement>('.node-workspace-group')!;
    const geometry = frame.style.cssText;
    const card = view.container.querySelector<HTMLElement>(`.node-workspace-node[data-node-id="${graph.nodes[0].id}"]`)!;
    const before = view.position(graph.nodes[0].id);
    pointer(card, 'pointerdown', 100, 100); pointer(card, 'pointermove', -900, -800);
    expect(view.position(graph.nodes[0].id)).not.toEqual(before);
    expect(frame.style.cssText).toBe(geometry);
    pointer(card, 'pointercancel', -900, -800);
    expect(view.position(graph.nodes[0].id)).toEqual(before);
  });

  it('persists and restores the unlocked state for a real clip owner', () => {
    const clip = createMockClip({ id: graph.owner.id });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Unlock Flock group' }));
    expect(useTimelineStore.getState().clips[0].nodeGraph?.canvasPlacements?.[graph.id].groups.flock.locked).toBe(false);
    expect(view.getByRole('button', { name: 'Lock Flock group' })).toHaveAttribute('aria-pressed', 'false');
    view.unmount();
    const restored = setup();
    expect(restored.getByRole('button', { name: 'Lock Flock group' })).toHaveAttribute('aria-pressed', 'false');
    useTimelineStore.setState({ clips: [] });
  });
});
