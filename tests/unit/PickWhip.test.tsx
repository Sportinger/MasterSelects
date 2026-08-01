import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickWhip } from '../../src/components/timeline/PickWhip';

describe('PickWhip controls', () => {
  it('starts a pointer-captured drag and exposes a separate clear action', () => {
    const onDragStart = vi.fn();
    const onSetParent = vi.fn();
    const { rerender } = render(
      <PickWhip
        clipId="child"
        clipName="Child"
        parentClipId={undefined}
        parentClipName={undefined}
        isDragging={false}
        onSetParent={onSetParent}
        onDragStart={onDragStart}
        onDragEnd={vi.fn()}
      />,
    );
    const dragButton = screen.getByRole('button', { name: 'Set parent for Child' });
    dragButton.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(dragButton, { button: 0, pointerId: 4 });
    expect(onDragStart).toHaveBeenCalledWith('child', 20, 30);

    rerender(
      <PickWhip
        clipId="child"
        clipName="Child"
        parentClipId="parent"
        parentClipName="Parent"
        isDragging={false}
        onSetParent={onSetParent}
        onDragStart={onDragStart}
        onDragEnd={vi.fn()}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Clear parent for Child' }));
    expect(onSetParent).toHaveBeenCalledWith('child', null);
  });

  it('disables both parenting actions on a locked track', () => {
    render(
      <PickWhip
        clipId="child"
        clipName="Child"
        parentClipId="parent"
        parentClipName="Parent"
        isDragging={false}
        disabled
        onSetParent={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Set parent for Child' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear parent for Child' })).toBeDisabled();
  });
});
