import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlyphAtlasControls } from '../../src/components/panels/nodes/workspace/GlyphAtlasControls';
import type { EffectParam } from '../../src/effects/types';

afterEach(cleanup);

const schema: Record<string, EffectParam> = {
  ramp: { type: 'select', label: 'Ramp', default: 'blocks', options: [{ value: 'standard', label: 'Standard' }, { value: 'blocks', label: 'Blocks' }] },
  custom: { type: 'text', label: 'Custom Ramp', default: ' .#' },
  font: { type: 'select', label: 'Font', default: 'mono', options: [{ value: 'mono', label: 'Mono' }, { value: 'serif', label: 'Serif' }] },
  weight: { type: 'number', label: 'Weight', default: 600, min: 200, max: 900, step: 100, animatable: false },
};
const bindings = { rampPreset: 'ramp', customRamp: 'custom', fontFamily: 'font', fontWeight: 'weight' };

describe('GlyphAtlasControls', () => {
  it('uses owner schemas and stable effect bindings for select, text, reset, and number controls', () => {
    const onChange = vi.fn(), renderNumber = vi.fn((key, spec, value) => <button onClick={() => onChange(key, 700)}>{spec.label} {value}</button>);
    render(<GlyphAtlasControls bindings={bindings} parameterSchema={schema}
      params={{ ramp: 'standard', custom: '@@', font: 'serif', weight: 500 }} onChange={onChange} renderNumber={renderNumber} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Glyph Atlas Ramp' }));
    fireEvent.click(screen.getByRole('option', { name: 'Blocks' }));
    const customRamp = screen.getByRole('textbox', { name: 'Glyph Atlas Custom Ramp' });
    expect(customRamp).toHaveClass('resolve-inspector-text-input');
    fireEvent.change(customRamp, { target: { value: '01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Custom Ramp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weight 500' }));

    expect(onChange).toHaveBeenCalledWith('ramp', 'blocks');
    expect(onChange).toHaveBeenCalledWith('custom', '01');
    expect(onChange).toHaveBeenCalledWith('custom', ' .#');
    expect(onChange).toHaveBeenCalledWith('weight', 700);
    expect(renderNumber).toHaveBeenCalledWith('weight', schema.weight, 500);
  });

  it('fails visibly when an owner binding schema is missing or has the wrong type', () => {
    render(<GlyphAtlasControls bindings={bindings} parameterSchema={{ ...schema, font: { ...schema.font, type: 'text' } }}
      params={{}} onChange={vi.fn()} renderNumber={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('fontFamily');
  });
});
