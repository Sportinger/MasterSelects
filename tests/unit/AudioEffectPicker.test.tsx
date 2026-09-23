import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEffectPicker } from '../../src/components/panels/properties/AudioEffectPicker';

afterEach(cleanup);

describe('audio effect tile catalog', () => {
  it('filters by search and category and adds from a text tile', () => {
    const select = vi.fn();
    const { container } = render(<AudioEffectPicker onSelect={select} excludeDescriptorIds={new Set(['audio-volume'])} />);
    fireEvent.click(screen.getByText('+ Add Effect'));
    fireEvent(container.querySelector('details')!, new Event('toggle', { bubbles: true }));
    expect(screen.getByRole('textbox', { name: 'Search effects' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Volume', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Audio Math Graph', exact: true })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: 'delay' } });
    expect(screen.queryByRole('button', { name: 'EQ', exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delay', exact: true })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search effects'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Effect category' }));
    fireEvent.click(screen.getByRole('option', { name: 'time', exact: true }));
    expect(screen.queryByRole('button', { name: 'EQ', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delay', exact: true }));
    expect(select).toHaveBeenCalledWith('audio-delay');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });
});
