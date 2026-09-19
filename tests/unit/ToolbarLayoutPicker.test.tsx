import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolbarLayoutPicker } from '../../src/components/common/toolbar/ToolbarLayoutPicker';
import type { SavedDockLayout } from '../../src/types/dock';

function layout(id: string, name: string): SavedDockLayout {
  return {
    createdAt: 1,
    id,
    layout: {} as SavedDockLayout['layout'],
    name,
    updatedAt: 1,
  };
}

describe('ToolbarLayoutPicker', () => {
  it('opens the compact layout bubbles and selects one with a single click', () => {
    const onSelectLayout = vi.fn();
    render(
      <ToolbarLayoutPicker
        activeLayoutId="edit"
        layouts={[layout('edit', 'EDIT'), layout('mobile', 'MOBILE')]}
        onSelectLayout={onSelectLayout}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Layout' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Layouts' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'EDIT' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'MOBILE' }));
    expect(onSelectLayout).toHaveBeenCalledWith('mobile');
    expect(screen.queryByRole('menu', { name: 'Layouts' })).not.toBeInTheDocument();
  });

  it('closes the bubble menu with Escape', () => {
    render(
      <ToolbarLayoutPicker
        activeLayoutId={null}
        layouts={[layout('edit', 'EDIT')]}
        onSelectLayout={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'Layouts' })).not.toBeInTheDocument();
  });
});
