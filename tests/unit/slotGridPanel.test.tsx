import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/timeline/SlotGrid', () => ({
  SlotGrid: ({ opacity, standalone }: { opacity: number; standalone?: boolean }) => (
    <div
      data-testid="slot-grid"
      data-opacity={String(opacity)}
      data-standalone={String(Boolean(standalone))}
    />
  ),
}));

import { SlotGridPanel } from '../../src/components/panels/slot-grid/SlotGridPanel';

afterEach(() => {
  cleanup();
});

describe('SlotGridPanel', () => {
  it('shows a top-left control that changes this panel view back to Timeline', () => {
    const onShowTimeline = vi.fn();
    const { container } = render(<SlotGridPanel onShowTimeline={onShowTimeline} />);

    const toolbar = container.querySelector('.slot-grid-panel-toolbar');
    const button = screen.getByRole('button', { name: 'Show Timeline' });
    expect(toolbar?.firstElementChild).toBe(button);
    expect(screen.getByTestId('slot-grid')).toHaveAttribute('data-standalone', 'true');

    fireEvent.click(button);

    expect(onShowTimeline).toHaveBeenCalledTimes(1);
  });
});
