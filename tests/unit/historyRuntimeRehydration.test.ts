import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import {
  rehydrateHistoryGeneratedTimelineRuntimes,
  releaseHistoryRehydratedTimelineRuntimeResources,
  syncHistoryRehydratedTimelineRuntimeResources,
} from '../../src/services/timeline/historyRuntimeRehydration';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
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

  it('recreates generated text canvases at the active composition dimensions', () => {
    const clip = makeRuntimeClip('restored-text', {
      type: 'text',
      naturalDuration: 2,
    });
    clip.textProperties = {
      ...structuredClone(DEFAULT_TEXT_PROPERTIES),
      text: 'Restored after redo',
    };

    const [rehydrated] = rehydrateHistoryGeneratedTimelineRuntimes(
      [clip],
      { width: 1280, height: 720 },
    );

    expect(rehydrated).not.toBe(clip);
    expect(rehydrated.source?.textCanvas).toBeInstanceOf(HTMLCanvasElement);
    expect(rehydrated.source?.textCanvas?.width).toBe(1280);
    expect(rehydrated.source?.textCanvas?.height).toBe(720);
    expect(clip.source).not.toHaveProperty('textCanvas');
  });

  it('keeps an existing generated canvas runtime by reference', () => {
    const canvas = document.createElement('canvas');
    const clip = makeRuntimeClip('live-text', {
      type: 'text',
      textCanvas: canvas,
      naturalDuration: 2,
    });
    clip.textProperties = structuredClone(DEFAULT_TEXT_PROPERTIES);

    const [rehydrated] = rehydrateHistoryGeneratedTimelineRuntimes([clip]);

    expect(rehydrated).toBe(clip);
    expect(rehydrated.source?.textCanvas).toBe(canvas);
  });

  it('uses the restored composition dimensions when media size changes in the same history step', () => {
    const clip = makeRuntimeClip('resized-text', {
      type: 'text',
      naturalDuration: 2,
    });
    clip.textProperties = {
      ...structuredClone(DEFAULT_TEXT_PROPERTIES),
      text: 'Historical size',
    };
    const timeline = {
      clips: [clip],
      tracks: [],
      selectedClipIds: new Set<string>(),
      zoom: 50,
      scrollX: 0,
      layers: [],
      selectedLayerId: null,
      clipKeyframes: new Map(),
      markers: [],
    };
    const compositionBase = {
      id: 'composition-1',
      name: 'Resizable composition',
      type: 'composition' as const,
      parentId: null,
      createdAt: 1,
      frameRate: 30,
      duration: 2,
      backgroundColor: '#000000',
    };
    const snapshot = createHistorySnapshot('Before resize', {
      getTimelineState: () => timeline,
      getMediaState: () => ({
        activeCompositionId: compositionBase.id,
        files: [],
        compositions: [{ ...compositionBase, width: 640, height: 360 }],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
    });
    let restoredClips: TimelineClip[] = [];

    applyHistorySnapshot(snapshot, {
      getTimelineState: () => timeline,
      setTimelineState: (state) => {
        restoredClips = state.clips ?? [];
      },
      getMediaState: () => ({
        activeCompositionId: compositionBase.id,
        files: [],
        compositions: [{ ...compositionBase, width: 1920, height: 1080 }],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
    });

    expect(restoredClips[0]?.source?.textCanvas?.width).toBe(640);
    expect(restoredClips[0]?.source?.textCanvas?.height).toBe(360);
  });
});
