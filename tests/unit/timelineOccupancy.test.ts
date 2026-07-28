import { describe, expect, it } from 'vitest';
import { computeTimelineOccupancy } from '../../src/services/timeline/timelineOccupancy';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

function createTrack(id: string, type: TimelineTrack['type'] = 'video'): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 80,
    muted: false,
    visible: true,
    solo: false,
  };
}

function createClip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
): TimelineClip {
  return {
    id,
    trackId,
    name: id,
    startTime,
    duration,
  } as TimelineClip;
}

describe('computeTimelineOccupancy', () => {
  it('computes occupancy for a single clip', () => {
    const snapshot = computeTimelineOccupancy(
      [createClip('clip-1', 'video-1', 2, 3)],
      [createTrack('video-1')],
    );

    expect(snapshot).toEqual({
      occupied: { startSeconds: 2, endSeconds: 5, spanSeconds: 3 },
      clipDurationSumSeconds: 3,
      perTrack: [{
        trackId: 'video-1',
        occupied: { startSeconds: 2, endSeconds: 5, spanSeconds: 3 },
        clipCount: 1,
        gaps: [],
        overlaps: [],
      }],
      gaps: [],
      overlaps: [],
      clipCount: 1,
    });
  });

  it('reports a gap between two clips', () => {
    const snapshot = computeTimelineOccupancy(
      [
        createClip('clip-2', 'video-1', 5, 3),
        createClip('clip-1', 'video-1', 0, 2),
      ],
      [createTrack('video-1')],
    );

    expect(snapshot.occupied).toEqual({ startSeconds: 0, endSeconds: 8, spanSeconds: 8 });
    expect(snapshot.clipDurationSumSeconds).toBe(5);
    expect(snapshot.gaps).toEqual([{ startSeconds: 2, endSeconds: 5 }]);
    expect(snapshot.perTrack[0].gaps).toEqual([{ startSeconds: 2, endSeconds: 5 }]);
    expect(snapshot.overlaps).toEqual([]);
  });

  it('reports overlapping clips on a video track', () => {
    const snapshot = computeTimelineOccupancy(
      [
        createClip('clip-1', 'video-1', 0, 5),
        createClip('clip-2', 'video-1', 3, 4),
      ],
      [createTrack('video-1')],
    );

    const overlap = [{ startSeconds: 3, endSeconds: 5 }];
    expect(snapshot.occupied).toEqual({ startSeconds: 0, endSeconds: 7, spanSeconds: 7 });
    expect(snapshot.clipDurationSumSeconds).toBe(9);
    expect(snapshot.perTrack[0].overlaps).toEqual(overlap);
    expect(snapshot.overlaps).toEqual(overlap);
  });

  it('does not report legal overlapping clips on a MIDI stack track', () => {
    const snapshot = computeTimelineOccupancy(
      [
        createClip('clip-1', 'midi-1', 0, 5),
        createClip('clip-2', 'midi-1', 3, 4),
      ],
      [createTrack('midi-1', 'midi')],
    );

    expect(snapshot.occupied).toEqual({ startSeconds: 0, endSeconds: 7, spanSeconds: 7 });
    expect(snapshot.clipDurationSumSeconds).toBe(9);
    expect(snapshot.perTrack[0].overlaps).toEqual([]);
    expect(snapshot.overlaps).toEqual([]);
  });

  it('collects clips with missing track IDs in an unassigned entry last', () => {
    const snapshot = computeTimelineOccupancy(
      [createClip('orphan', 'missing-track', 4, 2)],
      [createTrack('video-1'), createTrack('audio-1', 'audio')],
    );

    expect(snapshot.perTrack.map((track) => track.trackId)).toEqual([
      'video-1',
      'audio-1',
      'unassigned',
    ]);
    expect(snapshot.perTrack[2]).toEqual({
      trackId: 'unassigned',
      occupied: { startSeconds: 4, endSeconds: 6, spanSeconds: 2 },
      clipCount: 1,
      gaps: [],
      overlaps: [],
    });
  });

  it('returns empty occupancy for an empty timeline', () => {
    expect(computeTimelineOccupancy([], [])).toEqual({
      occupied: null,
      clipDurationSumSeconds: 0,
      perTrack: [],
      gaps: [],
      overlaps: [],
      clipCount: 0,
    });
  });

  it('keeps 20 contiguous segments gapless across the full occupied span', () => {
    const totalDuration = 224.792381;
    const segmentDuration = totalDuration / 20;
    const clips = Array.from({ length: 20 }, (_, index) =>
      createClip(
        `segment-${index + 1}`,
        'video-1',
        index * segmentDuration,
        segmentDuration,
      ));

    const snapshot = computeTimelineOccupancy(clips, [createTrack('video-1')]);

    expect(snapshot.occupied?.startSeconds).toBe(0);
    expect(snapshot.occupied?.endSeconds).toBeCloseTo(totalDuration, 10);
    expect(snapshot.occupied?.spanSeconds).toBeCloseTo(totalDuration, 10);
    expect(snapshot.clipDurationSumSeconds).toBeCloseTo(totalDuration, 10);
    expect(snapshot.clipDurationSumSeconds).toBeCloseTo(snapshot.occupied?.spanSeconds ?? 0, 10);
    expect(snapshot.clipCount).toBe(20);
    expect(snapshot.gaps).toEqual([]);
    expect(snapshot.overlaps).toEqual([]);
    expect(snapshot.perTrack[0].gaps).toEqual([]);
    expect(snapshot.perTrack[0].overlaps).toEqual([]);
  });
});
