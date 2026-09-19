import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useTouchMouseBridge,
  type TouchMouseBridgeOptions,
} from '../../src/components/preview/useTouchMouseBridge';

function pointerEvent(
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number; pointerType?: string },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? 'touch' },
  });
  return event;
}

function Harness({
  bridgeOptions,
  onClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  bridgeOptions?: TouchMouseBridgeOptions<HTMLDivElement>;
  onClick: () => void;
  onMouseDown: () => void;
  onMouseMove: () => void;
  onMouseUp: () => void;
}) {
  const bridge = useTouchMouseBridge<HTMLDivElement>(bridgeOptions);
  return (
    <div
      data-testid="surface"
      {...bridge}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <span data-testid="handle">Handle</span>
    </div>
  );
}

afterEach(cleanup);

describe('useTouchMouseBridge', () => {
  it('turns a touch drag into a complete mouse drag without clicking', () => {
    const onClick = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseMove = vi.fn();
    const onMouseUp = vi.fn();
    const view = render(
      <Harness
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />,
    );
    const handle = view.getByTestId('handle');
    const surface = view.getByTestId('surface');

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
      surface.dispatchEvent(pointerEvent('pointermove', { clientX: 80, clientY: 55 }));
      surface.dispatchEvent(pointerEvent('pointerup', { clientX: 80, clientY: 55 }));
    });

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onMouseMove).toHaveBeenCalledOnce();
    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps a stationary touch as one click and suppresses its compatibility click', () => {
    const onClick = vi.fn();
    const view = render(
      <Harness
        onClick={onClick}
        onMouseDown={vi.fn()}
        onMouseMove={vi.fn()}
        onMouseUp={vi.fn()}
      />,
    );
    const handle = view.getByTestId('handle');

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
      handle.dispatchEvent(pointerEvent('pointerup', { clientX: 20, clientY: 20 }));
    });
    expect(onClick).toHaveBeenCalledOnce();

    act(() => {
      handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not translate mouse pointer events', () => {
    const onMouseDown = vi.fn();
    const view = render(
      <Harness
        onClick={vi.fn()}
        onMouseDown={onMouseDown}
        onMouseMove={vi.fn()}
        onMouseUp={vi.fn()}
      />,
    );

    act(() => {
      view.getByTestId('surface').dispatchEvent(pointerEvent('pointerdown', {
        clientX: 20,
        clientY: 20,
        pointerType: 'mouse',
      }));
    });
    expect(onMouseDown).not.toHaveBeenCalled();
  });

  it('can limit a one-finger bridge to the 3D orbit surface', () => {
    const onMouseDown = vi.fn();
    const view = render(
      <Harness
        bridgeOptions={{
          shouldStart: event => event.target === event.currentTarget,
        }}
        onClick={vi.fn()}
        onMouseDown={onMouseDown}
        onMouseMove={vi.fn()}
        onMouseUp={vi.fn()}
      />,
    );

    act(() => {
      view.getByTestId('handle').dispatchEvent(pointerEvent('pointerdown', {
        clientX: 20,
        clientY: 20,
      }));
      view.getByTestId('surface').dispatchEvent(pointerEvent('pointerdown', {
        clientX: 40,
        clientY: 40,
        pointerId: 2,
      }));
    });

    expect(onMouseDown).toHaveBeenCalledOnce();
  });

  it('can orbit without turning a stationary touch into a click', () => {
    const onClick = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const view = render(
      <Harness
        bridgeOptions={{ emitClick: false }}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseMove={vi.fn()}
        onMouseUp={onMouseUp}
      />,
    );
    const surface = view.getByTestId('surface');

    act(() => {
      surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
      surface.dispatchEvent(pointerEvent('pointerup', { clientX: 20, clientY: 20 }));
    });

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
