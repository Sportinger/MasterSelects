import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { pinchViewport } from '../../src/components/panels/nodes/canvas/useNodeTouchPinch';
import { MAX_ZOOM } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

/** Native pointer event (the pinch listens natively, React delegates the rest). */
function pointer(target: Element, type: string, values: { x: number; y: number; pointerId: number; pointerType?: string; button?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const props = { clientX: values.x, clientY: values.y, pointerId: values.pointerId, pointerType: values.pointerType ?? 'touch', button: values.button ?? 0, buttons: 1 };
  Object.defineProperties(event, Object.fromEntries(Object.entries(props).map(([key, value]) => [key, { value }])));
  act(() => { fireEvent(target, event); });
}

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(performance.now()); return 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(extra: Partial<Parameters<typeof NodeGraphCanvas>[0]> = {}) {
  const view = render(<NodeGraphCanvas graph={connectionFixture} selectedNodeId={null} onSelectNode={vi.fn()} {...extra} />);
  const canvas = view.container.querySelector('.node-workspace-canvas')!;
  const zoom = () => Number(view.container.querySelector('.node-workspace-zoom')!.textContent!.replace('%', ''));
  return { ...view, canvas, zoom };
}

describe('pinchViewport', () => {
  it('scales by the finger-distance ratio and keeps the anchor under the midpoint', () => {
    const view = pinchViewport({ x: 100, y: 50 }, 1, 100, 200, { x: 300, y: 200 });
    expect(view.zoom).toBe(2);
    expect(view.panX + 100 * view.zoom).toBe(300);
    expect(view.panY + 50 * view.zoom).toBe(200);
  });

  it('clamps to the zoom limits instead of running away', () => {
    expect(pinchViewport({ x: 0, y: 0 }, 1, 10, 100000, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
});

describe('node canvas touch', () => {
  it('pinches with two touch pointers and the first finger does not pan afterwards', () => {
    const s = setup();
    const before = s.zoom();
    pointer(s.canvas, 'pointerdown', { x: 200, y: 200, pointerId: 1 });
    pointer(s.canvas, 'pointerdown', { x: 300, y: 200, pointerId: 2 });
    pointer(s.canvas, 'pointermove', { x: 150, y: 200, pointerId: 1 });
    pointer(s.canvas, 'pointermove', { x: 350, y: 200, pointerId: 2 });
    pointer(s.canvas, 'pointerup', { x: 350, y: 200, pointerId: 2 });
    const pinched = s.zoom();
    expect(pinched).toBeGreaterThan(before * 1.5);
    // The remaining finger is swallowed until it lifts: no pan jump, the zoom stays.
    pointer(s.canvas, 'pointermove', { x: 400, y: 400, pointerId: 1 });
    pointer(s.canvas, 'pointerup', { x: 400, y: 400, pointerId: 1 });
    expect(s.zoom()).toBe(pinched);
  });

  it('pinches when the first finger landed on a card that has not been dragged yet', () => {
    const s = setup();
    const before = s.zoom();
    const card = s.container.querySelector('.node-workspace-node')!;
    pointer(card, 'pointerdown', { x: 200, y: 200, pointerId: 1 });
    pointer(s.canvas, 'pointerdown', { x: 300, y: 200, pointerId: 2 });
    pointer(s.canvas, 'pointermove', { x: 150, y: 200, pointerId: 1 });
    pointer(s.canvas, 'pointermove', { x: 350, y: 200, pointerId: 2 });
    pointer(s.canvas, 'pointerup', { x: 350, y: 200, pointerId: 2 });
    pointer(s.canvas, 'pointerup', { x: 150, y: 200, pointerId: 1 });
    expect(s.zoom()).toBeGreaterThan(before * 1.5);
  });

  it('ignores mouse pointers for the pinch (the mouse keeps the wheel)', () => {
    const s = setup();
    const before = s.zoom();
    pointer(s.canvas, 'pointerdown', { x: 200, y: 200, pointerId: 1, pointerType: 'mouse' });
    pointer(s.canvas, 'pointerdown', { x: 300, y: 200, pointerId: 2, pointerType: 'mouse' });
    pointer(s.canvas, 'pointermove', { x: 350, y: 200, pointerId: 2, pointerType: 'mouse' });
    pointer(s.canvas, 'pointerup', { x: 350, y: 200, pointerId: 2, pointerType: 'mouse' });
    pointer(s.canvas, 'pointerup', { x: 350, y: 200, pointerId: 1, pointerType: 'mouse' });
    expect(s.zoom()).toBe(before);
  });

  it('touch Add opens the add menu aimed at the selection, touch Delete deletes it', () => {
    const openMenu = vi.fn();
    const deleteNode = vi.fn();
    const s = setup({ selectedNodeId: 'Surface', onOpenAddMenu: openMenu, onDeleteNode: deleteNode });
    fireEvent.click(s.getByTestId('node-touch-add'));
    expect(openMenu).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'Surface', groupId: null }));
    fireEvent.click(s.getByTestId('node-touch-delete'));
    expect(deleteNode).toHaveBeenCalledWith('Surface');
  });

  it('touch Delete is disabled without a selection', () => {
    const s = setup({ onDeleteNode: vi.fn() });
    expect((s.getByTestId('node-touch-delete') as HTMLButtonElement).disabled).toBe(true);
  });
});
