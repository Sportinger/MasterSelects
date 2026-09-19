import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTouchContextMenu } from '../../src/hooks/useTouchContextMenu';

function Harness({
  onContextMenu,
  targetClassName,
}: {
  onContextMenu: (event: React.MouseEvent) => void;
  targetClassName?: string;
}) {
  useTouchContextMenu();
  return <div className={targetClassName} data-testid="target" onContextMenu={onContextMenu}>Touch target</div>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useTouchContextMenu', () => {
  it('dispatches the existing context-menu path after a stationary touch hold', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);

    fireEvent.pointerDown(getByTestId('target'), {
      button: 0,
      clientX: 40,
      clientY: 60,
      pointerId: 3,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].clientX).toBe(40);
    expect(onContextMenu.mock.calls[0][0].clientY).toBe(60);
  });

  it('cancels long-press when the finger turns into a drag', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');

    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 4,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(target, {
      clientX: 40,
      clientY: 20,
      pointerId: 4,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('cancels long-press when a second touch begins', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');

    fireEvent.pointerDown(target, { button: 0, pointerId: 5, pointerType: 'touch' });
    fireEvent.pointerDown(target, { button: 0, pointerId: 6, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('does not fire while a dock resize owns the touch', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');

    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 8,
      pointerType: 'touch',
    });
    document.documentElement.setAttribute('data-dock-resize-axis', 'x');
    act(() => vi.advanceTimersByTime(520));
    document.documentElement.removeAttribute('data-dock-resize-axis');

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('observes a resize-owned pointer end dispatched at window level', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);

    fireEvent.pointerDown(getByTestId('target'), {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 9,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(window, {
      clientX: 27,
      clientY: 20,
      pointerId: 9,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('keeps a Safari long-press alive when Pointer Events cancel but Touch Events continue', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');
    const touch = { identifier: 12, clientX: 40, clientY: 60, target };

    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 40,
      clientY: 60,
      pointerId: 12,
      pointerType: 'touch',
    });
    fireEvent.touchStart(target, { touches: [touch], changedTouches: [touch] });
    fireEvent.pointerCancel(window, {
      clientX: 40,
      clientY: 60,
      pointerId: 12,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it('supports Safari touch-only long-press delivery', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');
    const touch = { identifier: 13, clientX: 21, clientY: 34, target };

    fireEvent.touchStart(target, { touches: [touch], changedTouches: [touch] });
    act(() => vi.advanceTimersByTime(520));

    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(onContextMenu.mock.calls[0][0].clientX).toBe(21);
    expect(onContextMenu.mock.calls[0][0].clientY).toBe(34);
  });

  it('leaves Media Panel double taps available for item-specific actions', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(
      <Harness onContextMenu={onContextMenu} targetClassName="media-panel-content" />,
    );
    const target = getByTestId('target');
    const firstTouch = { identifier: 14, clientX: 75, clientY: 90, target };
    const secondTouch = { identifier: 15, clientX: 78, clientY: 92, target };

    fireEvent.touchStart(target, { touches: [firstTouch], changedTouches: [firstTouch] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [firstTouch] });
    act(() => vi.advanceTimersByTime(180));
    fireEvent.touchStart(target, { touches: [secondTouch], changedTouches: [secondTouch] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [secondTouch] });

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('does not turn a double tap outside the Media Panel into a context menu', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(<Harness onContextMenu={onContextMenu} />);
    const target = getByTestId('target');
    const firstTouch = { identifier: 16, clientX: 75, clientY: 90, target };
    const secondTouch = { identifier: 17, clientX: 75, clientY: 90, target };

    fireEvent.touchStart(target, { touches: [firstTouch], changedTouches: [firstTouch] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [firstTouch] });
    act(() => vi.advanceTimersByTime(180));
    fireEvent.touchStart(target, { touches: [secondTouch], changedTouches: [secondTouch] });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [secondTouch] });

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('suppresses the hold-release click on a newly opened menu but allows the next tap', () => {
    vi.useFakeTimers();
    const onMenuAction = vi.fn();

    function MenuHarness() {
      const [open, setOpen] = useState(false);
      useTouchContextMenu();
      return (
        <>
          <div
            data-testid="long-press-target"
            onContextMenu={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          />
          {open && <button data-testid="menu-action" onClick={onMenuAction}>Import Media</button>}
        </>
      );
    }

    const { getByTestId } = render(<MenuHarness />);
    const target = getByTestId('long-press-target');
    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 40,
      clientY: 60,
      pointerId: 10,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));
    fireEvent.pointerUp(window, {
      clientX: 40,
      clientY: 60,
      pointerId: 10,
      pointerType: 'touch',
    });
    const menuAction = getByTestId('menu-action');

    // WebKit can retarget the compatibility click from the original hold to
    // the menu item that has appeared under the still-held finger.
    fireEvent.click(menuAction);
    expect(onMenuAction).not.toHaveBeenCalled();

    fireEvent.pointerDown(menuAction, {
      button: 0,
      pointerId: 11,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(menuAction, {
      button: 0,
      pointerId: 11,
      pointerType: 'touch',
    });
    fireEvent.click(menuAction);

    expect(onMenuAction).toHaveBeenCalledOnce();
  });

  it('does not cancel a slowly adjusted numeric value as a long press', () => {
    vi.useFakeTimers();
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const { getByTestId } = render(
      <Harness onContextMenu={onContextMenu} targetClassName="draggable-number" />,
    );
    const target = getByTestId('target');

    fireEvent.pointerDown(target, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 7,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(target, {
      clientX: 27,
      clientY: 20,
      pointerId: 7,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(1_000));

    expect(onContextMenu).not.toHaveBeenCalled();
  });
});
