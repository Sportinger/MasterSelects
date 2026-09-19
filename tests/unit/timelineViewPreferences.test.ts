import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_HEADER_WIDTH } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  readStoredTimelineSplitRatio,
  readStoredTimelineSnappingEnabled,
  readStoredTimelineTrackFocusMode,
  readStoredTimelineTrackHeaderWidth,
} from '../../src/stores/timeline/viewPreferences';

describe('timeline view preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useTimelineStore.setState({
      trackHeaderWidth: DEFAULT_TRACK_HEADER_WIDTH,
      timelineSplitRatio: null,
      audioFocusMode: false,
      trackFocusMode: 'balanced',
      snappingEnabled: false,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with snapping disabled when there is no saved preference', () => {
    expect(useTimelineStore.getInitialState().snappingEnabled).toBe(false);
  });

  it('preserves the user snapping choice across preference reads', () => {
    useTimelineStore.getState().toggleSnapping();
    expect(readStoredTimelineSnappingEnabled(false)).toBe(true);

    useTimelineStore.getState().toggleSnapping();
    expect(readStoredTimelineSnappingEnabled(true)).toBe(false);
  });

  it('persists the draggable timeline split position', () => {
    useTimelineStore.getState().setTimelineSplitRatio(0.37);

    expect(readStoredTimelineSplitRatio(null)).toBeCloseTo(0.37);

    useTimelineStore.getState().setTimelineSplitRatio(null);

    expect(readStoredTimelineSplitRatio(0.5)).toBeNull();
  });

  it('persists split focus mode changes', () => {
    useTimelineStore.getState().setTrackFocusMode('video');

    expect(readStoredTimelineTrackFocusMode('balanced')).toBe('video');

    useTimelineStore.getState().setAudioFocusMode(true);

    expect(readStoredTimelineTrackFocusMode('balanced')).toBe('audio');
  });

  it('persists the draggable track header divider width', () => {
    useTimelineStore.getState().setTrackHeaderWidth(260);

    expect(readStoredTimelineTrackHeaderWidth(DEFAULT_TRACK_HEADER_WIDTH, 160, 360)).toBe(260);
  });
});
