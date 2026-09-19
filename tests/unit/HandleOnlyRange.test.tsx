import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandleOnlyRange } from '../../src/components/panels/properties/transformTab/HandleOnlyRange';

afterEach(cleanup);

function renderRange() {
  const onChange = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  render(
    <HandleOnlyRange
      aria-label="Test slider"
      max={100}
      min={0}
      onChange={onChange}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      step={1}
      value={50}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Test slider' }) as HTMLDivElement;
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    bottom: 32,
    height: 12,
    left: 10,
    right: 110,
    top: 20,
    width: 100,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });
  return { onChange, onDragEnd, onDragStart, slider };
}

describe('HandleOnlyRange', () => {
  it('ignores touch presses on the track instead of jumping', () => {
    const { onChange, onDragEnd, onDragStart, slider } = renderRange();

    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 95,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(slider, { clientX: 105, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(slider, { clientX: 105, pointerId: 1, pointerType: 'touch' });

    expect(onChange).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('drags from the touch handle and closes the edit batch once', () => {
    const { onChange, onDragEnd, onDragStart, slider } = renderRange();

    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 60,
      isPrimary: true,
      pointerId: 2,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 2, pointerType: 'touch' });
    fireEvent.pointerUp(slider, { clientX: 80, pointerId: 2, pointerType: 'touch' });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(72);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(slider).not.toHaveAttribute('data-touch-dragging');
  });

  it('owns panel touch swipes and exposes touch-drag feedback while active', () => {
    const { slider } = renderRange();

    expect(slider).toHaveAttribute('data-dock-tab-swipe-ignore', 'true');
    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 60,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'touch',
    });

    expect(slider).toHaveAttribute('data-touch-dragging', 'true');
  });

  it('keeps keyboard changes available', () => {
    const { onChange, slider } = renderRange();

    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith(51);
  });

  it('keeps the controlled value after a long touch drag is released', () => {
    function ControlledRange() {
      const [value, setValue] = useState(50);
      return (
        <HandleOnlyRange
          aria-label="Controlled slider"
          max={100}
          min={0}
          onChange={setValue}
          step={1}
          value={value}
        />
      );
    }

    render(<ControlledRange />);
    const slider = screen.getByRole('slider', { name: 'Controlled slider' });
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      bottom: 32,
      height: 26,
      left: 10,
      right: 110,
      top: 6,
      width: 100,
      x: 10,
      y: 6,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 60,
      isPrimary: true,
      pointerId: 4,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(slider, { clientX: 105, pointerId: 4, pointerType: 'touch' });
    fireEvent.pointerUp(slider, { clientX: 105, pointerId: 4, pointerType: 'touch' });

    expect(slider).toHaveAttribute('aria-valuenow', '98');
  });
});
