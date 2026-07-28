import { describe, expect, it, vi } from 'vitest';

import type { ClipDragState } from '../../src/components/timeline/types';
import {
  collectDragExcludeClipIds,
  resolveClipDragGroupPlacement,
} from '../../src/components/timeline/utils/clipDragOperations';
import { buildClipDragPreview } from '../../src/components/timeline/utils/clipDragPreview';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'video-3', type: 'video' }),
  createMockTrack({ id: 'video-2', type: 'video' }),
  createMockTrack({ id: 'video-1', type: 'video' }),
];

function dragState(overrides: Partial<ClipDragState> = {}): ClipDragState {
  return {
    clipId: 'lead',
    originalStartTime: 1,
    originalTrackId: 'video-1',
    grabOffsetX: 0,
    grabY: 0,
    currentX: 0,
    currentTrackId: 'video-2',
    snappedTime: 4,
    snapIndicatorTime: null,
    isSnapping: false,
    trackChangeGuideTime: 1,
    newTrackType: null,
    altKeyPressed: false,
    forcingOverlap: false,
    dragStartTime: 0,
    multiSelectClipIds: ['follower'],
    multiSelectTimeDelta: 3,
    ...overrides,
  };
}

describe('clip drag group placement', () => {
  it('previews selected clips on relative destination tracks', () => {
    const lead = createMockClip({
      id: 'lead',
      trackId: 'video-1',
      startTime: 1,
      duration: 2,
      source: { type: 'video' },
    });
    const follower = createMockClip({
      id: 'follower',
      trackId: 'video-2',
      startTime: 4,
      duration: 2,
      source: { type: 'video' },
    });
    const preview = buildClipDragPreview(
      dragState(),
      new Map([[lead.id, lead], [follower.id, follower]]),
      tracks,
    );

    expect(preview?.patches).toMatchObject({
      lead: { startTime: 4, trackId: 'video-2' },
      follower: { startTime: 7, trackId: 'video-3' },
    });
  });

  it('checks follower resistance and overlap on relative destination tracks', () => {
    const lead = createMockClip({
      id: 'lead',
      trackId: 'video-1',
      startTime: 1,
      duration: 2,
      source: { type: 'video' },
    });
    const follower = createMockClip({
      id: 'follower',
      trackId: 'video-2',
      startTime: 4,
      duration: 2,
      source: { type: 'video' },
    });
    const obstacle = createMockClip({
      id: 'obstacle',
      trackId: 'video-3',
      startTime: 7,
      duration: 2,
      source: { type: 'video' },
    });
    const clipMap = new Map([
      [lead.id, lead],
      [follower.id, follower],
      [obstacle.id, obstacle],
    ]);
    const resistance = vi.fn((
      _clipId: string,
      startTime: number,
    ) => ({ startTime, forcingOverlap: false }));
    const excludeClipIds = collectDragExcludeClipIds(
      [lead.id, follower.id],
      clipMap,
    );

    const placement = resolveClipDragGroupPlacement(
      clipMap,
      tracks,
      dragState(),
      'video-2',
      3,
      false,
      excludeClipIds,
      resistance,
    );

    expect(resistance).toHaveBeenCalledWith(
      'follower',
      7,
      'video-3',
      2,
      undefined,
      excludeClipIds,
    );
    expect(placement.overlapClipIds).toContain('obstacle');
  });
});
