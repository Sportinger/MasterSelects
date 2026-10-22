// The Stick Figure card's own rows: action blocks are keyboard buttons (arrow keys move them, as a
// drag does), the pose name uses the shared inspector text field, and Contacts and Sound are rows of their own.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import StickFigureControls from '../../src/effects/generate/stickFigure/StickFigureControls';
import { parseSkeletonActions, serializeSkeletonActions } from '../../src/services/rig/skeletonActions';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

function figure() {
  const params = { ...getDefaultParams('stick-figure'),
    actions: serializeSkeletonActions([{ id: 'jump', action: 'jump', start: 1, duration: 1.1, bodyScaled: true }]) };
  const clip = createMockClip({ id: 'fig', startTime: 0, duration: 4, trackId: 'track-a',
    effects: [{ id: 'fig-fx', name: 'Stick Figure', type: 'stick-figure', enabled: true, params } as Effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-a' })], clipKeyframes: new Map() });
  return params as Record<string, number | boolean | string>;
}
const storedStart = () => parseSkeletonActions(useTimelineStore.getState().clips[0].effects[0].params.actions)[0].start;

describe('Stick Figure card', () => {
  it('moves a focused action block with the arrow keys, Shift for bigger steps', async () => {
    const params = figure();
    render(<StickFigureControls effectId="stick-figure" params={params} onChange={() => {}} clipId="fig" effectInstanceId="fig-fx" />);
    const block = await screen.findByRole('button', { name: /^Jump/ });
    fireEvent.keyDown(block, { key: 'ArrowRight' });
    expect(storedStart()).toBeCloseTo(1.05);
    fireEvent.keyDown(block, { key: 'ArrowLeft', shiftKey: true });
    expect(storedStart()).toBeCloseTo(0.55);
    expect(block.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the shared text field for the pose name and gives Contacts and Sound their own rows', async () => {
    const params = figure();
    render(<StickFigureControls effectId="stick-figure" params={params} onChange={() => {}} clipId="fig" effectInstanceId="fig-fx" />);
    expect(screen.getByLabelText('Pose name').className).toContain('resolve-inspector-text-input');
    expect(await screen.findByText('Contacts')).toBeTruthy();
    expect(screen.getByText('Sound')).toBeTruthy();
  });
});
