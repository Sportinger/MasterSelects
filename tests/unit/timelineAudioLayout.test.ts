import { describe, expect, it } from 'vitest';
import { getTimelineTrackBaseHeight } from '../../src/components/timeline/utils/timelineAudioLayout';
import type { TimelineTrack } from '../../src/types';

function track(type: TimelineTrack['type'], height: number): Pick<TimelineTrack, 'type' | 'height'> {
  return { type, height };
}

describe('timeline audio layout', () => {
  it('keeps video track base heights unchanged across audio display modes', () => {
    expect(getTimelineTrackBaseHeight(track('video', 54), 'compact')).toBe(54);
    expect(getTimelineTrackBaseHeight(track('video', 54), 'detailed')).toBe(54);
    expect(getTimelineTrackBaseHeight(track('video', 54), 'spectral')).toBe(54);
  });

  it('compacts video tracks while audio focus mode is active', () => {
    expect(getTimelineTrackBaseHeight(track('video', 60), 'detailed', true)).toBe(32);
    expect(getTimelineTrackBaseHeight(track('video', 24), 'spectral', true)).toBe(24);
  });

  it('keeps compact audio at the persisted user track height', () => {
    expect(getTimelineTrackBaseHeight(track('audio', 40), 'compact')).toBe(40);
    expect(getTimelineTrackBaseHeight(track('audio', 24), 'compact')).toBe(24);
  });

  it('derives larger timeline-first audio editor lanes without rewriting persisted heights', () => {
    const audioTrack = track('audio', 40);

    expect(getTimelineTrackBaseHeight(audioTrack, 'detailed')).toBe(72);
    expect(getTimelineTrackBaseHeight(audioTrack, 'spectral')).toBe(128);
    expect(audioTrack.height).toBe(40);
  });

  it('respects user-resized audio tracks when they are taller than the mode minimum', () => {
    expect(getTimelineTrackBaseHeight(track('audio', 96), 'detailed')).toBe(96);
    expect(getTimelineTrackBaseHeight(track('audio', 160), 'spectral')).toBe(160);
  });

  it('turns audio focus into large inline editor lanes without mutating persisted heights', () => {
    const audioTrack = track('audio', 40);

    expect(getTimelineTrackBaseHeight(audioTrack, 'compact', true)).toBe(96);
    expect(getTimelineTrackBaseHeight(audioTrack, 'detailed', true)).toBe(144);
    expect(getTimelineTrackBaseHeight(audioTrack, 'spectral', true)).toBe(180);
    expect(audioTrack.height).toBe(40);
  });

  it('keeps audio lane sizing stable when persisted heights are invalid', () => {
    expect(getTimelineTrackBaseHeight(track('audio', Number.NaN), 'compact')).toBe(0);
    expect(getTimelineTrackBaseHeight(track('audio', Number.NaN), 'detailed')).toBe(72);
    expect(getTimelineTrackBaseHeight(track('audio', -24), 'spectral')).toBe(128);
  });
});
