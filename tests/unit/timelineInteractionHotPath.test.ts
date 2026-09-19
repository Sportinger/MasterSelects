import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTimelineMouseMoveScheduler } from '../../src/components/timeline/utils/clipDragMouseMoveScheduler';
import { clipTrimAffectsTrack } from '../../src/components/timeline/utils/timelineHostLayout';
import type { ClipTrimState } from '../../src/components/timeline/types';
import { createMockClip } from '../helpers/mockData';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeline interaction hot paths', () => {
  it('coalesces raw pointer movement to the latest event in one animation frame', () => {
    let scheduledFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFrame = callback;
      return 17;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const processed: MouseEvent[] = [];
    const scheduler = createTimelineMouseMoveScheduler((event) => processed.push(event));
    const first = new MouseEvent('mousemove', { clientX: 10 });
    const latest = new MouseEvent('mousemove', { clientX: 20 });

    scheduler.handleMouseMove(first);
    scheduler.handleMouseMove(latest);

    expect(processed).toEqual([]);
    expect(scheduledFrame).not.toBeNull();
    (scheduledFrame as FrameRequestCallback)(16);
    expect(processed).toEqual([latest]);
  });

  it('routes live trim state only to the grabbed clip and its included link', () => {
    const video = createMockClip({
      id: 'video',
      trackId: 'video-track',
      linkedClipId: 'audio',
      source: { type: 'video' },
    });
    const audio = createMockClip({
      id: 'audio',
      trackId: 'audio-track',
      linkedClipId: 'video',
      source: { type: 'audio' },
    });
    const clipMap = new Map([[video.id, video], [audio.id, audio]]);
    const trim: ClipTrimState = {
      clipId: video.id,
      edge: 'right',
      originalStartTime: 0,
      originalDuration: 1,
      originalInPoint: 0,
      originalOutPoint: 1,
      startX: 0,
      currentX: 0,
      altKey: false,
      includeLinked: true,
      snapIndicatorTime: null,
      isSnapping: false,
      appliedDelta: 0,
    };

    expect(clipTrimAffectsTrack(trim, 'video-track', clipMap)).toBe(true);
    expect(clipTrimAffectsTrack(trim, 'audio-track', clipMap)).toBe(true);
    expect(clipTrimAffectsTrack(trim, 'unrelated-track', clipMap)).toBe(false);
    expect(clipTrimAffectsTrack({ ...trim, singleClip: true }, 'audio-track', clipMap)).toBe(false);
  });
});
