import { describe, expect, it } from 'vitest';

import { resolveLinkedAudioTrackId } from '../../src/stores/timeline/clip/linkedAudioPlacement';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('linked audio placement', () => {
  const tracks = [
    createMockTrack({ id: 'video-1', type: 'video' }),
    createMockTrack({ id: 'audio-1', type: 'audio' }),
    createMockTrack({ id: 'audio-2', type: 'audio' }),
  ];

  it('honors the explicitly dropped audio lane', () => {
    expect(resolveLinkedAudioTrackId(
      tracks,
      [],
      4,
      3,
      'audio-2',
    )).toEqual({
      trackId: 'audio-2',
      requestedTrackRejected: false,
    });
  });

  it('rejects an occupied explicit lane instead of silently rerouting', () => {
    const clips = [
      createMockClip({ trackId: 'audio-2', startTime: 3, duration: 5 }),
    ];

    expect(resolveLinkedAudioTrackId(
      tracks,
      clips,
      4,
      3,
      'audio-2',
    )).toEqual({
      trackId: null,
      requestedTrackRejected: true,
    });
  });

  it('retains first-free audio placement without an explicit lane', () => {
    const clips = [
      createMockClip({ trackId: 'audio-1', startTime: 3, duration: 5 }),
    ];

    expect(resolveLinkedAudioTrackId(tracks, clips, 4, 3)).toEqual({
      trackId: 'audio-2',
      requestedTrackRejected: false,
    });
  });

  it('rejects the linked pair atomically when the requested video lane overlaps', () => {
    const clips = [
      createMockClip({ trackId: 'video-1', startTime: 3, duration: 5 }),
    ];

    expect(resolveLinkedAudioTrackId(
      tracks,
      clips,
      4,
      3,
      'audio-1',
      'video-1',
    )).toEqual({
      trackId: null,
      requestedTrackRejected: true,
    });
  });
});
