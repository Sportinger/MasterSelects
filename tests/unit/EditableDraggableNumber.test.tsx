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
          min={1}
        />,
      );
      const valueElement = container.querySelector('.draggable-number') as HTMLElement;
      pointerLockTarget = valueElement;

      fireEvent.mouseDown(valueElement, { button: 0, clientX: 100, buttons: 1 });
      expect(requestPointerLock).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      dispatchMouseMove(window, { clientX: 103, movementX: 3, buttons: 1 });

      expect(requestPointerLock).toHaveBeenCalledTimes(1);
      expect(lastChangedValue(onChange)).toBeGreaterThan(100.1);
      expect(lastChangedValue(onChange)).toBeLessThan(100.2);

      const valueBeforeHandoffSpike = lastChangedValue(onChange);
      const callCountBeforeHandoffSpike = onChange.mock.calls.length;
      dispatchMouseMove(window, { clientX: 103, movementX: -900, buttons: 1 });

      expect(onChange).toHaveBeenCalledTimes(callCountBeforeHandoffSpike);
      expect(lastChangedValue(onChange)).toBe(valueBeforeHandoffSpike);

      dispatchMouseMove(window, { clientX: 0, movementX: 1, buttons: 1 });

      expect(lastChangedValue(onChange)).toBeGreaterThan(100.2);
      expect(lastChangedValue(onChange)).toBeLessThan(100.3);

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

  it('does not jump when Chromium warps clientX before pointer lock becomes active', () => {
    const onChange = vi.fn();
    const requestPointerLock = vi.fn(() => new Promise<void>(() => undefined));
    const originalRequestPointerLockDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestPointerLock');
    const originalPointerLockElementDescriptor = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestPointerLock,
    });
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => null,
    });

    try {
      const { container } = render(
        <EditableDraggableNumber
          value={100}
          onChange={onChange}
          decimals={2}
          sensitivity={1}
          min={1}
        />,
      );
      const valueElement = container.querySelector('.draggable-number') as HTMLElement;

      fireEvent.mouseDown(valueElement, { button: 0, clientX: 900, buttons: 1 });
      dispatchMouseMove(window, { clientX: 903, movementX: 3, buttons: 1 });

      expect(requestPointerLock).toHaveBeenCalledTimes(1);
      const valueBeforeWarp = lastChangedValue(onChange);
      const callCountBeforeWarp = onChange.mock.calls.length;

      dispatchMouseMove(window, { clientX: 0, movementX: 0, buttons: 1 });

      expect(onChange).toHaveBeenCalledTimes(callCountBeforeWarp);
      expect(lastChangedValue(onChange)).toBe(valueBeforeWarp);

      fireEvent.mouseUp(window, { button: 0, buttons: 0 });
    } finally {
      if (originalRequestPointerLockDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', originalRequestPointerLockDescriptor);
      } else {
        delete (HTMLElement.prototype as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock;
      }
      if (originalPointerLockElementDescriptor) {
        Object.defineProperty(document, 'pointerLockElement', originalPointerLockElementDescriptor);
      } else {
        delete (document as Document & { pointerLockElement?: Element | null }).pointerLockElement;
      }
    }
  });

  it('does not apply a matching movementX spike while pointer lock is pending', () => {
    const onChange = vi.fn();
    const requestPointerLock = vi.fn(() => new Promise<void>(() => undefined));
    const originalRequestPointerLockDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestPointerLock');
    const originalPointerLockElementDescriptor = Object.getOwnPropertyDescriptor(document, 'pointerLockElement');
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestPointerLock,
    });
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => null,
    });

    try {
      const { container } = render(
        <EditableDraggableNumber
          value={100.489}
          onChange={onChange}
          decimals={1}
          sensitivity={1}
        />,
      );
      const valueElement = container.querySelector('.draggable-number') as HTMLElement;

      fireEvent.mouseDown(valueElement, { button: 0, clientX: 900, buttons: 1 });
      dispatchMouseMove(window, { clientX: 903, movementX: 3, buttons: 1 });

      expect(requestPointerLock).toHaveBeenCalledTimes(1);
      const valueBeforeHandoffWarp = lastChangedValue(onChange);
      const callCountBeforeHandoffWarp = onChange.mock.calls.length;

      dispatchMouseMove(window, { clientX: 0, movementX: -903, buttons: 1 });

      expect(onChange).toHaveBeenCalledTimes(callCountBeforeHandoffWarp);
      expect(lastChangedValue(onChange)).toBe(valueBeforeHandoffWarp);
      expect(lastChangedValue(onChange)).toBeGreaterThan(100);

      fireEvent.mouseUp(window, { button: 0, buttons: 0 });
    } finally {
      if (originalRequestPointerLockDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', originalRequestPointerLockDescriptor);
      } else {
        delete (HTMLElement.prototype as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock;
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

  it('opens direct typing on the second click before pointer lock starts', () => {
    const onChange = vi.fn();
    const requestPointerLock = vi.fn();
    const originalRequestPointerLockDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestPointerLock');
    Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestPointerLock,
    });

    try {
      const { container } = render(
        <EditableDraggableNumber
          value={12.3}
          onChange={onChange}
          decimals={1}
        />,
      );
      const valueElement = container.querySelector('.draggable-number') as HTMLElement;

      fireEvent.mouseDown(valueElement, { button: 0, detail: 2, clientX: 100, buttons: 1 });

      const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe('12.3');
      expect(requestPointerLock).not.toHaveBeenCalled();
    } finally {
      if (originalRequestPointerLockDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', originalRequestPointerLockDescriptor);
      } else {
        delete (HTMLElement.prototype as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock;
      }
    }
  });
});
