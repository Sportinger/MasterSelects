import { describe, expect, it, vi } from 'vitest';

import { applyMoveClipsOperation } from '../../src/stores/timeline/editOperations/moveOperations';
import { applyResolvedMoveOverlapTrims } from '../../src/stores/timeline/editOperations/moveOverlapTrim';
import { resolveClipMoveRequest } from '../../src/stores/timeline/editOperations/moveResolution';
import type { TimelineClip } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'video-1', type: 'video' }),
  createMockTrack({ id: 'audio-1', type: 'audio' }),
];

function resolveForcedMove(clips: TimelineClip[], requestedStartTime: number) {
  return resolveClipMoveRequest({
    id: `move:${requestedStartTime}`,
    clips,
    tracks,
    clipId: 'moving',
    requestedStartTime,
    getPositionWithResistance: vi.fn(() => ({
      startTime: requestedStartTime,
      forcingOverlap: true,
    })),
  });
}

function moveThenTrim(clips: TimelineClip[], requestedStartTime: number) {
  const resolution = resolveForcedMove(clips, requestedStartTime);
  const moved = applyMoveClipsOperation(resolution.operation, clips, tracks);
  return applyResolvedMoveOverlapTrims(moved.clips, resolution.resolvedMoves);
}

describe('resolved clip move overlap trim apply', () => {
  it('deletes clips fully covered by the moved clip', () => {
    const clips = [
      createMockClip({ id: 'moving', trackId: 'video-1', startTime: 0, duration: 4, inPoint: 0, outPoint: 4, source: { type: 'video' } }),
      createMockClip({ id: 'covered', trackId: 'video-1', startTime: 5, duration: 2, inPoint: 0, outPoint: 2, source: { type: 'video' } }),
    ];

    const result = moveThenTrim(clips, 4);

    expect(result.warnings).toEqual([]);
    expect(result.deletedClipIds).toEqual(['covered']);
    expect(result.changedClipIds).toEqual(['covered']);
    expect(result.clips.map(clip => clip.id)).toEqual(['moving']);
  });

  it('trims the start of a clip when the moved clip covers its beginning', () => {
    const clips = [
      createMockClip({ id: 'moving', trackId: 'video-1', startTime: 0, duration: 3, inPoint: 0, outPoint: 3, source: { type: 'video' } }),
      createMockClip({ id: 'tail', trackId: 'video-1', startTime: 5, duration: 4, inPoint: 10, outPoint: 14, source: { type: 'video' } }),
    ];

    const result = moveThenTrim(clips, 3);
    const trimmed = result.clips.find(clip => clip.id === 'tail');

    expect(trimmed).toMatchObject({
      startTime: 6,
      inPoint: 11,
      duration: 3,
      outPoint: 14,
    });
    expect(result.changedClipIds).toEqual(['tail']);
    expect(result.deletedClipIds).toEqual([]);
  });

  it('trims the end of a clip when the moved clip covers its ending', () => {
    const clips = [
      createMockClip({ id: 'moving', trackId: 'video-1', startTime: 0, duration: 3, inPoint: 0, outPoint: 3, source: { type: 'video' } }),
      createMockClip({ id: 'head', trackId: 'video-1', startTime: 4, duration: 4, inPoint: 10, outPoint: 14, source: { type: 'video' } }),
    ];

    const result = moveThenTrim(clips, 6);
    const trimmed = result.clips.find(clip => clip.id === 'head');

    expect(trimmed).toMatchObject({
      startTime: 4,
      inPoint: 10,
      duration: 2,
      outPoint: 12,
    });
    expect(result.changedClipIds).toEqual(['head']);
    expect(result.deletedClipIds).toEqual([]);
  });

  it('matches legacy middle-overlap behavior by trimming the old clip end', () => {
    const clips = [
      createMockClip({ id: 'moving', trackId: 'video-1', startTime: 0, duration: 1, inPoint: 0, outPoint: 1, source: { type: 'video' } }),
      createMockClip({ id: 'middle', trackId: 'video-1', startTime: 4, duration: 4, inPoint: 10, outPoint: 14, source: { type: 'video' } }),
    ];

    const result = moveThenTrim(clips, 5);
    const trimmed = result.clips.find(clip => clip.id === 'middle');

    expect(trimmed).toMatchObject({
      startTime: 4,
      inPoint: 10,
      duration: 1,
      outPoint: 11,
    });
    expect(result.changedClipIds).toEqual(['middle']);
  });

  it('propagates overlap trims to linked clips unless they are excluded by the resolver', () => {
    const clips = [
      createMockClip({ id: 'moving', trackId: 'video-1', startTime: 0, duration: 3, inPoint: 0, outPoint: 3, source: { type: 'video' } }),
      createMockClip({ id: 'linked-video', trackId: 'video-1', startTime: 5, duration: 4, inPoint: 10, outPoint: 14, linkedClipId: 'linked-audio', source: { type: 'video' } }),
      createMockClip({ id: 'linked-audio', trackId: 'audio-1', startTime: 5, duration: 4, inPoint: 10, outPoint: 14, linkedClipId: 'linked-video', source: { type: 'audio' } }),
    ];

    const includedResolution = resolveClipMoveRequest({
      id: 'move-linked-trim',
      clips,
      tracks,
      clipId: 'moving',
      requestedStartTime: 3,
      getPositionWithResistance: vi.fn(() => ({
        startTime: 3,
        forcingOverlap: true,
      })),
    });
    const includedMoved = applyMoveClipsOperation(includedResolution.operation, clips, tracks);
    const included = applyResolvedMoveOverlapTrims(includedMoved.clips, includedResolution.resolvedMoves);

    expect(included.clips.find(clip => clip.id === 'linked-video')).toMatchObject({
      startTime: 6,
      inPoint: 11,
      duration: 3,
    });
    expect(included.clips.find(clip => clip.id === 'linked-audio')).toMatchObject({
      startTime: 6,
      inPoint: 11,
      duration: 3,
    });
    expect(included.changedClipIds).toEqual(['linked-video', 'linked-audio']);

    const excludedResolution = resolveClipMoveRequest({
      id: 'move-linked-trim-excluded',
      clips,
      tracks,
      clipId: 'moving',
      requestedStartTime: 3,
      excludeClipIds: ['linked-audio'],
      getPositionWithResistance: vi.fn(() => ({
        startTime: 3,
        forcingOverlap: true,
      })),
    });
    const excludedMoved = applyMoveClipsOperation(excludedResolution.operation, clips, tracks);
    const excluded = applyResolvedMoveOverlapTrims(excludedMoved.clips, excludedResolution.resolvedMoves);

    expect(excluded.clips.find(clip => clip.id === 'linked-video')).toMatchObject({
      startTime: 6,
      inPoint: 11,
      duration: 3,
    });
    expect(excluded.clips.find(clip => clip.id === 'linked-audio')).toMatchObject({
      startTime: 5,
      inPoint: 10,
      duration: 4,
    });
    expect(excluded.changedClipIds).toEqual(['linked-video']);
  });
});
