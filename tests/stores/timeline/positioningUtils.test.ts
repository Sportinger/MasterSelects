import { describe, expect, it } from 'vitest';
import { createMockClip } from '../../helpers/mockData';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('positioningUtils', () => {
  it('snaps video clip edges to audio clip edges across track types', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
    });
    const audioTarget = createMockClip({
      id: 'audio-target',
      trackId: 'audio-1',
      startTime: 10,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'audio', naturalDuration: 2 },
    });
    const store = createTestTimelineStore({ clips: [movingVideo, audioTarget] });

    const result = store.getState().getSnappedPosition('video-moving', 11.9, 'video-1');

    expect(result).toMatchObject({
      startTime: 12,
      snapped: true,
      snapEdgeTime: 12,
    });
  });

  it('does not use the linked audio partner as a cross-type snap target', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      linkedClipId: 'audio-linked',
    });
    const linkedAudio = createMockClip({
      id: 'audio-linked',
      trackId: 'audio-1',
      startTime: 5,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      linkedClipId: 'video-moving',
      source: { type: 'audio', naturalDuration: 4 },
    });
    const store = createTestTimelineStore({ clips: [movingVideo, linkedAudio] });

    const result = store.getState().getSnappedPosition('video-moving', 8.9, 'video-1');

    expect(result).toMatchObject({
      startTime: 8.9,
      snapped: false,
      snapEdgeTime: 0,
    });
  });

  it('snaps clip start and end to the playhead', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
    });
    const store = createTestTimelineStore({
      clips: [movingVideo],
      playheadPosition: 10,
    });

    expect(store.getState().getSnappedPosition('video-moving', 9.96, 'video-1')).toMatchObject({
      startTime: 10,
      snapped: true,
      snapEdgeTime: 10,
    });
    expect(store.getState().getSnappedPosition('video-moving', 7.04, 'video-1')).toMatchObject({
      startTime: 7,
      snapped: true,
      snapEdgeTime: 10,
    });
  });
});
