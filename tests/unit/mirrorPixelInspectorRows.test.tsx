// Inspector rows of the mirror, split and pixel effects (docs/Features/Effects-Mirror-Pixel.md):
// values read with the decimals of their step, Angle dims in RGB Split's Lens mode with a visible
// reason, colour rows show their hex value and reset, and value notes name parameters by their label.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { stepDecimals } from '../../src/components/panels/properties/resolveEffectRows';
import { EffectBudgetNotice } from '../../src/components/panels/properties/EffectBudgetNotice';
import { getEffect } from '../../src/effects';

vi.mock('../../src/components/panels/properties/LabeledValue', () => ({
  LabeledValue: ({ value, ariaLabel, decimals, disabled }: { value: number; ariaLabel: string; decimals?: number; disabled?: boolean }) =>
    <input aria-label={ariaLabel} data-decimals={decimals} disabled={disabled} value={String(value)} readOnly />,
}));
afterEach(() => { cleanup(); localStorage.clear(); });

describe('mirror, split and pixel inspector rows', () => {
  it('shows values with the decimals their step implies', () => {
    expect([0.5, 0.05, 0.01, 0.001, 0.25, 1, 2.5, 0.0001].map(stepDecimals)).toEqual([1, 2, 2, 3, 2, 0, 1, 4]);
    const grout = getEffect('block-mosaic')!.params.grout;
    render(<ResolveEffectParamRow paramName="grout" definition={grout} value={2} effect={{ id: 'mosaic-1', params: { grout: 2 } }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Grout Width' }).dataset.decimals).toBe('1');
  });

  it('dims RGB Split Angle in Lens mode and says why; Offset mode keeps it active', () => {
    const angle = getEffect('rgb-split')!.params.angle;
    const { container, rerender } = render(<ResolveEffectParamRow paramName="angle" definition={angle} value={0}
      effect={{ id: 'split-1', params: { amount: .01, angle: 0, mode: 'lens' } }} onChange={vi.fn()} />);
    const row = container.querySelector('.inspector-row')!;
    expect(row.classList.contains('is-disabled')).toBe(true);
    expect(row.getAttribute('title')).toContain('Offset mode only');
    // The reason is also visible under the row (no hover on touch).
    expect(container.querySelector('.resolve-effect-row-note')?.textContent).toBe('Offset mode only: Lens splits outwards from the centre.');
    rerender(<ResolveEffectParamRow paramName="angle" definition={angle} value={0}
      effect={{ id: 'split-1', params: { amount: .01, angle: 0, mode: 'offset' } }} onChange={vi.fn()} />);
    expect(container.querySelector('.inspector-row')!.classList.contains('is-disabled')).toBe(false);
    expect(container.querySelector('.resolve-effect-row-note')).toBeNull();
  });

  it('keeps the grout controls together and lets Levels span the whole 2–64 range it renders', () => {
    expect(Object.entries(getEffect('block-mosaic')!.params).filter(([, param]) => !param.deprecated).map(([id]) => id))
      .toEqual(['scale', 'grout', 'colorA', 'speed', 'amount']);
    expect(getEffect('blockify')!.params.levels).toMatchObject({ min: 2, max: 64 });
  });

  it('shows the hex value of a colour and resets it to the default', () => {
    const color = getEffect('block-mosaic')!.params.colorA, changed = vi.fn();
    render(<ResolveEffectParamRow paramName="colorA" definition={color} value="#ff8800" effect={{ id: 'mosaic-1', params: { colorA: '#ff8800', grout: 2 } }}
      onChange={changed} />);
    expect(screen.getByText('#FF8800')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Grout Color' }));
    expect(changed).toHaveBeenLastCalledWith({ colorA: color.default, grout: 2 });
  });

  it('names parameters by their label in the inspector notes', () => {
    render(<EffectBudgetNotice effectType="blockify" params={{ scale: 16, levels: 1, amount: 1, dither: 1 }} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Levels: 1 is outside 2–64/);
  });
});
