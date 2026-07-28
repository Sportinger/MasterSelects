import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineSnappingButton } from '../../src/components/timeline/components/TimelineSnappingButton';

describe('TimelineSnappingButton', () => {
  it('shows Shift as temporary state without changing the persisted toggle', () => {
    const onToggleSnapping = vi.fn();
    render(
      <TimelineSnappingButton
        snappingEnabled={false}
        onToggleSnapping={onToggleSnapping}
      />,
    );
    const button = screen.getByRole('button', { name: 'Snapping' });

    fireEvent.keyDown(window, { key: 'Shift' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-temporary-active', 'true');
    expect(onToggleSnapping).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: 'Shift' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveAttribute('data-temporary-active');
  });

  it('toggles once and releases pointer focus after a mouse click', () => {
    const onToggleSnapping = vi.fn();
    render(
      <TimelineSnappingButton
        snappingEnabled
        onToggleSnapping={onToggleSnapping}
      />,
    );
    const button = screen.getByRole('button', { name: 'Snapping' });
    button.focus();

    fireEvent.click(button, { detail: 1 });

    expect(onToggleSnapping).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveFocus();
  });

  it('retains focus for keyboard activation', () => {
    const onToggleSnapping = vi.fn();
    render(
      <TimelineSnappingButton
        snappingEnabled
        onToggleSnapping={onToggleSnapping}
      />,
    );
    const button = screen.getByRole('button', { name: 'Snapping' });
    button.focus();
    const globalKeyDown = vi.fn();
    window.addEventListener('keydown', globalKeyDown);

    fireEvent.keyDown(button, { key: ' ' });

    expect(onToggleSnapping).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();
    expect(globalKeyDown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalKeyDown);
  });
});
