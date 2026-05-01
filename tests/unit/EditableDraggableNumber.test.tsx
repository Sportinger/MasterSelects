import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableDraggableNumber } from '../../src/components/common/EditableDraggableNumber';

function dispatchMouseMove(target: EventTarget, init: MouseEventInit) {
  const event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
}

function lastChangedValue(onChange: ReturnType<typeof vi.fn>): number {
  const lastCall = onChange.mock.calls.at(-1);
  if (!lastCall) throw new Error('Expected onChange to be called');
  return lastCall[0] as number;
}

describe('EditableDraggableNumber drag behavior', () => {
  afterEach(() => {
    cleanup();
  });

  it('drags from the current value without requesting pointer lock', () => {
    const onChange = vi.fn();
    const requestPointerLock = vi.fn();
    const originalRequestPointerLockDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestPointerLock');
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestPointerLock,
    });

    const { container } = render(
      <EditableDraggableNumber
        value={100}
        onChange={onChange}
        decimals={2}
        sensitivity={1}
        min={-10000}
        max={10000}
      />,
    );
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
    dispatchMouseMove(window, { clientX: 103, buttons: 1 });

    expect(lastChangedValue(onChange)).toBeGreaterThan(102);
    expect(lastChangedValue(onChange)).toBeLessThan(103);

    dispatchMouseMove(window, { clientX: 104, buttons: 1 });

    expect(lastChangedValue(onChange)).toBeGreaterThan(103);
    expect(lastChangedValue(onChange)).toBeLessThan(104);
    expect(requestPointerLock).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { button: 0, buttons: 0 });

    if (originalRequestPointerLockDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', originalRequestPointerLockDescriptor);
    } else {
      delete (HTMLElement.prototype as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock;
    }
  });

  it('still resets to default on a right-click without drag movement', () => {
    const onChange = vi.fn();
    const { container } = render(
      <EditableDraggableNumber
        value={100}
        onChange={onChange}
        defaultValue={0}
        decimals={1}
      />,
    );
    const valueElement = container.querySelector('.draggable-number') as HTMLElement;

    fireEvent.mouseDown(valueElement, { button: 2, clientX: 100, buttons: 2 });
    fireEvent.mouseUp(window, { button: 2, buttons: 0 });
    fireEvent.contextMenu(valueElement);

    expect(onChange).toHaveBeenCalledWith(0);
  });
});
