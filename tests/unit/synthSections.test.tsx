import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { createDefaultMidiInstrument, type SimpleSynthInstrument } from '../../src/types/midiClip';
import { OscillatorSection } from '../../src/components/panels/properties/synthSections/OscillatorSection';
import { FilterSection } from '../../src/components/panels/properties/synthSections/FilterSection';
import { LfoSection } from '../../src/components/panels/properties/synthSections/LfoSection';
import { ModMatrixSection } from '../../src/components/panels/properties/synthSections/ModMatrixSection';

const inst = () => createDefaultMidiInstrument('simple-synth') as SimpleSynthInstrument;

describe('synth panel sections (smoke)', () => {
  it('OscillatorSection renders and patches gain', () => {
    const onChange = vi.fn();
    const { container } = render(<OscillatorSection instrument={inst()} onChange={onChange} />);
    // Gain is now a knob (role="slider"); arrow keys nudge its value.
    const knob = container.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalled();
  });

  it('FilterSection toggles the filter off (undefined patch)', () => {
    const onChange = vi.fn();
    const { container } = render(<FilterSection instrument={inst()} onChange={onChange} />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox); // starts checked (default has a filter) → turns off
    expect(onChange).toHaveBeenCalledWith({ filter: undefined });
  });

  it('LfoSection adds an LFO with a stable id', () => {
    const onChange = vi.fn();
    const { getByText } = render(<LfoSection instrument={{ ...inst(), lfos: [] }} onChange={onChange} />);
    fireEvent.click(getByText('+ Add LFO'));
    const patch = onChange.mock.calls[0][0];
    expect(patch.lfos).toHaveLength(1);
    expect(typeof patch.lfos[0].id).toBe('string');
    expect(patch.lfos[0].id.length).toBeGreaterThan(0);
  });

  it('ModMatrixSection adds a typed routing', () => {
    const onChange = vi.fn();
    const { getByText } = render(<ModMatrixSection instrument={{ ...inst(), modMatrix: [] }} onChange={onChange} />);
    fireEvent.click(getByText('+ Add Route'));
    const patch = onChange.mock.calls[0][0];
    expect(patch.modMatrix).toHaveLength(1);
    expect(patch.modMatrix[0].destination).toHaveProperty('kind');
  });
});
