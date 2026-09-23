import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EffectCatalogPicker } from '../../src/components/panels/properties/EffectCatalogPicker';

afterEach(cleanup);

it('focuses effect search when the video catalog opens', () => {
  const { container } = render(<EffectCatalogPicker groups={[]} sourceFrameId="" onSelect={vi.fn()} />);
  fireEvent.click(screen.getByText('+ Add Effect'));
  fireEvent(container.querySelector('details')!, new Event('toggle', { bubbles: true }));
  expect(screen.getByRole('textbox', { name: 'Search effects' })).toHaveFocus();
});
