import { afterEach, describe, expect, it } from 'vitest';

import {
  handleGetTimelineRangeSelection,
  handleGetTimelineState,
} from '../../src/services/aiTools/handlers/timeline';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

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

describe('getTimelineState occupancy', () => {
  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('returns canonical occupancy without changing existing summary fields', async () => {
    const track: TimelineTrack = {
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 70,
      muted: false,
      visible: true,
      solo: false,
    };
    useTimelineStore.setState({
      tracks: [track],
      clips: [
        createClip('clip-1', track.id, 1, 2),
        createClip('clip-2', track.id, 5, 3),
      ],
      duration: 12,
    });

    const result = await handleGetTimelineState({}, useTimelineStore.getState());
    const data = result.data as {
      duration: number;
      totalClips: number;
      occupancy: unknown;
      storyboard: { schemaVersion: number };
    };

    expect(result.success).toBe(true);
    expect(data.duration).toBe(12);
    expect(data.totalClips).toBe(2);
    expect(data.storyboard.schemaVersion).toBe(1);
    expect(data.occupancy).toEqual({
      stateRevision: expect.any(Number),
      occupied: {
        startSeconds: 1,
        endSeconds: 8,
        spanSeconds: 7,
      },
      clipDurationSumSeconds: 5,
      gapCount: 1,
      overlapCount: 0,
      perTrack: [{
        trackId: track.id,
        occupied: {
          startSeconds: 1,
          endSeconds: 8,
          spanSeconds: 7,
        },
        clipCount: 2,
      }],
    });
  });

  it('serializes the exact painted time and track range', async () => {
    useTimelineStore.setState({
      timelineRangeSelection: {
        startTime: 3.25,
        endTime: 8.5,
        trackIds: ['video-1', 'audio-1'],
        anchorTrackId: 'video-1',
      },
    });

    const result = await handleGetTimelineState({}, useTimelineStore.getState());

    expect(result.data).toMatchObject({
      timelineRangeSelection: {
        startTime: 3.25,
        endTime: 8.5,
        trackIds: ['video-1', 'audio-1'],
        anchorTrackId: 'video-1',
      },
    });
    await expect(
      handleGetTimelineRangeSelection({}, useTimelineStore.getState()),
    ).resolves.toEqual({
      success: true,
      data: {
        selection: {
          startTime: 3.25,
          endTime: 8.5,
          trackIds: ['video-1', 'audio-1'],
          anchorTrackId: 'video-1',
        },
      },
    });
  });
});
