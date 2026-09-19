import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDockPanelTabSwipe } from '../../src/components/dock/tabPane/useDockPanelTabSwipe';

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
  activeIndex = 1,
  onButtonMouseOver,
  onButtonPointerCancel,
  onSelect,
}: {
  activeIndex?: number;
  onButtonMouseOver?: () => void;
  onButtonPointerCancel?: () => void;
  onSelect: (index: number) => void;
}) {
  const swipe = useDockPanelTabSwipe({ activeIndex, panelCount: 3, onSelect });
  return (
    <div
      data-testid="surface"
      data-motion={swipe.motionClass}
      data-suppressed={swipe.suppressContentInteractions || undefined}
      {...swipe.handlers}
    >
      <div data-testid="empty" />
      <button
        data-testid="button"
        type="button"
        onMouseOver={onButtonMouseOver}
        onPointerCancel={onButtonPointerCancel}
      >
        Action
      </button>
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <span data-testid="scroller-child">Wide</span>
      </div>
      <div data-testid="swipe-ignore" data-dock-tab-swipe-ignore="true">
        <span data-testid="swipe-ignore-child">Own gesture</span>
      </div>
      <div data-testid="preview-edit" className="preview-container" data-preview-edit-mode="true">
        <span data-testid="preview-edit-handle">Edit handle</span>
      </div>
      <svg data-testid="mask-overlay" className="mask-overlay-svg">
        <circle data-testid="mask-handle" />
      </svg>
    </div>
  );
}

function swipe(target: Element, fromX: number, toX: number, toY = 100, pointerType = 'touch') {
  act(() => {
    target.dispatchEvent(pointerEvent('pointerdown', {
      clientX: fromX,
      clientY: 100,
      pointerType,
    }));
    target.dispatchEvent(pointerEvent('pointermove', {
      clientX: toX,
      clientY: toY,
      pointerType,
    }));
    target.dispatchEvent(pointerEvent('pointerup', {
      clientX: toX,
      clientY: toY,
      pointerType,
    }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDockPanelTabSwipe', () => {
  it('switches to the next tab with exit and entrance motion on a left swipe', () => {
    const onSelect = vi.fn();
    const view = render(<Harness onSelect={onSelect} />);
    const empty = view.getByTestId('empty');
    const surface = view.getByTestId('surface');

    swipe(empty, 220, 120);
    expect(surface.dataset.motion).toBe('dock-panel-tab-swipe-exit-left');
    expect(onSelect).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(175));
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(surface.dataset.motion).toBe('dock-panel-tab-swipe-enter-right');

    act(() => vi.advanceTimersByTime(300));
    expect(surface.dataset.motion).toBe('');
  });

  it('switches to the previous tab on a right swipe', () => {
    const onSelect = vi.fn();
    const view = render(<Harness onSelect={onSelect} />);

    swipe(view.getByTestId('empty'), 100, 180);
    act(() => vi.advanceTimersByTime(175));

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(view.getByTestId('surface').dataset.motion).toBe('dock-panel-tab-swipe-enter-left');
  });

  it('does not claim vertical gestures or mouse input', () => {
    const onSelect = vi.fn();
    const view = render(<Harness onSelect={onSelect} />);

    swipe(view.getByTestId('empty'), 200, 180, 180);
    swipe(view.getByTestId('empty'), 200, 100, 100, 'mouse');
    act(() => vi.runAllTimers());

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('gives a horizontal swipe priority over controls and scrollable content', () => {
    const onSelect = vi.fn();
    const onButtonPointerCancel = vi.fn();
    const view = render(
      <Harness onSelect={onSelect} onButtonPointerCancel={onButtonPointerCancel} />,
    );

    swipe(view.getByTestId('button'), 200, 100);
    expect(onButtonPointerCancel).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(175));
    expect(onSelect).toHaveBeenCalledWith(2);

    act(() => vi.runAllTimers());
    onSelect.mockClear();
    const scroller = view.getByTestId('scroller');
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 400 },
    });

    swipe(view.getByTestId('scroller-child'), 200, 100);
    act(() => vi.advanceTimersByTime(175));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('suppresses content hover after a claimed swipe, then releases it', () => {
    const onSelect = vi.fn();
    const onButtonMouseOver = vi.fn();
    const view = render(<Harness onSelect={onSelect} onButtonMouseOver={onButtonMouseOver} />);
    const button = view.getByTestId('button');
    const surface = view.getByTestId('surface');

    swipe(button, 200, 100);
    expect(surface.dataset.suppressed).toBe('true');
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    expect(onButtonMouseOver).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(575));
    expect(surface.dataset.suppressed).toBeUndefined();
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    expect(onButtonMouseOver).toHaveBeenCalledOnce();
  });

  it('leaves explicit owners, masks, and preview edit-mode drags with their editing surfaces', () => {
    const onSelect = vi.fn();
    const view = render(<Harness onSelect={onSelect} />);

    swipe(view.getByTestId('swipe-ignore-child'), 200, 100);
    swipe(view.getByTestId('preview-edit-handle'), 200, 100);
    swipe(view.getByTestId('mask-handle'), 200, 100);
    act(() => vi.runAllTimers());

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.getByTestId('surface').dataset.suppressed).toBeUndefined();
  });

  it('stops at the first and last tab', () => {
    const onSelect = vi.fn();
    const first = render(<Harness activeIndex={0} onSelect={onSelect} />);
    swipe(first.getByTestId('empty'), 100, 180);
    act(() => vi.runAllTimers());
    expect(onSelect).not.toHaveBeenCalled();

    first.unmount();
    const last = render(<Harness activeIndex={2} onSelect={onSelect} />);
    swipe(last.getByTestId('empty'), 200, 100);
    act(() => vi.runAllTimers());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
