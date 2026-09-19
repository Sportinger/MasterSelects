import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSceneGizmoTouchDragTarget } from '../../src/components/preview/sceneOverlay/sceneGizmoTouch';
import { useTouchMouseBridge } from '../../src/components/preview/useTouchMouseBridge';

function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId: number; pointerType: string },
): PointerEvent {
  const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
  });
  return event;
}

interface TouchHarnessProps {
  className: string;
  onMouseDown?: () => void;
  onPointerDown?: () => void;
  stopPointerPropagation?: boolean;
}

function TouchHarness({
  className,
  onMouseDown,
  onPointerDown,
  stopPointerPropagation = false,
}: TouchHarnessProps) {
  const bridge = useTouchMouseBridge<HTMLDivElement>({
    emitClick: false,
    shouldStart: event => isSceneGizmoTouchDragTarget(event.target),
  });

  return (
    <div
      data-testid="preview"
      onClickCapture={bridge.onClickCapture}
      onPointerCancelCapture={bridge.onPointerCancel}
      onPointerDownCapture={bridge.onPointerDown}
      onPointerMoveCapture={bridge.onPointerMove}
      onPointerUpCapture={bridge.onPointerUp}
    >
      <button
        className={className}
        data-testid="target"
        onMouseDown={onMouseDown}
        onPointerDown={(event) => {
          onPointerDown?.();
          if (stopPointerPropagation) event.stopPropagation();
        }}
        type="button"
      />
    </div>
  );
}

function WindowMouseStream({ onMove, onUp }: { onMove: () => void; onUp: () => void }) {
  useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onMove, onUp]);
  return null;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Preview scene gizmo touch bridge', () => {
  it('feeds an axis touch through the existing mouse drag stream', () => {
    const onMouseDown = vi.fn();
    const onMove = vi.fn();
    const onUp = vi.fn();
    render(
      <>
        <WindowMouseStream onMove={onMove} onUp={onUp} />
        <TouchHarness className="preview-scene-gizmo-axis" onMouseDown={onMouseDown} />
      </>,
    );
    const preview = screen.getByTestId('preview');
    const target = screen.getByTestId('target');

    fireEvent(target, pointerEvent('pointerdown', {
      button: 0, buttons: 1, clientX: 100, clientY: 80, pointerId: 7, pointerType: 'touch',
    }));
    fireEvent(preview, pointerEvent('pointermove', {
      button: 0, buttons: 1, clientX: 135, clientY: 90, pointerId: 7, pointerType: 'touch',
    }));
    fireEvent(preview, pointerEvent('pointerup', {
      button: 0, buttons: 0, clientX: 135, clientY: 90, pointerId: 7, pointerType: 'touch',
    }));

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onUp).toHaveBeenCalledOnce();
  });

  it('captures a center grip before its own pointer handler stops bubbling', () => {
    const onPointerDown = vi.fn();
    const onMove = vi.fn();
    const onUp = vi.fn();
    render(
      <>
        <WindowMouseStream onMove={onMove} onUp={onUp} />
        <TouchHarness
          className="preview-scene-object-handle"
          onPointerDown={onPointerDown}
          stopPointerPropagation
        />
      </>,
    );
    const preview = screen.getByTestId('preview');
    const target = screen.getByTestId('target');

    fireEvent(target, pointerEvent('pointerdown', {
      button: 0, buttons: 1, clientX: 60, clientY: 50, pointerId: 8, pointerType: 'touch',
    }));
    fireEvent(preview, pointerEvent('pointermove', {
      button: 0, buttons: 1, clientX: 85, clientY: 70, pointerId: 8, pointerType: 'touch',
    }));
    fireEvent(preview, pointerEvent('pointerup', {
      button: 0, buttons: 0, clientX: 85, clientY: 70, pointerId: 8, pointerType: 'touch',
    }));

    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onUp).toHaveBeenCalledOnce();
  });

  it('does not take over touches outside a scene gizmo', () => {
    const onMouseDown = vi.fn();
    render(<TouchHarness className="ordinary-preview-control" onMouseDown={onMouseDown} />);

    fireEvent(screen.getByTestId('target'), pointerEvent('pointerdown', {
      button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 9, pointerType: 'touch',
    }));

    expect(onMouseDown).not.toHaveBeenCalled();
  });
});
