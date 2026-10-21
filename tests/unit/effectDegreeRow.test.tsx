// Twirl stores its Twist in radians (projects, keyframes, tools); the inspector reads and edits degrees.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { getEffect } from '../../src/effects';

vi.mock('../../src/components/panels/properties/LabeledValue', () => ({
  LabeledValue: ({ value, suffix, ariaLabel, onChange }: { value: number; suffix?: string; ariaLabel: string; onChange: (value: number) => void }) =>
    <input aria-label={ariaLabel} data-suffix={suffix} value={String(value)} onChange={event => onChange(Number(event.target.value))} />,
}));
afterEach(() => { cleanup(); localStorage.clear(); });

describe('effect rows with a degree display unit', () => {
  it('shows Twist in degrees and stores radians', () => {
    const definition = getEffect('twirl')!.params.amount, changed = vi.fn();
    expect(definition.displayUnit).toBe('degrees');
    render(<ResolveEffectParamRow paramName="amount" definition={definition} value={Math.PI / 2}
      effect={{ id: 'twirl-1', params: { amount: Math.PI / 2, radius: .5 } }} onChange={changed} />);
    const field = screen.getByRole('textbox', { name: 'Twist' }) as HTMLInputElement;
    expect(Number(field.value)).toBeCloseTo(90, 9);
    expect(field.dataset.suffix).toBe('°');
    expect(Number(screen.getByRole('slider', { name: 'Twist slider' }).getAttribute('aria-valuemax'))).toBeCloseTo(720, 6);
    fireEvent.change(field, { target: { value: '360' } });
    expect(changed).toHaveBeenLastCalledWith({ amount: expect.closeTo(2 * Math.PI, 12), radius: .5 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Twist' }));
    expect(changed).toHaveBeenLastCalledWith({ amount: expect.closeTo(2, 12), radius: .5 });
  });

  it('leaves rows without a display unit in their stored unit', () => {
    const definition = getEffect('twirl')!.params.radius, changed = vi.fn();
    render(<ResolveEffectParamRow paramName="radius" definition={definition} value={.5} effect={{ id: 'twirl-1', params: { radius: .5 } }} onChange={changed} />);
    const field = screen.getByRole('textbox', { name: 'Radius' }) as HTMLInputElement;
    expect(field.value).toBe('0.5'); expect(field.dataset.suffix).toBeUndefined();
  });
});
