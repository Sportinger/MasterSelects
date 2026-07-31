import { describe, expect, it } from 'vitest';

import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import type { TimelineTrack } from '../../src/types/timeline';

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 70,
  muted: false,
  visible: true,
  solo: false,
};

describe('storyboard batch split identity', () => {
  it('creates a fresh scene identity for every split part after the first', () => {
    const clip = createStoryboardTimelineClip({
      trackId: track.id,
      planId: 'plan-1',
      sceneId: 'scene-original',
      clipId: 'clip-original',
      startTime: 0,
      durationSeconds: 9,
      title: 'Montage',
      description: 'Three beats.',
    });

    const result = applySplitAtTimesOperation({
      id: 'split-storyboard',
      type: 'split-at-times',
      clipId: clip.id,
      times: [3, 6],
      includeLinked: false,
    }, [clip], [track]);

    const parts = result.clips.toSorted((left, right) => left.startTime - right.startTime);
    const sceneIds = parts.map(part => part.storyboardProperties?.sceneId);
    expect(sceneIds[0]).toBe('scene-original');
    expect(new Set(sceneIds).size).toBe(3);
  });
});
