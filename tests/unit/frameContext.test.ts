import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const hoisted = vi.hoisted(() => ({
  timelineState: null as unknown,
  mediaState: {
    files: [],
    compositions: [],
    activeCompositionId: null,
    proxyEnabled: false,
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => hoisted.timelineState,
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => hoisted.mediaState,
  },
}));

import { createFrameContext, getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';

function createTimelineState(overrides: Record<string, unknown> = {}) {
  return {
    clips: [],
    tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
    isPlaying: false,
    isDraggingPlayhead: false,
    playheadPosition: 0,
    playbackSpeed: 1,
    getInterpolatedTransform: vi.fn(),
    getInterpolatedEffects: vi.fn(() => []),
    getInterpolatedSpeed: vi.fn(() => 1),
    getSourceTimeForClip: vi.fn((_clipId: string, localTime: number) => localTime),
    hasKeyframes: vi.fn(() => false),
    ...overrides,
  };
}

describe('FrameContext clipsAtTime', () => {
  beforeEach(() => {
    playheadState.isUsingInternalPosition = false;
    playheadState.position = 0;
    hoisted.timelineState = createTimelineState();
  });

  it('prefers the incoming clip at an exact cut boundary', () => {
    const clipA = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
    });
    const clipB = createMockClip({
      id: 'clip-b',
      trackId: 'video-1',
      startTime: 10,
      duration: 10,
      inPoint: 10,
      outPoint: 20,
    });

    hoisted.timelineState = createTimelineState({
      clips: [clipA, clipB],
      playheadPosition: 10,
    });

    const ctx = createFrameContext();

    expect(ctx.clipsAtTime.map(clip => clip.id)).toEqual(['clip-b']);
  });

  it('keeps both clips active during a real overlap', () => {
    const outgoingClip = createMockClip({
      id: 'clip-out',
      trackId: 'video-1',
      startTime: 0,
      duration: 10.5,
      inPoint: 0,
      outPoint: 10.5,
    });
    const incomingClip = createMockClip({
      id: 'clip-in',
      trackId: 'video-1',
      startTime: 10,
      duration: 10,
      inPoint: 10,
      outPoint: 20,
    });

    hoisted.timelineState = createTimelineState({
      clips: [outgoingClip, incomingClip],
      playheadPosition: 10.25,
    });

    const ctx = createFrameContext();

    expect(ctx.clipsAtTime.map(clip => clip.id)).toEqual(['clip-out', 'clip-in']);
  });

  it('avoids an empty frame when the incoming clip starts a tiny fraction late', () => {
    const clipA = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
    });
    const clipB = createMockClip({
      id: 'clip-b',
      trackId: 'video-1',
      startTime: 10.0000005,
      duration: 10,
      inPoint: 10,
      outPoint: 20,
    });

    hoisted.timelineState = createTimelineState({
      clips: [clipA, clipB],
      playheadPosition: 10,
    });

    const ctx = createFrameContext();

    expect(ctx.clipsAtTime.map(clip => clip.id)).toEqual(['clip-b']);
  });

  it('falls back to the last internal playhead when stored playhead is invalid', () => {
    const clipA = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
    });
    const clipB = createMockClip({
      id: 'clip-b',
      trackId: 'video-1',
      startTime: 10,
      duration: 10,
      inPoint: 10,
      outPoint: 20,
    });

    playheadState.position = 12;
    hoisted.timelineState = createTimelineState({
      clips: [clipA, clipB],
      playheadPosition: null,
    });

    const ctx = createFrameContext();

    expect(ctx.playheadPosition).toBe(12);
    expect(ctx.clipsAtTime.map(clip => clip.id)).toEqual(['clip-b']);
  });

  it('uses clip drag preview patches when resolving active clips', () => {
    const clip = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 20,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    });

    hoisted.timelineState = createTimelineState({
      clips: [clip],
      playheadPosition: 10,
      clipDragPreview: {
        patches: {
          'clip-a': { startTime: 8 },
        },
      },
    });

    const ctx = createFrameContext();

    expect(ctx.clipsAtTime.map(activeClip => activeClip.id)).toEqual(['clip-a']);
    expect(ctx.clipsAtTime[0].startTime).toBe(8);
    expect(clip.startTime).toBe(20);
  });

  it('removes an originally active clip when drag preview moves it away from the playhead', () => {
    const clip = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 8,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    });

    hoisted.timelineState = createTimelineState({
      clips: [clip],
      playheadPosition: 10,
      clipDragPreview: {
        patches: {
          'clip-a': { startTime: 20 },
        },
      },
    });

    const ctx = createFrameContext();

    expect(ctx.clipsAtTime).toEqual([]);
    expect(clip.startTime).toBe(8);
  });

  it('recomputes clip time when a drag preview changes clip start at the same playhead frame', () => {
    const clip = createMockClip({
      id: 'clip-a',
      trackId: 'video-1',
      startTime: 8,
      duration: 20,
      inPoint: 0,
      outPoint: 20,
    });

    hoisted.timelineState = createTimelineState({
      clips: [clip],
      playheadPosition: 10,
    });

    const initialCtx = createFrameContext();
    expect(getClipTimeInfo(initialCtx, initialCtx.clipsAtTime[0]).clipLocalTime).toBe(2);

    hoisted.timelineState = createTimelineState({
      clips: [clip],
      playheadPosition: 10,
      clipDragPreview: {
        patches: {
          'clip-a': { startTime: 6 },
        },
      },
    });

    const dragCtx = createFrameContext();
    const dragTime = getClipTimeInfo(dragCtx, dragCtx.clipsAtTime[0]);

    expect(dragTime.clipLocalTime).toBe(4);
    expect(dragTime.clipTime).toBe(4);
  });
});
