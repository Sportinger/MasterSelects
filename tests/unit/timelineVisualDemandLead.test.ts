import { describe, expect, it } from 'vitest';
import { getPlaybackVisualDemandLeadMs } from '../../src/services/timeline/timelineVisualDemand';
import { isPlaybackGapNearVisualDemand } from '../../src/services/render/playbackGapCadence';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const tracks = [
  { id: 'v1', type: 'video', visible: true },
  { id: 'v2', type: 'video', visible: false },
  { id: 'a1', type: 'audio', visible: true },
] as TimelineTrack[];
const clip = (id: string, trackId: string, startTime: number, duration: number) =>
  ({ id, trackId, startTime, duration }) as TimelineClip;
// Clip, 3 s gap, clip; an audio clip and a clip on a hidden track lie inside the gap.
const clips = [
  clip('a', 'v1', 0, 2),
  clip('b', 'v1', 5, 2),
  clip('hidden', 'v2', 3, 1),
  clip('audio', 'a1', 2.5, 4),
];

describe('getPlaybackVisualDemandLeadMs', () => {
  it('measures the wall-clock time to the next visible clip in the playback direction', () => {
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 2.5, 1)).toBeCloseTo(2500);
    // Faster playback reaches it sooner.
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 2.5, 4)).toBeCloseTo(625);
    // Reverse playback enters the previous clip at its end.
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 2.5, -1)).toBeCloseTo(500);
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 4.5, -2)).toBeCloseTo(1250);
  });

  it('is 0 on a visible clip and Infinity when no visible clip lies ahead', () => {
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 1, 1)).toBe(0);
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 8, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(getPlaybackVisualDemandLeadMs([clip('audio', 'a1', 0, 10)], tracks, 1, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(getPlaybackVisualDemandLeadMs(clips, tracks, 8, -1)).toBeCloseTo(1000);
  });

  it('feeds the gap cadence: display rate within 2 s of the clip, otherwise the slow rate', () => {
    expect(isPlaybackGapNearVisualDemand(getPlaybackVisualDemandLeadMs(clips, tracks, 3.2, 1))).toBe(true);
    expect(isPlaybackGapNearVisualDemand(getPlaybackVisualDemandLeadMs(clips, tracks, 2.5, 1))).toBe(false);
    expect(isPlaybackGapNearVisualDemand(getPlaybackVisualDemandLeadMs(clips, tracks, 8, 1))).toBe(false);
    expect(isPlaybackGapNearVisualDemand(Number.NaN)).toBe(true);
  });
});
