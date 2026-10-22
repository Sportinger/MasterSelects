// AI Edge Fill's card: Generate (Resolution, Prompt, Fill) and Blend (Fill Opacity, Seam Blend) sections,
// the reason a fill cannot be generated, and no focus ring left by a pointer click.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiEdgeFillControls from '../../src/effects/distort/ai-edge-fill/AiEdgeFillControls';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimeline = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initialTimeline); });

describe('AI Edge Fill controls', () => {
  it('shows the Generate and Blend sections and says why a video clip cannot be filled', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type: 'video' } as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    const onChange = vi.fn();
    render(<AiEdgeFillControls effectId="ai-edge-fill" params={{ resolution: '2K', mix: 100, seamBlend: 12 }} onChange={onChange} clipId="clip-1" effectInstanceId="fill-1" />);
    expect(screen.getByText('Generate')).toBeTruthy();
    expect(screen.getByText('Blend')).toBeTruthy();
    expect(screen.getByText('Resolution')).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Generate fill' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Still images only/);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI fill scene text' }), { target: { value: 'this opera stage' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scene: 'this opera stage', seamBlend: 12 }));
    fireEvent.click(screen.getByRole('combobox', { name: 'AI fill scene' }));
    fireEvent.click(screen.getByRole('option', { name: 'Stage' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scene: 'this theatre stage, its floor, black masking and lighting rig' }));
  });
  it('keeps a full prompt saved by an earlier version until the user goes back to the scene text', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type: 'video' } as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    const onChange = vi.fn();
    render(<AiEdgeFillControls effectId="ai-edge-fill" params={{ prompt: 'Continue the rehearsal room with mirrors.' }} onChange={onChange} clipId="clip-1" effectInstanceId="fill-1" />);
    expect((screen.getByRole('textbox', { name: 'AI fill prompt' }) as HTMLTextAreaElement).value).toBe('Continue the rehearsal room with mirrors.');
    expect(screen.queryByRole('textbox', { name: 'AI fill scene text' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use scene text' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: '' }));
  });
  it('drops pointer focus from its buttons', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type: 'video' } as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    render(<AiEdgeFillControls effectId="ai-edge-fill" params={{ artifactId: 'saved' }} onChange={() => {}} clipId="clip-1" effectInstanceId="fill-1" />);
    const clear = screen.getByRole('button', { name: 'Clear fill' });
    clear.focus();
    fireEvent.pointerUp(clear);
    expect(document.activeElement).not.toBe(clear);
  });
});
