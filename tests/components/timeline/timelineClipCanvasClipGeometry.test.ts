import { describe, expect, it } from 'vitest';
import type { TimelinePaintSourceClip } from '../../../src/timeline';
import type { ClipDragState, ClipTrimState } from '../../../src/components/timeline/types';
import { resolveClipGeometry } from '../../../src/components/timeline/utils/timelineClipCanvasClipGeometry';

const clip = (overrides: Partial<TimelinePaintSourceClip>): TimelinePaintSourceClip => ({
  id: 'clip',
  trackId: 'track',
  startTime: 2,
  duration: 5,
  name: 'Clip',
  inPoint: 0,
  outPoint: 5,
  source: { type: 'video', naturalDuration: 10 },
  ...overrides,
});

const trim = (overrides: Partial<ClipTrimState>): ClipTrimState => ({
  clipId: 'video',
  edge: 'right',
  originalStartTime: 2,
  originalDuration: 5,
  originalInPoint: 0,
  originalOutPoint: 5,
  startX: 0,
  currentX: 0,
  altKey: false,
  snapIndicatorTime: null,
  isSnapping: false,
  appliedDelta: 1.5,
  ...overrides,
});

const drag = (overrides: Partial<ClipDragState>): ClipDragState => ({
  clipId: 'video',
  linkedClipId: 'audio',
  originalStartTime: 2,
  originalTrackId: 'video-track',
  grabOffsetX: 0,
  grabY: 0,
  currentX: 0,
  currentTrackId: 'video-track',
  snappedTime: 4,
  snapIndicatorTime: null,
  isSnapping: false,
  trackChangeGuideTime: null,
  altKeyPressed: false,
  forcingOverlap: false,
  dragStartTime: 0,
  ...overrides,
});

describe('timeline clip canvas trim geometry', () => {
  it('moves linked clips from the live drag state without waiting for preview patches', () => {
    const geometry = resolveClipGeometry(clip({
      id: 'audio',
      linkedClipId: 'video',
      startTime: 2,
      trackId: 'audio-track',
      source: { type: 'audio', naturalDuration: 10 },
    }), {
      trackId: 'audio-track',
      clipDrag: drag({ snappedTime: 4 }),
    });

    expect(geometry.startTime).toBe(4);
  });

  it('resizes linked clips during trim preview', () => {
    const geometry = resolveClipGeometry(clip({
      id: 'audio',
      linkedClipId: 'video',
      trackId: 'audio-track',
      source: { type: 'audio', naturalDuration: 10 },
    }), {
      trackId: 'audio-track',
      clipTrim: trim({ clipId: 'video', edge: 'right', appliedDelta: 1.5, includeLinked: true }),
    });

    expect(geometry.duration).toBe(6.5);
    expect(geometry.outPoint).toBe(6.5);
    expect(geometry.trimEdge).toBe('right');
  });

  it('keeps linked clips in the trim preview while alt is held', () => {
    const geometry = resolveClipGeometry(clip({
      id: 'audio',
      linkedClipId: 'video',
      trackId: 'audio-track',
      source: { type: 'audio', naturalDuration: 10 },
    }), {
      trackId: 'audio-track',
      clipTrim: trim({ clipId: 'video', edge: 'right', appliedDelta: 1.5, altKey: true, includeLinked: true }),
    });

    expect(geometry.duration).toBe(6.5);
    expect(geometry.outPoint).toBe(6.5);
    expect(geometry.trimEdge).toBe('right');
  });

  it('keeps linked clips out of the trim preview while shift is held', () => {
    const geometry = resolveClipGeometry(clip({
      id: 'audio',
      linkedClipId: 'video',
      trackId: 'audio-track',
      source: { type: 'audio', naturalDuration: 10 },
    }), {
      trackId: 'audio-track',
      clipTrim: trim({ clipId: 'video', edge: 'right', appliedDelta: 1.5, includeLinked: true, singleClip: true }),
    });

    expect(geometry.duration).toBe(5);
    expect(geometry.outPoint).toBe(5);
    expect(geometry.trimEdge).toBeUndefined();
  });
});
