import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeaveNoteDialog } from '../../src/components/common/LeaveNoteDialog';

describe('LeaveNoteDialog', () => {
  it('renders as a non-modal floating window and moves from its header', () => {
    render(
      <LeaveNoteDialog
        onClose={vi.fn()}
        submitNote={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const heading = screen.getByRole('heading', { name: 'Leave a note' });
    const header = heading.closest('.leave-note-header');
    expect(header).not.toBeNull();
    expect(dialog).not.toHaveAttribute('aria-modal');

    Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: 420 });
    Object.defineProperty(dialog, 'offsetHeight', { configurable: true, value: 300 });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      bottom: 400,
      height: 300,
      left: 200,
      right: 620,
      top: 100,
      width: 420,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(header!, { clientX: 220, clientY: 120 });
    expect(dialog).toHaveClass('is-dragging');
    fireEvent.mouseMove(document, { clientX: 320, clientY: 220 });
    fireEvent.mouseUp(document);

    expect(dialog).toHaveStyle({ left: '300px', top: '200px' });
    expect(dialog).not.toHaveClass('is-dragging');
  });
});
