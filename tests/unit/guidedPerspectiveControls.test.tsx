// The Edit guides button only works on still photos; on other clips the inspector says why.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuidedPerspectiveControls } from '../../src/components/panels/properties/GuidedPerspectiveControls';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimeline = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initialTimeline); });

describe('Guided Perspective controls', () => {
  it.each([['video', true], ['image', false]] as const)('on a %s clip says whether guides can be drawn', (type, explained) => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type } as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    render(<GuidedPerspectiveControls params={{ strength: 100, scale: 100 }} onChange={() => {}} clipId="clip-1" effectInstanceId="gp-1" />);
    expect((screen.getByRole('button', { name: 'Edit guides' }) as HTMLButtonElement).disabled).toBe(explained);
    expect(screen.queryByText(/still photos \(image clips\) only/) !== null).toBe(explained);
  });
});
