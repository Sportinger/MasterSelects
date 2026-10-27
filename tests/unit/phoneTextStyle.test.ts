import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared setup stubs the font service; these cases need its real font table.
vi.mock('../../src/services/googleFontsService', async (importOriginal) => importOriginal());

import { normalizePhoneHex } from '../../src/components/mobileSkin/text/phoneControls';
import {
  DEFAULT_PHONE_TEXT_STYLE, nearestFontWeight, readPhoneTextStyle, toggledBoldWeight, writePhoneTextDraft,
} from '../../src/components/mobileSkin/text/phoneTextStyle';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const originalState = useTimelineStore.getState();

describe('phone text style', () => {
  const updateTextProperties = vi.fn((clipId: string, props: Partial<NonNullable<TimelineClip['textProperties']>>) => {
    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => (clip.id === clipId ? { ...clip, textProperties: { ...clip.textProperties!, ...props } } : clip)),
    }));
  });
  const setPropertyValue = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [createMockClip({
        id: 't', trackId: 'video-1', startTime: 1, duration: 4, source: { type: 'text' },
        textProperties: { text: 'Hi', fontSize: 72 } as TimelineClip['textProperties'],
      })],
      clipKeyframes: new Map(),
      playheadPosition: 2,
      updateTextProperties,
      setPropertyValue,
    });
  });
  afterEach(() => {
    useTimelineStore.setState({
      updateTextProperties: originalState.updateTextProperties, setPropertyValue: originalState.setPropertyValue,
      clips: [], clipKeyframes: new Map(),
    });
  });

  it('writes only what changed, and nothing when the draft equals the clip', () => {
    writePhoneTextDraft('t', 'Hi', DEFAULT_PHONE_TEXT_STYLE);
    expect(updateTextProperties).not.toHaveBeenCalled();
    writePhoneTextDraft('t', 'Hi', { ...DEFAULT_PHONE_TEXT_STYLE, color: '#ff0000', strokeEnabled: true, strokeWidth: 6 });
    expect(updateTextProperties).toHaveBeenCalledWith('t', { color: '#ff0000', strokeEnabled: true, strokeWidth: 6 });
  });

  it('sets an animated number through setPropertyValue (a key at the playhead) and samples it back', () => {
    useTimelineStore.setState({ clipKeyframes: new Map([['t', [
      { id: 'k1', clipId: 't', property: 'text.fontSize', time: 0, value: 40, easing: 'linear' },
      { id: 'k2', clipId: 't', property: 'text.fontSize', time: 2, value: 80, easing: 'linear' },
    ]]]) });
    const clip = useTimelineStore.getState().clips[0];
    expect(readPhoneTextStyle(clip, 1).fontSize).toBeCloseTo(60, 6);
    writePhoneTextDraft('t', 'Hi', { ...DEFAULT_PHONE_TEXT_STYLE, fontSize: 60 });
    expect(setPropertyValue).not.toHaveBeenCalled();
    writePhoneTextDraft('t', 'Hi', { ...DEFAULT_PHONE_TEXT_STYLE, fontSize: 90 });
    expect(setPropertyValue).toHaveBeenCalledWith('t', 'text.fontSize', 90);
    expect(updateTextProperties).not.toHaveBeenCalledWith('t', expect.objectContaining({ fontSize: expect.anything() }));
  });

  it('normalises hex colours and picks real font weights', () => {
    expect(normalizePhoneHex('#ABC')).toBe('#aabbcc');
    expect(normalizePhoneHex('ff8800')).toBe('#ff8800');
    expect(normalizePhoneHex('rgba(0,0,0,0.5)')).toBeNull();
    expect(nearestFontWeight('Anton', 700)).toBe(400);
    expect(toggledBoldWeight('Roboto', 400)).toBe(700);
    expect(toggledBoldWeight('Roboto', 700)).toBe(400);
    expect(toggledBoldWeight('Arial', 400), 'system fonts have a bold weight too').toBe(700);
  });
});
