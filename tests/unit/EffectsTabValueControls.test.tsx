import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';

import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { hasResolveEffectParamRow } from '../../src/components/panels/properties/resolveEffectRows';
import { getEffect } from '../../src/effects';
import type { EffectParam } from '../../src/effects/types';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('EffectsTab numeric controls', () => {
  it('writes only the edited parameter from a complete control snapshot', () => {
    const numeric = vi.spyOn(useTimelineStore.getState(), 'setPropertyValue').mockImplementation(() => {});
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    const effect: Effect = { id: 'single-edit', type: 'brightness', name: 'Brightness', enabled: true,
      params: { amount: 0.25, unchangedNumber: 12, unchangedSelect: 'keep' } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    fireEvent.contextMenu(screen.getByLabelText('Amount'));
    expect(numeric).toHaveBeenCalledTimes(1);
    expect(numeric).toHaveBeenCalledWith('clip:effects-controls', 'effect.single-edit.amount', 0);
    expect(patch).not.toHaveBeenCalled();
  });
  it('refreshes displayed parameters after otherwise identical effect snapshots', () => {
    const effect: Effect = { id: 'animated', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.25 } };
    const view = render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, params: { ...effect.params } }]} />);
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-valuenow', '0.25');
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, params: { amount: 0.75 } }]} />);
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-valuenow', '0.75');
  });

  it('collapses on bypass and stays collapsed when enabled again', () => {
    const effect: Effect = { id: 'bypass-test', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.25 } };
    const view = render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    expect(screen.getByLabelText('Amount')).toBeVisible();
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, enabled: false }]} />);
    expect(screen.queryByLabelText('Amount')).toBeNull();
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    expect(screen.getByTitle('Expand Brightness')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows Radial Blur type and strength but no retired Samples or Quality section', () => {
    const radial: Effect = { id: 'radial-ui', type: 'radial-blur', name: 'Radial Blur', enabled: true,
      params: { mode: 'spin', amount: 0.5, centerX: 0.5, centerY: 0.5, samples: 32 } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[radial]} />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeVisible();
    expect(screen.queryByLabelText('Samples')).toBeNull();
    expect(screen.queryByText('Quality')).toBeNull();
  });

  it('keeps the generic control for parameter types without a Resolve row in a Resolve-row effect', () => {
    const params = getEffect('gaussian-blur')!.params as Record<string, EffectParam>;
    params.previewNote = { type: 'text', label: 'Preview Note', default: 'a' };
    try {
      const effect: Effect = { id: 'gaussian-text', type: 'gaussian-blur', name: 'Gaussian Blur', enabled: true, params: { radius: 4, previewNote: 'b' } };
      render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
      expect(screen.getByText('Preview Note')).toBeInTheDocument();
      expect(screen.getByLabelText('Radius slider')).toBeInTheDocument();
      expect(hasResolveEffectParamRow({ type: 'text' })).toBe(false);
      expect(hasResolveEffectParamRow({ type: 'select' })).toBe(true);
    } finally {
      delete params.previewNote;
    }
  });

  it('renders switches and colours as Resolve rows: Mirror axes as checkboxes, the Block Mosaic grout as a colour well', () => {
    expect(hasResolveEffectParamRow({ type: 'boolean' })).toBe(true);
    expect(hasResolveEffectParamRow({ type: 'color' })).toBe(true);
    const mirror: Effect = { id: 'mirror-rows', type: 'mirror', name: 'Mirror', enabled: true, params: { horizontal: true, vertical: false } };
    const mosaic: Effect = { id: 'mosaic-rows', type: 'block-mosaic', name: 'Block Mosaic', enabled: true, params: { colorA: '#11223380' } };
    const { container } = render(<EffectsTab clipId="clip:effects-controls" effects={[mirror, mosaic]} />);
    expect(screen.getByRole('checkbox', { name: 'Left / Right' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Top / Bottom' })).not.toBeChecked();
    expect(screen.getByLabelText('Grout Color')).toHaveValue('#112233');
    // Mirror's Angle is stored in radians and edited in degrees, like Kaleidoscope Rotation.
    expect(screen.getByLabelText('Angle slider')).toBeInTheDocument();
    expect(container.querySelectorAll('.resolve-effect-checkbox')).toHaveLength(2);
  });

  it('shows stylize switches and colours as Resolve rows (Glow Color, Edge Detect Invert) and writes them', () => {
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    const glow: Effect = { id: 'glow-color', type: 'glow', name: 'Glow', enabled: true, params: { amount: 1, threshold: 0.6, softness: 0.5, radius: 40, color: '#ffaa33cc' } };
    const edge: Effect = { id: 'edge-invert', type: 'edge-detect', name: 'Edge Detect', enabled: true, params: { strength: 1, width: 1, colorize: 0, invert: false } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[glow, edge]} />);
    const color = screen.getByLabelText('Color', { selector: 'input[type="color"]' }) as HTMLInputElement;
    expect(color.value).toBe('#ffaa33');
    expect(screen.getByLabelText('Threshold slider')).toBeInTheDocument();
    const invert = screen.getByLabelText('Invert', { selector: 'input[type="checkbox"]' }) as HTMLInputElement;
    expect(invert.checked).toBe(false);
    fireEvent.click(invert);
    expect(JSON.stringify(patch.mock.calls)).toContain('"invert":true');
    expect(hasResolveEffectParamRow({ type: 'boolean' })).toBe(true);
    expect(hasResolveEffectParamRow({ type: 'color' })).toBe(true);
  });

  it('renders blur controls as Resolve inspector rows: slider, number and reset, and Type as an inspector select', () => {
    const radial: Effect = { id: 'radial-rows', type: 'radial-blur', name: 'Radial Blur', enabled: true,
      params: { mode: 'spin', amount: 0.5, centerX: 0.5, centerY: 0.5 } };
    const { container } = render(<EffectsTab clipId="clip:effects-controls" effects={[radial]} />);
    expect(screen.getByLabelText('Amount slider')).toBeInTheDocument();
    expect(screen.getByLabelText('Reset Center X')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelectorAll('.resolve-inspector-row, [class*="resolve"]').length).toBeGreaterThan(0);
  });

  it('renders colour parameters of Resolve-row effects as a swatch, hex field and reset', () => {
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    const holo: Effect = { id: 'holo-colours', type: 'holo', name: 'Holo', enabled: true,
      params: { amount: .35, stripes: .6, speed: 1, colorA: '#123456', colorB: '#f472b6' } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[holo]} />);
    expect(hasResolveEffectParamRow({ type: 'color' })).toBe(true);
    expect(screen.getByLabelText('Spectrum A')).toHaveAttribute('type', 'color');
    const hex = screen.getByLabelText('Spectrum B hex');
    expect(hex).toHaveValue('#f472b6');
    fireEvent.change(hex, { target: { value: 'ABC' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(patch).toHaveBeenLastCalledWith('clip:effects-controls', 'holo-colours', expect.objectContaining({ colorB: '#aabbcc' }));
    fireEvent.change(hex, { target: { value: 'not a colour' } });
    fireEvent.blur(hex);
    expect(hex).toHaveValue('#f472b6');
    fireEvent.click(screen.getByLabelText('Reset Spectrum A'));
    expect(patch).toHaveBeenLastCalledWith('clip:effects-controls', 'holo-colours', expect.objectContaining({ colorA: '#22d3ee' }));
  });

  it('shows colour parameters in cards still on the generic rows (Riso Dark Ink / Warm Ink) and writes them', () => {
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    const riso: Effect = { id: 'riso-inks', type: 'riso', name: 'Riso', enabled: true,
      params: { amount: 0.75, scale: 8, colorA: '#123456', colorB: '#ef476f' } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[riso]} />);
    expect(screen.getByLabelText('Dark Ink')).toHaveAttribute('type', 'color');
    expect(screen.getByLabelText('Warm Ink hex')).toHaveValue('#ef476f');
    fireEvent.click(screen.getByLabelText('Reset Dark Ink'));
    expect(patch).toHaveBeenLastCalledWith('clip:effects-controls', 'riso-inks', expect.objectContaining({ colorA: '#2046b3' }));
    fireEvent.change(screen.getByLabelText('Warm Ink hex'), { target: { value: '#00ff00' } });
    fireEvent.keyDown(screen.getByLabelText('Warm Ink hex'), { key: 'Enter' });
    expect(patch).toHaveBeenLastCalledWith('clip:effects-controls', 'riso-inks', expect.objectContaining({ colorB: '#00ff00' }));
  });

  it('renders color controls as Resolve rows: Transform-style draggable value, thin slider and reset', () => {
    const brightness: Effect = {
      id: 'effect:brightness:test',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.25 },
    };

    const { container } = render(
      <EffectsTab clipId="clip:effects-controls" effects={[brightness]} />,
    );

    const value = screen.getByLabelText('Amount');
    expect(value).toHaveClass('draggable-number');
    expect(value).toHaveAttribute('role', 'slider');
    expect(value.closest('.labeled-value')).toHaveClass('resolve-inspector-field');
    expect(screen.getByLabelText('Amount slider')).toBeInTheDocument();
    expect(screen.getByLabelText('Reset Amount')).toBeInTheDocument();
    // The row grid comes from the params container (an effect card has no section header).
    expect(value.closest('.effect-params')).not.toBeNull();
    expect(container.querySelector('.param-slider')).not.toBeInTheDocument();
  });

  it('shows units in the value field: Hue Shift in degrees (stored as turns), Exposure in EV', () => {
    const numeric = vi.spyOn(useTimelineStore.getState(), 'setPropertyValue').mockImplementation(() => {});
    const exposure: Effect = { id: 'units-exposure', type: 'exposure', name: 'Exposure', enabled: true, params: { exposure: 1.5, offset: 0, gamma: 1 } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[exposure]} />);
    expect(screen.getByLabelText('Exposure')).toHaveTextContent('1.5 EV');
    fireEvent.contextMenu(screen.getByLabelText('Exposure'));
    expect(numeric).toHaveBeenCalledWith('clip:effects-controls', 'effect.units-exposure.exposure', 0);
  });

  it('shows as many decimals as a stored unit value needs, so the field never rounds what renders', () => {
    const exposure: Effect = { id: 'units-fine', type: 'exposure', name: 'Exposure', enabled: true, params: { exposure: 0.25, offset: 0, gamma: 1 } };
    const { unmount } = render(<EffectsTab clipId="clip:effects-controls" effects={[exposure]} />);
    expect(screen.getByLabelText('Exposure')).toHaveTextContent('0.25 EV');
    unmount();
    render(<EffectsTab clipId="clip:effects-controls" effects={[{ ...exposure, params: { ...exposure.params, exposure: -1.125 } }]} />);
    expect(screen.getByLabelText('Exposure')).toHaveTextContent('-1.125 EV');
  });

  it('titles a newly added effect with its registered name and keeps a renamed one', () => {
    const added: Effect = { id: 'named-by-type', type: 'gaussian-blur', name: 'gaussian-blur', enabled: true, params: { radius: 12 } };
    const renamed: Effect = { id: 'renamed', type: 'radial-blur', name: 'Stage swirl', enabled: true, params: { mode: 'spin', amount: 0.5 } };
    const { container } = render(<EffectsTab clipId="clip:effects-controls" effects={[added, renamed]} />);
    expect([...container.querySelectorAll('.effect-name')].map(name => name.textContent)).toEqual(['Gaussian Blur', 'Stage swirl']);
    expect(screen.getByTitle('Collapse Gaussian Blur')).toBeInTheDocument();
  });
  it('shows Hue Shift in degrees and stores turns', () => {
    const initial = useTimelineStore.getState();
    const hue: Effect = { id: 'units-hue', type: 'hue-shift', name: 'Hue Shift', enabled: true, params: { shift: 0.25 } };
    useTimelineStore.setState({ clips: [createMockClip({ id: 'clip:hue', trackId: 't', duration: 4, effects: [hue] })],
      tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
    try {
      const numeric = vi.spyOn(useTimelineStore.getState(), 'setPropertyValue').mockImplementation(() => {});
      render(<EffectsTab clipId="clip:hue" effects={[hue]} />);
      expect(screen.getByLabelText('Shift')).toHaveTextContent('90°');
      expect(screen.getByLabelText('Shift slider')).toHaveAttribute('aria-valuemax', '360');
      // One keyboard step is one degree: 91° is stored as 91/360 of a turn.
      fireEvent.keyDown(screen.getByLabelText('Shift slider'), { key: 'ArrowRight' });
      expect(numeric).toHaveBeenCalledTimes(1);
      expect(numeric.mock.calls[0][1]).toBe('effect.units-hue.shift');
      expect(numeric.mock.calls[0][2]).toBeCloseTo(91 / 360, 10);
    } finally { useTimelineStore.setState(initial); }
  });

  it('says when a value at the playhead is clamped for rendering', () => {
    const effect: Effect = { id: 'overshoot', type: 'saturation', name: 'Saturation', enabled: true, params: { amount: -0.4 } };
    const view = render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Amount -0.4 is below the rendered range (0 to 10) and renders as 0.');
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, params: { amount: 2 } }]} />);
    expect(screen.queryByText(/rendered range/)).toBeNull();
  });
});
