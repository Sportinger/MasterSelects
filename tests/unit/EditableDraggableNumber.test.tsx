import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableDraggableNumber } from '../../src/components/common/EditableDraggableNumber';

function dispatchMouseMove(target: EventTarget, init: MouseEventInit & { movementX?: number }) {
  const { movementX, ...mouseInit } = init;
  const event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    ...mouseInit,
  });
  if (movementX !== undefined) {
    Object.defineProperty(event, 'movementX', {
      configurable: true,
      value: movementX,
    });
  }
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

  it('drags from the current value with pointer lock and no initial jump', () => {
    const onChange = vi.fn();
    const requestPointerLock = vi.fn();
    const exitPointerLock = vi.fn();
    let lockedElement: Element | null = null;
    let pointerLockTarget: Element | null = null;
    const originalRequestPointerLockDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestPointerLock');
    const originalExitPointerLockDescriptor = Object.getOwnPropertyDescriptor(document, 'exitPointerLock');
    const originalPointerLockElementDescriptor = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: () => {
        requestPointerLock();
        lockedElement = pointerLockTarget;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'exitPointerLock', {
      configurable: true,
      value: () => {
        exitPointerLock();
        lockedElement = null;
        document.dispatchEvent(new Event('pointerlockchange'));
      },
    });
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => lockedElement,
    });

    try {
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
      pointerLockTarget = valueElement;

      fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
      expect(requestPointerLock).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();

      dispatchMouseMove(window, { clientX: 0, movementX: 3, buttons: 1 });

      expect(lastChangedValue(onChange)).toBeGreaterThan(102);
      expect(lastChangedValue(onChange)).toBeLessThan(103);

      dispatchMouseMove(window, { clientX: 0, movementX: 1, buttons: 1 });

      expect(lastChangedValue(onChange)).toBeGreaterThan(103);
      expect(lastChangedValue(onChange)).toBeLessThan(104);

      fireEvent.mouseUp(window, { button: 0, buttons: 0 });
      expect(exitPointerLock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalRequestPointerLockDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', originalRequestPointerLockDescriptor);
      } else {
        delete (HTMLElement.prototype as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock;
      }
      if (originalExitPointerLockDescriptor) {
        Object.defineProperty(document, 'exitPointerLock', originalExitPointerLockDescriptor);
      } else {
        delete (document as Document & { exitPointerLock?: () => void }).exitPointerLock;
      }
      if (originalPointerLockElementDescriptor) {
        Object.defineProperty(document, 'pointerLockElement', originalPointerLockElementDescriptor);
      } else {
        delete (document as Document & { pointerLockElement?: Element | null }).pointerLockElement;
      }
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
