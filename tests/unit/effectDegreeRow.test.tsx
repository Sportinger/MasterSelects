// Twirl stores its Twist in radians (projects, keyframes, tools); the inspector reads and edits degrees.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { getEffect } from '../../src/effects';
import { useTimelineStore } from '../../src/stores/timeline';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { Effect } from '../../src/types/effects';

vi.mock('../../src/components/panels/properties/LabeledValue', () => ({
  LabeledValue: ({ value, suffix, ariaLabel, min, max, onChange }: { value: number; suffix?: string; ariaLabel: string; min?: number; max?: number; onChange: (value: number) => void }) =>
    <input aria-label={ariaLabel} data-suffix={suffix} data-min={String(min)} data-max={String(max)} value={String(value)} onChange={event => onChange(Number(event.target.value))} />,
}));
const initialTimeline = useTimelineStore.getState();
afterEach(() => { cleanup(); localStorage.clear(); useTimelineStore.setState(initialTimeline); });

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
  it('lets Hue Shift take any typed angle: −20° stays −20° in both the plain and the drivable row (Shift wraps)', () => {
    const definition = getEffect('hue-shift')!.params.shift, changed = vi.fn();
    render(<ResolveEffectParamRow paramName="shift" definition={definition} value={0} effect={{ id: 'hue-1', params: { shift: 0 } }} onChange={changed} />);
    const plain = screen.getByRole('textbox', { name: 'Shift' }) as HTMLInputElement;
    // No number limit at all: the field gets no min/max (not ±Infinity, which leaks into ARIA and the range popover).
    expect([plain.dataset.min, plain.dataset.max]).toEqual(['undefined', 'undefined']);
    expect(Number(screen.getByRole('slider', { name: 'Shift slider' }).getAttribute('aria-valuemin'))).toBeCloseTo(-180, 6);
    fireEvent.change(plain, { target: { value: '-20' } });
    expect(changed).toHaveBeenLastCalledWith({ shift: expect.closeTo(-1 / 18, 12) });
    cleanup();
    const effect = { id: 'hue-1', name: 'Hue Shift', type: 'hue-shift', enabled: true, params: { shift: 0 } } as Effect;
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect] });
    const setPropertyValue = vi.fn();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map(), playheadPosition: clip.startTime, setPropertyValue });
    render(<ResolveEffectParamRow paramName="shift" definition={definition} value={0} effect={{ id: 'hue-1', params: { shift: 0 } }} clipId="clip-1" onChange={vi.fn()} />);
    const sourced = screen.getByRole('textbox', { name: 'Shift' }) as HTMLInputElement;
    expect([sourced.dataset.min, sourced.dataset.max]).toEqual(['undefined', 'undefined']);
    fireEvent.change(sourced, { target: { value: '-20' } });
    expect(setPropertyValue).toHaveBeenLastCalledWith('clip-1', 'effect.hue-1.shift', expect.closeTo(-1 / 18, 12));
    fireEvent.change(sourced, { target: { value: '765' } });
    expect(setPropertyValue).toHaveBeenLastCalledWith('clip-1', 'effect.hue-1.shift', expect.closeTo(765 / 360, 12));
  });

  it('puts a saved Hue Shift of 240° at −120° on the slider and keeps whole turns when it moves (plain and drivable row)', () => {
    const definition = getEffect('hue-shift')!.params.shift, changed = vi.fn(), saved = 240 / 360;
    render(<ResolveEffectParamRow paramName="shift" definition={definition} value={saved} effect={{ id: 'hue-1', params: { shift: saved } }} onChange={changed} />);
    const slider = screen.getByRole('slider', { name: 'Shift slider' });
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(-120, 6);
    expect(Number((screen.getByRole('textbox', { name: 'Shift' }) as HTMLInputElement).value)).toBeCloseTo(240, 6);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(changed).toHaveBeenLastCalledWith({ shift: expect.closeTo(241 / 360, 9) });
    cleanup();
    // 2.125 turns (765°) sits at 45°; a step left stores 764°, not a jump onto the slider range.
    const effect = { id: 'hue-1', name: 'Hue Shift', type: 'hue-shift', enabled: true, params: { shift: 2.125 } } as Effect;
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect] });
    const setPropertyValue = vi.fn();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map(), playheadPosition: clip.startTime, setPropertyValue });
    render(<ResolveEffectParamRow paramName="shift" definition={definition} value={2.125} effect={{ id: 'hue-1', params: { shift: 2.125 } }} clipId="clip-1" onChange={vi.fn()} />);
    const sourced = screen.getByRole('slider', { name: 'Shift slider' });
    expect(Number(sourced.getAttribute('aria-valuenow'))).toBeCloseTo(45, 6);
    fireEvent.keyDown(sourced, { key: 'ArrowLeft' });
    expect(setPropertyValue).toHaveBeenLastCalledWith('clip-1', 'effect.hue-1.shift', expect.closeTo(764 / 360, 9));
  });

  it('keeps degrees when Twist can take a node source', () => {
    const operatorGraph = createDefaultUvDistortGraph('twirl');
    operatorGraph.nodes.find(node => node.id === 'twirl-amount')!.exposed = { label: 'Twist', min: -4 * Math.PI, max: 4 * Math.PI, step: .01 };
    const effect = { id: 'twirl-1', name: 'Twirl', type: 'twirl', enabled: true, params: { amount: Math.PI / 2, radius: .5 }, operatorGraph } as Effect;
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect] });
    const setPropertyValue = vi.fn();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map(), playheadPosition: clip.startTime, setPropertyValue });
    render(<ResolveEffectParamRow paramName="amount" definition={getEffect('twirl')!.params.amount} value={Math.PI / 2}
      effect={{ id: 'twirl-1', params: { amount: Math.PI / 2, radius: .5 } }} clipId="clip-1" onChange={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Twist' }) as HTMLInputElement;
    expect(screen.getByRole('button', { name: /· Source/ })).toBeTruthy();
    expect(Number(field.value)).toBeCloseTo(90, 9);
    expect(field.dataset.suffix).toBe('°');
    fireEvent.change(field, { target: { value: '180' } });
    expect(setPropertyValue).toHaveBeenLastCalledWith('clip-1', 'effect.twirl-1.amount', expect.closeTo(Math.PI, 12));
  });
});
