import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CURVE_TOUCH_HIT_RADIUS_PX,
  measureCurvePinch,
  pickCurveTouchTarget,
  verticalZoomNotches,
} from '../../src/components/panels/curves/curvesTouchGesture';
import { scaleCurveTimeViewAt } from '../../src/components/panels/curves/curvesPanelTimeView';
import { useCurvesTouchGestures } from '../../src/components/panels/curves/useCurvesTouchGestures';

function pointer(type: string, init: { pointerId: number; pointerType: string; clientX: number; clientY: number }): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: init.clientX, clientY: init.clientY }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: init.pointerId === 1 },
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
  });
  return event;
}

function placeAt(element: Element, x: number, y: number): void {
  element.getBoundingClientRect = () => ({ left: x - 5, top: y - 5, right: x + 5, bottom: y + 5, width: 10, height: 10, x: x - 5, y: y - 5, toJSON: () => ({}) });
}

function Harness({ onMouseDown, scaleTimeAt }: { onMouseDown: (x: number, y: number) => void; scaleTimeAt: (...args: unknown[]) => void }) {
  const gestures = useCurvesTouchGestures({ getTimeView: () => ({ scrollX: 10, zoom: 100 }), scaleTimeAt });
  return (
    <section data-testid="panel" {...gestures}>
      <aside className="timeline-global-curve-sidebar" data-testid="sidebar" />
      <div className="timeline-global-curve-editor-pane" data-testid="pane">
        <svg>
          <circle data-testid="key" data-keyframe-id="k1" onMouseDown={(event) => onMouseDown(event.clientX, event.clientY)} />
        </svg>
      </div>
    </section>
  );
}

afterEach(() => document.body.replaceChildren());

describe('Curves touch gesture math', () => {
  it('picks the nearest keyframe within a finger radius and prefers handles on a near tie', () => {
    const candidates = [
      { item: 'key', x: 100, y: 100, isHandle: false },
      { item: 'handle', x: 112, y: 100, isHandle: true },
    ];
    expect(pickCurveTouchTarget(candidates, { x: 107, y: 100 })?.item).toBe('handle');
    expect(pickCurveTouchTarget(candidates, { x: 98, y: 100 })?.item).toBe('key');
    expect(pickCurveTouchTarget(candidates, { x: 100 + CURVE_TOUCH_HIT_RADIUS_PX + 20, y: 100 })).toBeNull();
  });

  it('splits a pinch into time zoom, height zoom and pan', () => {
    const sideBySide = measureCurvePinch([{ x: 100, y: 50 }, { x: 160, y: 50 }], [{ x: 70, y: 50 }, { x: 190, y: 50 }]);
    expect(sideBySide.factorX).toBeCloseTo(2);
    expect(sideBySide.factorY).toBe(1);
    const stacked = measureCurvePinch([{ x: 100, y: 50 }, { x: 100, y: 110 }], [{ x: 120, y: 20 }, { x: 120, y: 140 }]);
    expect(stacked.factorX).toBe(1);
    expect(stacked.factorY).toBeCloseTo(2);
    expect(stacked.panX).toBe(20);
    expect(verticalZoomNotches(2)).toBe(5);
    expect(verticalZoomNotches(1)).toBe(0);
    expect(verticalZoomNotches(0.5)).toBe(-5);
  });

  it('zooms time around the anchor and clamps the scroll', () => {
    const view = scaleCurveTimeViewAt({ compositionDuration: 10, factor: 2, anchorX: 100, view: { scrollX: 0, zoom: 100 }, viewportWidth: 400 });
    expect(view.zoom).toBe(200);
    expect(view.scrollX).toBe(100); // time 1 s stays under x = 100
    expect(scaleCurveTimeViewAt({ compositionDuration: 10, factor: 1, anchorX: 0, panX: 500, view: { scrollX: 100, zoom: 100 }, viewportWidth: 400 }).scrollX).toBe(0);
  });
});

describe('Curves panel touch input', () => {
  it('drives the graph mouse drag from a finger near a keyframe', () => {
    const onMouseDown = vi.fn();
    const onMove = vi.fn();
    const onUp = vi.fn();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    render(<Harness onMouseDown={onMouseDown} scaleTimeAt={vi.fn()} />);
    placeAt(screen.getByTestId('key'), 100, 100);
    const pane = screen.getByTestId('pane');
    fireEvent(pane, pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 112, clientY: 104 }));
    fireEvent(pane, pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 112, clientY: 80 }));
    fireEvent(pane, pointer('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 112, clientY: 80 }));
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    // The drag starts on the keyframe's centre and keeps the finger's offset.
    expect(onMouseDown).toHaveBeenCalledWith(100, 100);
    expect(onMove).toHaveBeenCalledOnce();
    expect((onMove.mock.calls[0][0] as MouseEvent).clientY).toBe(76);
    expect(onUp).toHaveBeenCalledOnce();
  });

  it('pans time from empty graph and leaves mouse input alone', () => {
    const onMouseDown = vi.fn();
    const scaleTimeAt = vi.fn();
    render(<Harness onMouseDown={onMouseDown} scaleTimeAt={scaleTimeAt} />);
    placeAt(screen.getByTestId('key'), 100, 100);
    const pane = screen.getByTestId('pane');
    fireEvent(pane, pointer('pointerdown', { pointerId: 2, pointerType: 'mouse', clientX: 300, clientY: 100 }));
    fireEvent(pane, pointer('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: 260, clientY: 100 }));
    expect(scaleTimeAt).not.toHaveBeenCalled();

    fireEvent(pane, pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 }));
    fireEvent(pane, pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 260, clientY: 100 }));
    expect(onMouseDown).not.toHaveBeenCalled();
    expect(scaleTimeAt).toHaveBeenLastCalledWith({ scrollX: 10, zoom: 100 }, 1, 0, -40);
  });

  it('turns a stacked two-finger spread into Shift+wheel height notches', () => {
    const onWheel = vi.fn();
    render(<Harness onMouseDown={vi.fn()} scaleTimeAt={vi.fn()} />);
    screen.getByTestId('sidebar').addEventListener('wheel', (event) => onWheel(event.shiftKey, event.deltaY));
    const pane = screen.getByTestId('pane');
    fireEvent(pane, pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 }));
    fireEvent(pane, pointer('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 160 }));
    fireEvent(pane, pointer('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 220 }));
    expect(onWheel).toHaveBeenCalledTimes(5);
    expect(onWheel).toHaveBeenCalledWith(true, -100);
  });
});
