import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineRuler } from '../../src/components/timeline/TimelineRuler';
import { useTouchContextMenu } from '../../src/hooks/useTouchContextMenu';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function TouchEnabledRuler(props: React.ComponentProps<typeof TimelineRuler>) {
  useTouchContextMenu();
  return <TimelineRuler {...props} />;
}

describe('TimelineRuler touch input', () => {
  it('routes a primary touch press into the existing ruler scrub path', () => {
    const onRulerMouseDown = vi.fn();
    const { getByLabelText } = render(
      <TimelineRuler
        duration={10}
        zoom={100}
        scrollX={0}
        onRulerMouseDown={onRulerMouseDown}
        formatTime={(time) => time.toFixed(2)}
      />,
    );

    fireEvent.pointerDown(getByLabelText('Timeline ruler'), {
      button: 0,
      clientX: 240,
      pointerId: 15,
      pointerType: 'touch',
    });

    expect(onRulerMouseDown).toHaveBeenCalledTimes(1);
    expect(onRulerMouseDown.mock.calls[0][0].clientX).toBe(240);
  });

  it('opens In, Out, and Marker actions on touch hold at the pressed time', () => {
    vi.useFakeTimers();
    const onSetInPoint = vi.fn();
    const onSetOutPoint = vi.fn();
    const onAddMarker = vi.fn();
    render(
      <TouchEnabledRuler
        duration={10}
        formatTime={(time) => time.toFixed(2)}
        onAddMarker={onAddMarker}
        onRulerMouseDown={vi.fn()}
        onSetInPoint={onSetInPoint}
        onSetOutPoint={onSetOutPoint}
        scrollX={0}
        zoom={100}
      />,
    );
    const ruler = screen.getByLabelText('Timeline ruler');
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      bottom: 130,
      height: 30,
      left: 100,
      right: 1100,
      top: 100,
      width: 1000,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(ruler, {
      button: 0,
      clientX: 350,
      clientY: 115,
      pointerId: 22,
      pointerType: 'touch',
    });
    act(() => vi.advanceTimersByTime(520));

    expect(screen.getByRole('menu', { name: 'Ruler actions at 2.50' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Set In' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Set Out' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Marker' }));
    expect(onAddMarker).toHaveBeenCalledWith(2.5);
    expect(onSetInPoint).not.toHaveBeenCalled();
    expect(onSetOutPoint).not.toHaveBeenCalled();
  });
});
