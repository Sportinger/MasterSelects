import { describe, expect, it } from 'vitest';
import {
  createWorkerDrawableClips,
} from '../../src/components/timeline/utils/timelineClipCanvasClipGeometry';
import { shouldIncludeLinkedTrim } from '../../src/components/timeline/hooks/useClipTrim';
import type { ClipTrimState } from '../../src/components/timeline/types';
import type { TimelinePaintSourceClip } from '../../src/timeline';

function createClip(overrides: Partial<TimelinePaintSourceClip> = {}): TimelinePaintSourceClip {
  return {
    duration: 5,
    id: 'clip-1',
    inPoint: 0,
    name: 'Clip 1',
    outPoint: 5,
    source: { naturalDuration: 10, type: 'video' },
    startTime: 10,
    trackId: 'track-1',
    ...overrides,
  };
}

function createTrim(overrides: Partial<ClipTrimState> = {}): ClipTrimState {
  return {
    altKey: false,
    appliedDelta: 1.5,
    clipId: 'clip-1',
    currentX: 0,
    edge: 'left',
    isSnapping: false,
    includeLinked: false,
    originalDuration: 5,
    originalInPoint: 0,
    originalOutPoint: 5,
    originalStartTime: 10,
    snapIndicatorTime: null,
    startX: 0,
    ...overrides,
  };
}

describe('timeline clip canvas clip geometry', () => {
  it('moves the drawable clip body with a left trim preview', () => {
    const [clip] = createWorkerDrawableClips([createClip()], {
      clipTrim: createTrim(),
      trackId: 'track-1',
    });

    expect(clip).toMatchObject({
      duration: 3.5,
      inPoint: 1.5,
      outPoint: 5,
      startTime: 11.5,
    });
  });

  it('only previews linked clip trimming when the gesture includes linked clips', () => {
    const linkedClip = createClip({
      id: 'audio-1',
      linkedClipId: 'clip-1',
      source: { naturalDuration: 10, type: 'audio' },
    });

    const withoutLinked = createWorkerDrawableClips([linkedClip], {
      clipTrim: createTrim({ includeLinked: false }),
      trackId: 'track-1',
    });
    const withLinked = createWorkerDrawableClips([linkedClip], {
      clipTrim: createTrim({ includeLinked: true }),
      trackId: 'track-1',
    });

    expect(withoutLinked[0]).toMatchObject({ startTime: 10, duration: 5, inPoint: 0 });
    expect(withLinked[0]).toMatchObject({ startTime: 11.5, duration: 3.5, inPoint: 1.5 });
  });

  it('includes linked trim for unselected clips but not explicit single selection', () => {
    const clip = createClip({ linkedClipId: 'audio-1' });

    expect(shouldIncludeLinkedTrim(clip, new Set())).toBe(true);
    expect(shouldIncludeLinkedTrim(clip, new Set(['clip-1']))).toBe(false);
    expect(shouldIncludeLinkedTrim(clip, new Set(['clip-1', 'audio-1']))).toBe(true);
    expect(shouldIncludeLinkedTrim(clip, new Set(['clip-1', 'audio-1']), true)).toBe(false);
  });

  it('keeps shift trim single even when includeLinked is set', () => {
    const linkedClip = createClip({
      id: 'audio-1',
      linkedClipId: 'clip-1',
      source: { naturalDuration: 10, type: 'audio' },
    });

    const [clip] = createWorkerDrawableClips([linkedClip], {
      clipTrim: createTrim({ includeLinked: true, singleClip: true }),
      trackId: 'track-1',
    });

    expect(clip).toMatchObject({ startTime: 10, duration: 5, inPoint: 0 });
  });
});
