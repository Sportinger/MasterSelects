import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import {
  releaseHistoryRehydratedTimelineRuntimeResources,
  syncHistoryRehydratedTimelineRuntimeResources,
} from '../../src/services/timeline/historyRuntimeRehydration';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { createMockClip } from '../helpers/mockData';

function makeRuntimeClip(
  id: string,
  source: NonNullable<TimelineClip['source']>
): TimelineClip {
  return createMockClip({
    id,
    trackId: 'video-1',
    mediaFileId: source.mediaFileId,
    source,
  });
}

describe('history runtime rehydration reporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    releaseHistoryRehydratedTimelineRuntimeResources();
  });

  afterEach(() => {
    releaseHistoryRehydratedTimelineRuntimeResources();
    timelineRuntimeCoordinator.clearResources();
  });

  it('reports only restored clips with reusable runtime sources', () => {
    const video = document.createElement('video');
    const liveClip = makeRuntimeClip('live-clip', {
      type: 'video',
      mediaFileId: 'media-live',
      runtimeSourceId: 'media:live',
      runtimeSessionKey: 'interactive:live',
      videoElement: video,
      naturalDuration: 4,
    });
    const dataOnlyClip = makeRuntimeClip('data-only-clip', {
      type: 'video',
      mediaFileId: 'media-data',
      naturalDuration: 4,
    });

    syncHistoryRehydratedTimelineRuntimeResources([liveClip, dataOnlyClip]);

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources.map((resource) => resource.owner.ownerId).toSorted()).toEqual([
      'history-rehydrate:live-clip',
      'history-rehydrate:live-clip',
    ]);
    expect(resources.map((resource) => resource.kind).toSorted()).toEqual([
      'html-media',
      'runtime-binding',
    ]);
    expect(JSON.stringify(resources)).not.toContain('data-only-clip');
  });

  it('replaces prior history rehydrate resources without touching other owners', () => {
    timelineRuntimeCoordinator.retainResource({
      id: 'unrelated-interactive-resource',
      kind: 'image-canvas',
      policyId: 'interactive',
      owner: {
        ownerId: 'lazy-media:clip',
        ownerType: 'clip',
        clipId: 'lazy-clip',
      },
      imageKind: 'html-canvas',
      imageId: 'lazy-canvas',
    });

    syncHistoryRehydratedTimelineRuntimeResources([
      makeRuntimeClip('clip-a', {
        type: 'text',
        textCanvas: document.createElement('canvas'),
        naturalDuration: 2,
      }),
    ]);
    syncHistoryRehydratedTimelineRuntimeResources([
      makeRuntimeClip('clip-b', {
        type: 'image',
        imageElement: document.createElement('img'),
        naturalDuration: 2,
      }),
    ]);

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources.map((resource) => resource.owner.ownerId).toSorted()).toEqual([
      'history-rehydrate:clip-b',
      'lazy-media:clip',
    ]);
    expect(JSON.stringify(resources)).not.toContain('history-rehydrate:clip-a');
  });
});
