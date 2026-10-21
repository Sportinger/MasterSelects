import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EffectDefinition } from '../../src/effects/types';
import { EffectCatalogPicker } from '../../src/components/panels/properties/EffectCatalogPicker';

// Tiles render their name only: thumbnails need the GPU preview runtime.
vi.mock('../../src/components/panels/looks/LookTile', () => ({
  LookTile: ({ look }: { look: { name: string } }) => <button type="button" data-testid="effect-tile">{look.name}</button>,
}));

afterEach(cleanup);

it('focuses effect search when the video catalog opens', () => {
  const { container } = render(<EffectCatalogPicker groups={[]} sourceFrameId="" onSelect={vi.fn()} />);
  fireEvent.click(screen.getByText('+ Add Effect'));
  fireEvent(container.querySelector('details')!, new Event('toggle', { bubbles: true }));
  expect(screen.getByRole('textbox', { name: 'Search effects' })).toHaveFocus();
});

it('lists effects named like the search first and keeps the catalog order otherwise', () => {
  const effect = (id: string, name: string) => ({ id, name, category: 'stylize', params: {} }) as unknown as EffectDefinition;
  // Every effect matches "glitch" through its category; only some by name.
  const groups = [{ category: 'Glitch Art', effects: [
    effect('test-rgb-split', 'RGB Split'),
    effect('test-analog-glitch', 'Analog Glitch Lab'),
    effect('test-pixel-sort', 'Pixel Sort'),
    effect('test-glitchy-lines', 'Glitchy Lines'),
    effect('test-glitch', 'Glitch'),
  ] }];
  render(<EffectCatalogPicker groups={groups} sourceFrameId="" onSelect={vi.fn()} />);
  const names = () => screen.getAllByTestId('effect-tile').map((tile) => tile.textContent);
  expect(names()).toEqual(['RGB Split', 'Analog Glitch Lab', 'Pixel Sort', 'Glitchy Lines', 'Glitch']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search effects' }), { target: { value: ' GLITCH ' } });
  expect(names()).toEqual(['Glitch', 'Glitchy Lines', 'Analog Glitch Lab', 'RGB Split', 'Pixel Sort']);
});
