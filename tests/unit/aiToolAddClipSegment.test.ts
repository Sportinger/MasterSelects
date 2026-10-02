import { describe, expect, it } from 'vitest';
import {
  findOverlappingClip,
  handleAddClipSegment,
  insertedClipAlreadyMatchesRequestedSegment,
  resolveAddClipSegmentTrackId,
} from '../../src/services/aiTools/handlers/clips/addSegment';

describe('addClipSegment preflight', () => {
  it('rejects sub-frame ranges before creating any media clips', async () => {
    await expect(handleAddClipSegment({
      mediaFileId: 'unused',
      trackId: 'unused',
      startTime: 0,
      inPoint: 1,
      outPoint: 1.02,
    })).resolves.toEqual({
      success: false,
      error: 'Clip segment duration must be at least 0.04s',
    });
  });

  it('treats an inserted still that already has the requested range as complete', () => {
    expect(insertedClipAlreadyMatchesRequestedSegment(
      { inPoint: 0, outPoint: 60 },
      0,
      60,
    )).toBe(true);
    expect(insertedClipAlreadyMatchesRequestedSegment(
      { inPoint: 0, outPoint: 10 },
      2,
      10,
    )).toBe(false);
  });

  it('binds a null track id to the first compatible active-composition track', () => {
    const tracks = [
      { id: 'audio-1', type: 'audio' },
      { id: 'video-1', type: 'video' },
      { id: 'video-2', type: 'video' },
    ];
    expect(resolveAddClipSegmentTrackId(null, 'video', tracks)).toBe('video-1');
    expect(resolveAddClipSegmentTrackId(null, 'audio', tracks)).toBe('audio-1');
    expect(resolveAddClipSegmentTrackId('video-2', 'video', tracks)).toBe('video-2');
    expect(resolveAddClipSegmentTrackId('missing', 'video', tracks)).toBeUndefined();
  });
});

describe('addClipSegment track occupancy', () => {
  const clips = [{ id: 'wav', name: 'Piano.wav', trackId: 'audio-1', startTime: 0, duration: 100 }];

  it('finds a clip overlapping the requested range but not one that only touches it', () => {
    expect(findOverlappingClip(clips, 'audio-1', 50, 60)?.id).toBe('wav');
    expect(findOverlappingClip(clips, 'audio-1', 100, 160)).toBeUndefined();
    expect(findOverlappingClip(clips, 'audio-2', 0, 10)).toBeUndefined();
  });

  it('binds a null track id to the first compatible track that is free for the range', () => {
    const tracks = [{ id: 'audio-1', type: 'audio' }, { id: 'audio-2', type: 'audio' }];
    expect(resolveAddClipSegmentTrackId(null, 'audio', tracks, { clips, startTime: 0, endTime: 10 })).toBe('audio-2');
    expect(resolveAddClipSegmentTrackId(null, 'audio', tracks, { clips, startTime: 100, endTime: 110 })).toBe('audio-1');
  });
});
