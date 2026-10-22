// Shared inspector rows: a switch row has a reset like number rows, the colour row takes a keyframe diamond
// and one extra action, and a node-drivable number row shows its source line only when it says something,
// while its quiet source icon always opens the Source menu.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveEffectParamRow } from '../../src/components/panels/properties/ResolveEffectParamRow';
import { ResolveInspectorColorRow } from '../../src/components/panels/properties/resolveInspector/ResolveInspectorColorRow';
import { getEffect } from '../../src/effects';
import type { EffectParam } from '../../src/effects/types';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

describe('shared inspector rows', () => {
  it('a switch row resets to its default with the reset button and blurs it after a pointer click', () => {
    const definition: EffectParam = { type: 'boolean', label: 'Vignette Correction', default: true };
    const onChange = vi.fn(), onParamCommit = vi.fn();
    render(<ResolveEffectParamRow paramName="vignetteEnabled" definition={definition} value={false}
      effect={{ id: 'fx', params: { vignetteEnabled: false, amount: 1 } }} onChange={onChange} onParamCommit={onParamCommit} />);
    const reset = screen.getByRole('button', { name: 'Reset Vignette Correction' });
    reset.focus();
    fireEvent.click(reset, { detail: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ vignetteEnabled: true, amount: 1 });
    expect(onParamCommit).toHaveBeenLastCalledWith('vignetteEnabled', 'checkbox', 'reset');
    expect(document.activeElement).not.toBe(reset);
    // Keyboard activation (detail 0) keeps focus on the button for the next key.
    reset.focus();
    fireEvent.click(reset, { detail: 0 });
    expect(document.activeElement).toBe(reset);
  });

  it('the colour row places a keyframe diamond and an extra action like a number row', () => {
    const { container } = render(<ResolveInspectorColorRow label="Color" value="#ff0000" defaultValue="#ffffff" onChange={vi.fn()}
      keyframeToggle={<button type="button" className="keyframe-toggle" aria-label="Keyframe Color">◇</button>}
      actions={<button type="button" aria-label="Remove Color">×</button>} />);
    const actions = [...container.querySelectorAll('.resolve-inspector-row-actions > *')].map(item => item.getAttribute('aria-label'));
    expect(actions).toEqual(['Remove Color', 'Keyframe Color', 'Reset Color']);
    expect(container.querySelector('.resolve-inspector-row--extra-action')).toBeTruthy();
    cleanup();
    // Without them it stays the plain colour row.
    const plain = render(<ResolveInspectorColorRow label="Color" value="#ff0000" defaultValue="#ffffff" onChange={vi.fn()} />).container;
    expect([...plain.querySelectorAll('.resolve-inspector-row-actions > *')].map(item => item.getAttribute('aria-label'))).toEqual(['Reset Color']);
    expect(plain.querySelector('.resolve-inspector-row--extra-action')).toBeNull();
  });

  it('a node-drivable row shows "Fixed · Source" only when its value is fixed against its keys, not when nothing drives it', () => {
    const operatorGraph = createDefaultUvDistortGraph('twirl');
    operatorGraph.nodes.find(node => node.id === 'twirl-amount')!.exposed = { label: 'Twist', min: -4 * Math.PI, max: 4 * Math.PI, step: .01 };
    const effect = { id: 'twirl-1', name: 'Twirl', type: 'twirl', enabled: true, params: { amount: 1, radius: .5 }, operatorGraph } as Effect;
    const show = (clip = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect] })) => {
      useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map(), playheadPosition: clip.startTime });
      return render(<ResolveEffectParamRow paramName="amount" definition={getEffect('twirl')!.params.amount} value={1}
        effect={{ id: 'twirl-1', params: { amount: 1, radius: .5 } }} clipId="clip-1" onChange={vi.fn()} />);
    };
    show();
    expect(screen.getByRole('slider', { name: 'Twist' }).closest('.parameter-source-control')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /· Source/ })).toBeNull();
    cleanup();
    const fixed = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect], nodeGraph: { parameterSources: {
      version: 1, clipTimeOffset: 0, graph: { version: 1, schemaVersion: 1, domain: 'control', nodes: [], edges: [] },
      targets: { 'effect.twirl-1.amount': { enabled: false, localMode: 'constant' } } } } as never });
    show(fixed);
    expect(screen.getByRole('button', { name: 'Fixed · Source' })).toBeTruthy();
  });

  it('an undriven row still reaches the Source menu through its quiet source icon: Fixed and New Oscillator (LFO)', () => {
    const operatorGraph = createDefaultUvDistortGraph('twirl');
    operatorGraph.nodes.find(node => node.id === 'twirl-amount')!.exposed = { label: 'Twist', min: -4 * Math.PI, max: 4 * Math.PI, step: .01 };
    const effect = { id: 'twirl-1', name: 'Twirl', type: 'twirl', enabled: true, params: { amount: 1, radius: .5 }, operatorGraph } as Effect;
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', effects: [effect] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map(), playheadPosition: clip.startTime });
    const { container } = render(<ResolveEffectParamRow paramName="amount" definition={getEffect('twirl')!.params.amount} value={1}
      effect={{ id: 'twirl-1', params: { amount: 1, radius: .5 } }} clipId="clip-1" onChange={vi.fn()} />);
    const icon = screen.getByRole('button', { name: 'Source of Twist' });
    // It sits in the action column before the keyframe diamond and the reset, like any extra action.
    expect(icon.parentElement?.classList.contains('resolve-inspector-row-actions')).toBe(true);
    expect(icon.closest('.resolve-inspector-row--extra-action')).toBeTruthy();
    expect(icon.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(icon);
    expect(icon.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('combobox', { name: 'Twist source' }));
    const options = screen.getAllByRole('option').map(option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['Fixed (keep keys)', 'New Oscillator', 'New Value', 'New Keyframes']));
    fireEvent.click(screen.getByRole('option', { name: 'Fixed (keep keys)' }));
    const target = useTimelineStore.getState().clips[0].nodeGraph?.parameterSources?.targets['effect.twirl-1.amount'];
    expect(target?.localMode).toBe('constant');
    // Fixed now shows as the source line, and the icon is lit.
    expect(screen.getByRole('button', { name: 'Fixed · Source' })).toBeTruthy();
    expect(icon.classList.contains('transform-node-source-button')).toBe(true);
    expect(container.querySelectorAll('.parameter-source-error')).toHaveLength(0);
  });
});
