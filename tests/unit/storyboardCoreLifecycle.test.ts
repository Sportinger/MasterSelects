import { beforeEach, describe, expect, it } from 'vitest';

import {
  createStoryboardTimelineClip,
  listStoryboardTimelineScenes,
} from '../../src/services/storyboard/core';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const videoTrack: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 70,
  muted: false,
  visible: true,
  solo: false,
};

function createScene(overrides: Partial<Parameters<typeof createStoryboardTimelineClip>[0]> = {}) {
  return createStoryboardTimelineClip({
    trackId: videoTrack.id,
    planId: 'plan-1',
    sceneId: 'scene-1',
    clipId: 'storyboard-clip-1',
    startTime: 0,
    durationSeconds: 5,
    targetDurationSeconds: 7,
    title: 'Opening',
    description: 'Establish the central conflict.',
    properties: {
      evidenceRefIds: ['evidence-1'],
      filledClipIds: ['filled-1'],
      variantSetIds: ['variant-1'],
    },
    ...overrides,
  });
}

function resetTimeline(clips: TimelineClip[] = []): void {
  useTimelineStore.setState({
    tracks: [videoTrack],
    clips,
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    playheadPosition: 0,
    snappingEnabled: false,
    clipKeyframes: new Map(),
    clipboardData: null,
    layers: [],
    selectedLayerId: null,
    markers: [],
    isExporting: false,
  });
}

function initializeHistoryRefs(): void {
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: () => ({
        files: [],
        compositions: [],
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
      setState: () => undefined,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

describe('storyboard core lifecycle', () => {
  beforeEach(() => {
    initializeHistoryRefs();
    resetTimeline();
    useHistoryStore.getState().clearHistory();
  });

  it('creates a normal infinite-source timeline clip and lists scenes in timeline order', () => {
    const later = createScene({
      clipId: 'later',
      sceneId: 'scene-later',
      startTime: 8,
    });
    const opening = createScene();

    expect(opening.source).toMatchObject({
      type: 'storyboard',
      naturalDuration: Number.MAX_SAFE_INTEGER,
    });
    expect(opening.storyboardProperties).toMatchObject({
      schemaVersion: 1,
      planId: 'plan-1',
      sceneId: 'scene-1',
      targetDurationSeconds: 7,
      status: 'draft',
    });
    expect(listStoryboardTimelineScenes([later, opening]).map(clip => clip.id))
      .toEqual(['storyboard-clip-1', 'later']);
  });

  it('uses standard move and trim operations without changing target duration or scene identity', () => {
    resetTimeline([createScene()]);

    useTimelineStore.getState().moveClip('storyboard-clip-1', 3, videoTrack.id);
    useTimelineStore.getState().trimClip('storyboard-clip-1', 0, 9);

    const clip = useTimelineStore.getState().clips[0];
    expect(clip.startTime).toBe(3);
    expect(clip.duration).toBe(9);
    expect(clip.storyboardProperties?.sceneId).toBe('scene-1');
    expect(clip.storyboardProperties?.targetDurationSeconds).toBe(7);
  });

  it('copy/paste gives the clip a new clip id while retaining and deeply cloning scene identity', () => {
    const original = createScene();
    resetTimeline([original]);
    useTimelineStore.setState({
      selectedClipIds: new Set([original.id]),
      primarySelectedClipId: original.id,
      playheadPosition: 12,
    });

    useTimelineStore.getState().copyClips();
    useTimelineStore.getState().pasteClips();

    const clips = useTimelineStore.getState().clips;
    expect(clips).toHaveLength(2);
    const pasted = clips.find(clip => clip.id !== original.id)!;
    expect(pasted.id).not.toBe(original.id);
    expect(pasted.storyboardProperties?.sceneId).toBe('scene-1');
    expect(pasted.storyboardProperties).not.toBe(original.storyboardProperties);
    expect(pasted.storyboardProperties?.evidenceRefIds).not.toBe(
      original.storyboardProperties?.evidenceRefIds,
    );
  });

  it('keeps the original scene id on the first split part and creates a new right-hand scene id', () => {
    const original = createScene();
    resetTimeline([original]);

    useTimelineStore.getState().splitClip(original.id, 2);

    const parts = useTimelineStore.getState().clips.toSorted(
      (left, right) => left.startTime - right.startTime,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].storyboardProperties?.sceneId).toBe('scene-1');
    expect(parts[1].storyboardProperties?.sceneId).not.toBe('scene-1');
    expect(parts[1].storyboardProperties?.sceneId).toMatch(/^scene-/);
    expect(parts[0].storyboardProperties?.evidenceRefIds).not.toBe(
      parts[1].storyboardProperties?.evidenceRefIds,
    );
  });

  it('round-trips through timeline serialization without media reload', async () => {
    resetTimeline([createScene()]);
    const serialized = useTimelineStore.getState().getSerializableState();

    expect(serialized.clips[0].storyboardProperties?.sceneId).toBe('scene-1');
    await useTimelineStore.getState().loadState(serialized);

    const restored = useTimelineStore.getState().clips[0];
    expect(restored.source?.type).toBe('storyboard');
    expect(restored.source?.naturalDuration).toBe(Number.MAX_SAFE_INTEGER);
    expect(restored.storyboardProperties).toEqual(serialized.clips[0].storyboardProperties);
    expect(restored.needsReload).toBe(false);
    expect(restored.isLoading).toBe(false);
  });

  it('preserves storyboard properties through real history undo/redo snapshots', () => {
    resetTimeline([createScene()]);
    useHistoryStore.getState().captureSnapshot('Initial storyboard');

    const clip = useTimelineStore.getState().clips[0];
    useTimelineStore.getState().updateClip(clip.id, {
      name: 'Changed title',
      storyboardProperties: {
        ...clip.storyboardProperties!,
        title: 'Changed title',
        evidenceRefIds: ['changed-evidence'],
      },
    });
    useHistoryStore.getState().captureSnapshot('Changed storyboard');

    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips[0].storyboardProperties).toMatchObject({
      title: 'Opening',
      evidenceRefIds: ['evidence-1'],
    });
    expect(useTimelineStore.getState().clips[0].needsReload).toBe(false);

    expect(useHistoryStore.getState().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips[0].storyboardProperties).toMatchObject({
      title: 'Changed title',
      evidenceRefIds: ['changed-evidence'],
    });
  });
});
