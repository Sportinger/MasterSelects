import { describe, expect, it } from 'vitest';
import {
  canClipOwnVideoSyncMedia,
} from '../../src/services/layerBuilder/videoSyncTimelineQueries';
import type { TimelineClip } from '../../src/types/timeline';
import type { TimelineSourceType } from '../../src/types/timelineSource';

function createClip(
  id: string,
  sourceType: TimelineSourceType,
  extras: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    trackId: 'video-track',
    name: id,
    file: new File([], `${id}.bin`),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: sourceType },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...extras,
  };
}

describe('video sync media admission', () => {
  it('rejects non-media visual clips without probing runtime state', () => {
    const sourceTypes: TimelineSourceType[] = [
      'motion-shape',
      'text',
      'solid',
      'image',
      'model',
      'camera',
      'light',
      'math-scene',
      'motion-adjustment',
    ];

    expect(sourceTypes.every((sourceType, index) =>
      !canClipOwnVideoSyncMedia(createClip(`graphic-${index}`, sourceType))
    )).toBe(true);
  });

  it('keeps direct, legacy, and runtime-backed video sources eligible', () => {
    const video = createClip('video', 'video');
    const legacyHandle = createClip('legacy', 'text', {
      source: {
        type: 'text',
        videoElement: document.createElement('video'),
      },
    });
    const runtimeBacked = createClip('runtime', 'text', {
      source: {
        type: 'text',
        runtimeSourceId: 'source-1',
        runtimeSessionKey: 'interactive:clip-1',
      },
    });

    expect(canClipOwnVideoSyncMedia(video)).toBe(true);
    expect(canClipOwnVideoSyncMedia(legacyHandle)).toBe(true);
    expect(canClipOwnVideoSyncMedia(runtimeBacked)).toBe(true);
  });

  it('admits nested and transition video clips independently of their graphic parent', () => {
    const nestedVideo = createClip('nested-video', 'video');
    const parent = createClip('composition', 'motion-shape', {
      isComposition: true,
      nestedClips: [nestedVideo],
    });
    const transitionVideo = createClip('transition-video', 'video', {
      transitionOut: {
        type: 'crossfade',
        duration: 0.5,
        linkedClipId: 'incoming',
      },
    });

    expect(canClipOwnVideoSyncMedia(parent)).toBe(false);
    expect(canClipOwnVideoSyncMedia(nestedVideo)).toBe(true);
    expect(canClipOwnVideoSyncMedia(transitionVideo)).toBe(true);
  });
});
