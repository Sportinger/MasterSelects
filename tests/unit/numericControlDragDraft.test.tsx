import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditableDraggableNumber } from '../../src/components/common/EditableDraggableNumber';
import { HandleOnlyRange } from '../../src/components/panels/properties/transformTab/HandleOnlyRange';
import { ResolveInspectorNumberRow } from '../../src/components/panels/properties/resolveInspector/ResolveInspectorNumberRow';

// The numeric controls paint a local draft at input rate while the store commit follows once per frame,
// and hand the display back to the store value (clamped or rejected) right after the release flush.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const nextFrame = () => act(() => vi.advanceTimersToNextFrame());

function mouseMove(clientX: number) {
  const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, buttons: 1 });
  Object.defineProperty(event, 'movementX', { configurable: true, value: 0 });
  fireEvent(window, event);
}

function ClampingNumber({ cap }: { cap: number }) {
  const [value, setValue] = useState(100);
  return <EditableDraggableNumber value={value} onChange={(next) => setValue(Math.min(next, cap))} decimals={2} sensitivity={1} />;
}

describe('EditableDraggableNumber drag draft', () => {
  it('shows each mouse sample before the frame flush and snaps to the unchanged store value on release', () => {
    const onChange = vi.fn();
    const { container } = render(<EditableDraggableNumber value={100} onChange={onChange} decimals={2} sensitivity={1} />);
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
    mouseMove(120);

    expect(onChange).not.toHaveBeenCalled();
    const drafted = Number(valueElement.getAttribute('aria-valuenow'));
    expect(drafted).toBeGreaterThan(100);
    expect(valueElement).toHaveTextContent(drafted.toFixed(2));

    nextFrame();
    expect(onChange).toHaveBeenLastCalledWith(drafted);
    // The parent never applied the sample (a rejected write): the draft still leads during the drag ...
    expect(valueElement).toHaveTextContent(drafted.toFixed(2));

    mouseMove(140);
    const finalDraft = Number(valueElement.getAttribute('aria-valuenow'));
    expect(finalDraft).toBeGreaterThan(drafted);

    fireEvent.mouseUp(window, { button: 0, buttons: 0 });
    // ... and the release flush delivers the final sample, then the store value wins.
    expect(onChange).toHaveBeenLastCalledWith(finalDraft);
    expect(valueElement).toHaveTextContent('100.00');
    expect(valueElement).toHaveAttribute('aria-valuenow', '100');
  });

  it('snaps to the clamped store value after the release flush', () => {
    const { container } = render(<ClampingNumber cap={100.05} />);
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
    mouseMove(140);
    nextFrame();
    expect(Number(valueElement.getAttribute('aria-valuenow'))).toBeGreaterThan(100.05);

    fireEvent.mouseUp(window, { button: 0, buttons: 0 });
    expect(valueElement).toHaveTextContent('100.05');
  });

  it('shows touch samples before the frame flush and snaps to the store value on release', () => {
    const onChange = vi.fn();
    const onDragEnd = vi.fn();
    const { container } = render(
      <EditableDraggableNumber value={100} onChange={onChange} onDragEnd={onDragEnd} decimals={1} sensitivity={1} />,
    );
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.pointerDown(valueElement, { pointerId: 51, pointerType: 'touch', clientX: 100, clientY: 220 });
    fireEvent.pointerMove(valueElement, { pointerId: 51, pointerType: 'touch', clientX: 160, clientY: 222 });

    expect(onChange).not.toHaveBeenCalled();
    const drafted = Number(valueElement.getAttribute('aria-valuenow'));
    expect(drafted).toBeGreaterThan(100);
    expect(valueElement).toHaveTextContent(drafted.toFixed(1));

    fireEvent.pointerUp(valueElement, { pointerId: 51, pointerType: 'touch', clientX: 160, clientY: 222 });
    expect(onChange).toHaveBeenLastCalledWith(drafted);
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(valueElement).toHaveTextContent('100.0');
  });

  it('keeps typed keyboard editing immediate and draft-free', () => {
    const { container } = render(<ClampingNumber cap={1000} />);
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    expect(valueElement.tabIndex).toBe(0);
    valueElement.focus();
    expect(document.activeElement).toBe(valueElement);
    fireEvent.keyDown(valueElement, { key: 'Enter' });
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // No frame advanced: typing commits synchronously, as before.
    expect(container.querySelector('.draggable-number')).toHaveTextContent('42.50');
  });

  it('suppresses pointer focus on mouse drags so no focus ring sticks', () => {
    const { container } = render(<EditableDraggableNumber value={100} onChange={vi.fn()} decimals={2} />);
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    const notPrevented = fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
    mouseMove(130);
    fireEvent.mouseUp(window, { button: 0, buttons: 0 });

    expect(notPrevented).toBe(false);
    expect(document.activeElement).not.toBe(valueElement);
  });
});

function mockSliderRect(slider: HTMLElement) {
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    bottom: 32, height: 12, left: 10, right: 110, top: 20, width: 100, x: 10, y: 20, toJSON: () => ({}),
  });
}

describe('HandleOnlyRange drag draft', () => {
  it('moves the thumb before the frame flush and snaps to the unchanged store value on release', () => {
    const onChange = vi.fn();
    render(<HandleOnlyRange aria-label="Draft slider" max={100} min={0} onChange={onChange} step={1} value={50} />);
    const slider = screen.getByRole('slider', { name: 'Draft slider' });
    mockSliderRect(slider);

    const notPrevented = fireEvent.pointerDown(slider, { button: 0, clientX: 60, isPrimary: true, pointerId: 61, pointerType: 'mouse' });
    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 61, pointerType: 'mouse' });

    expect(notPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuenow', '72');
    expect(slider.style.getPropertyValue('--handle-only-range-position')).toBe('72%');

    nextFrame();
    expect(onChange).toHaveBeenLastCalledWith(72);
    expect(slider).toHaveAttribute('aria-valuenow', '72');

    fireEvent.pointerMove(slider, { clientX: 90, pointerId: 61, pointerType: 'mouse' });
    fireEvent.pointerUp(slider, { clientX: 90, pointerId: 61, pointerType: 'mouse' });
    expect(onChange).toHaveBeenLastCalledWith(82);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider.style.getPropertyValue('--handle-only-range-position')).toBe('50%');
    expect(document.activeElement).not.toBe(slider);
  });

  it('snaps to the clamped store value after the release flush', () => {
    function ClampingRange() {
      const [value, setValue] = useState(50);
      return <HandleOnlyRange aria-label="Clamped slider" max={100} min={0} onChange={(next) => setValue(Math.min(next, 60))} step={1} value={value} />;
    }
    render(<ClampingRange />);
    const slider = screen.getByRole('slider', { name: 'Clamped slider' });
    mockSliderRect(slider);

    fireEvent.pointerDown(slider, { button: 0, clientX: 60, isPrimary: true, pointerId: 62, pointerType: 'touch' });
    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 62, pointerType: 'touch' });
    nextFrame();
    expect(slider).toHaveAttribute('aria-valuenow', '72');

    fireEvent.pointerUp(slider, { clientX: 80, pointerId: 62, pointerType: 'touch' });
    expect(slider).toHaveAttribute('aria-valuenow', '60');
  });

  it('keeps keyboard steps immediate and based on the store value', () => {
    const onChange = vi.fn();
    render(<HandleOnlyRange aria-label="Key slider" max={100} min={0} onChange={onChange} step={1} value={50} />);
    const slider = screen.getByRole('slider', { name: 'Key slider' });

    expect(slider.tabIndex).toBe(0);
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(60);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
  });
});

describe('ResolveInspectorNumberRow paired drag draft', () => {
  // The partner of the dragged control used to follow the store, one frame (or more on a loaded host)
  // behind the dragged control. Both now paint the same sample in the same flush.
  it('moves the number field with the slider sample before the frame flush, then shows the store value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ResolveInspectorNumberRow label="Radius" value={50} defaultValue={0} min={0} max={100} step={1} onChange={onChange} />,
    );
    const slider = screen.getByRole('slider', { name: 'Radius slider' });
    const field = container.querySelector('.draggable-number') as HTMLElement;
    mockSliderRect(slider);

    fireEvent.pointerDown(slider, { button: 0, clientX: 60, isPrimary: true, pointerId: 71, pointerType: 'mouse' });
    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 71, pointerType: 'mouse' });
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuenow', '72');
    expect(field).toHaveAttribute('aria-valuenow', '72');

    fireEvent.pointerUp(slider, { clientX: 80, pointerId: 71, pointerType: 'mouse' });
    expect(onChange).toHaveBeenLastCalledWith(72);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(field).toHaveAttribute('aria-valuenow', '50');
  });

  it('moves the slider with the number field sample before the frame flush', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ResolveInspectorNumberRow label="Amount" value={50} defaultValue={0} min={0} max={100} step={0.1} onChange={onChange} />,
    );
    const slider = screen.getByRole('slider', { name: 'Amount slider' });
    const field = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.mouseDown(field, { button: 0, clientX: 100, buttons: 1 });
    mouseMove(140);
    expect(onChange).not.toHaveBeenCalled();
    const drafted = Number(field.getAttribute('aria-valuenow'));
    expect(drafted).toBeGreaterThan(50);
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(drafted, 6);

    fireEvent.mouseUp(window, { button: 0, buttons: 0 });
    expect(onChange).toHaveBeenLastCalledWith(drafted);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(field).toHaveAttribute('aria-valuenow', '50');
  });
});
