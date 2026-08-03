import { describe, expect, it } from 'vitest';
import {
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
