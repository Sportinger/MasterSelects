import {
  cloneStoryboardClipProperties,
  STORYBOARD_SOURCE_NATURAL_DURATION,
} from '../../../services/storyboard/core';
import { Logger } from '../../../services/logger';
import type { SerializableClip, TimelineClip } from '../types';
import { applyCommonRestoredClipFields } from './loadStateCommonClipRestore';

const log = Logger.create('Timeline');

export function createLoadStateStoryboardClip(
  serializedClip: SerializableClip,
): TimelineClip | undefined {
  if (serializedClip.sourceType !== 'storyboard' || !serializedClip.storyboardProperties) {
    return undefined;
  }
  log.debug('Restored storyboard scene card', {
    clip: serializedClip.name,
    sceneId: serializedClip.storyboardProperties.sceneId,
  });

  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || serializedClip.storyboardProperties.title,
    file: new File(
      [JSON.stringify({
        planId: serializedClip.storyboardProperties.planId,
        sceneId: serializedClip.storyboardProperties.sceneId,
      })],
      `${serializedClip.storyboardProperties.sceneId}.storyboard.json`,
      { type: 'application/json' },
    ),
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: {
      type: 'storyboard',
      naturalDuration: STORYBOARD_SOURCE_NATURAL_DURATION,
    },
    storyboardProperties: cloneStoryboardClipProperties(serializedClip.storyboardProperties),
    ...applyCommonRestoredClipFields(serializedClip),
    needsReload: false,
    isLoading: false,
  };
}
