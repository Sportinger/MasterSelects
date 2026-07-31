import { describe, expect, it } from 'vitest';

import {
  createStoryboardPropertiesClipUpdate,
  STORYBOARD_SCENE_STATUSES,
} from '../../src/components/properties/storyboard/storyboardPropertiesModel';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';

describe('storyboard properties model', () => {
  it('edits projected scene fields without changing scene identity or actual clip duration', () => {
    const clip = createStoryboardTimelineClip({
      trackId: 'video-1',
      planId: 'plan-1',
      sceneId: 'scene-stable',
      title: 'Old title',
      description: 'Old description',
      startTime: 0,
      durationSeconds: 5,
      targetDurationSeconds: 8,
    });

    const update = createStoryboardPropertiesClipUpdate(clip, {
      title: 'New title',
      description: 'New description',
      targetDurationSeconds: 12,
      status: 'ready',
    });

    expect(update).toMatchObject({
      name: 'New title',
      storyboardProperties: {
        sceneId: 'scene-stable',
        title: 'New title',
        description: 'New description',
        targetDurationSeconds: 12,
        status: 'ready',
      },
    });
    expect(clip.duration).toBe(5);
    expect(STORYBOARD_SCENE_STATUSES).toContain('blocked');
  });
});
