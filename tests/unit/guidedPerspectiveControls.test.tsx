// The Edit guides button only works on still photos; on other clips the inspector says why.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('switches Framing to Fill frame, warns when no fill is possible and resets drawn guides with the row arrow', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type: 'image' } as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    const guides = JSON.stringify([{ axis: 'vertical', x1: .3, y1: .1, x2: .2, y2: .9 }, { axis: 'vertical', x1: .7, y1: .1, x2: .8, y2: .9 }]);
    const onChange = vi.fn();
    const { rerender } = render(<GuidedPerspectiveControls params={{ guides, matrix7: -.3, strength: 100, scale: 100 }}
      onChange={onChange} clipId="clip-1" effectInstanceId="gp-1" />);
    expect(screen.getByText(/2 vertical guides applied/)).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Guided Perspective framing' }));
    fireEvent.click(screen.getByRole('option', { name: 'Fill frame' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fillFrame: true, guides }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset guides' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ guides: '[]', matrix7: 0, matrix8: 1, strength: 100 }));
    // The 20x limit is named once, by the card's shared warning notice (paramWarnings), not again in this card.
    rerender(<GuidedPerspectiveControls params={{ guides, matrix2: .8, fillFrame: true }} onChange={onChange} clipId="clip-1" effectInstanceId="gp-1" />);
    expect(screen.queryByText(/Fill Frame would have to enlarge/)).toBeNull();
    // Applied guides need no lens reminder.
    expect(screen.queryByText(/Lens Correction/)).toBeNull();
    rerender(<GuidedPerspectiveControls params={{}} onChange={onChange} clipId="clip-1" effectInstanceId="gp-1" />);
    expect((screen.getByRole('button', { name: 'Reset guides' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No guides yet.*put Lens Correction before this effect/)).toBeTruthy();
    // A correction without readable guides (a tool set the matrix) can still be cleared.
    rerender(<GuidedPerspectiveControls params={{ guides: 'not json', matrix7: -.3 }} onChange={onChange} clipId="clip-1" effectInstanceId="gp-1" />);
    expect(screen.getByText(/A correction is set without readable guides/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset guides' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ guides: '[]', matrix7: 0 }));
  });
  it('leaves out the lens reminder when a Lens Correction already comes before it', () => {
    const lens = { id: 'lens-1', type: 'lens-correction', name: 'Lens Correction', enabled: true, params: {} };
    const gp = { id: 'gp-1', type: 'guided-perspective', name: 'Guided Perspective', enabled: true, params: {} };
    const clip = createMockClip({ id: 'clip-1', trackId: 'track-1', source: { type: 'image' } as never, effects: [lens, gp] as never });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 'track-1' })], clipKeyframes: new Map() });
    render(<GuidedPerspectiveControls params={{}} onChange={() => {}} clipId="clip-1" effectInstanceId="gp-1" />);
    expect(screen.getByText(/No guides yet/)).toBeTruthy();
    expect(screen.queryByText(/Lens Correction/)).toBeNull();
  });
});
