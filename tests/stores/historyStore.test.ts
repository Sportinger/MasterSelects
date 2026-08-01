import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getHistoryStateView, useHistoryStore, initHistoryStoreRefs, setHistoryCallbacks, captureSnapshot as captureSnapshotFn, undo as undoFn, redo as redoFn, startBatch as startBatchFn, endBatch as endBatchFn, serializeHistoryStateForProject, hydrateHistoryStateFromProject, setHistoryDisabledForDebug, isHistoryDisabledForDebug } from '../../src/stores/historyStore';
import { findHistoryStateBoundaryViolations } from '../../src/stores/timeline/historyTimelineEditState';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { Layer, TimelineClip } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

type HistoryStoreRefs = Parameters<typeof initHistoryStoreRefs>[0];
type TimelineMockState = ReturnType<HistoryStoreRefs['timeline']['getState']>;
type MediaMockState = ReturnType<HistoryStoreRefs['media']['getState']>;
type DockMockState = ReturnType<HistoryStoreRefs['dock']['getState']>;
type LegacyClip = TimelineClip & {
  startFrame?: number;
  endFrame?: number;
  mediaId?: string;
};

function mockClip(overrides: Partial<LegacyClip>): LegacyClip {
  return {
    ...createMockClip({
      id: overrides.id ?? 'clip-1',
      trackId: overrides.trackId ?? 'v1',
    }),
    ...overrides,
  };
}

function mockLayer(overrides: Partial<Layer>): Layer {
  return {
    id: overrides.id ?? 'L1',
    name: overrides.name ?? 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...overrides,
  };
}

function mockMediaFile(overrides: Partial<MediaMockState['files'][number]>): MediaMockState['files'][number] {
  return {
    id: overrides.id ?? 'file-1',
    name: overrides.name ?? 'file.mp4',
    type: overrides.type ?? 'video',
    parentId: null,
    createdAt: 0,
    url: '',
    ...overrides,
  };
}

function mockComposition(overrides: Partial<MediaMockState['compositions'][number]>): MediaMockState['compositions'][number] {
  return {
    id: overrides.id ?? 'comp-1',
    name: overrides.name ?? 'Composition',
    type: 'composition',
    parentId: null,
    createdAt: 0,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    ...overrides,
  };
}

function mockFolder(overrides: Partial<MediaMockState['folders'][number]>): MediaMockState['folders'][number] {
  return {
    id: overrides.id ?? 'folder-1',
    name: overrides.name ?? 'Folder',
    parentId: null,
    isExpanded: false,
    createdAt: 0,
    ...overrides,
  };
}

function mockTextItem(overrides: Partial<MediaMockState['textItems'][number]>): MediaMockState['textItems'][number] {
  return {
    id: overrides.id ?? 'text-1',
    name: overrides.name ?? 'Text',
    type: 'text',
    parentId: null,
    createdAt: 0,
    text: '',
    fontFamily: 'Inter',
    fontSize: 48,
    color: '#ffffff',
    duration: 5,
    ...overrides,
  };
}

function mockSolidItem(overrides: Partial<MediaMockState['solidItems'][number]>): MediaMockState['solidItems'][number] {
  return {
    id: overrides.id ?? 'solid-1',
    name: overrides.name ?? 'Solid',
    type: 'solid',
    parentId: null,
    createdAt: 0,
    color: '#ffffff',
    width: 1920,
    height: 1080,
    duration: 5,
    ...overrides,
  };
}

// Mock the external store references the history store reads from
function createMockStores() {
  let timelineState: TimelineMockState = {
    clips: [],
    tracks: [{ id: 'v1', name: 'V1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false }],
    selectedClipIds: new Set<string>(),
    zoom: 50,
    scrollX: 0,
    layers: [],
    selectedLayerId: null,
    clipKeyframes: new Map(),
    markers: [],
    isExporting: false,
  };
  let mediaState: MediaMockState = {
    files: [],
    compositions: [],
    folders: [],
    selectedIds: [],
    expandedFolderIds: [],
    textItems: [],
    solidItems: [],
  };
  let dockState: DockMockState = { layout: null };

  return {
    timeline: {
      getState: () => timelineState,
      setState: (s: Partial<TimelineMockState>) => { timelineState = { ...timelineState, ...s }; },
    },
    media: {
      getState: () => mediaState,
      setState: (s: Partial<MediaMockState>) => { mediaState = { ...mediaState, ...s }; },
    },
    dock: {
      getState: () => dockState,
      setState: (s: Partial<DockMockState>) => { dockState = { ...dockState, ...s }; },
    },
    // Helpers to simulate changes
    setTimelineState: (s: Partial<TimelineMockState>) => { timelineState = { ...timelineState, ...s }; },
    setMediaState: (s: Partial<MediaMockState>) => { mediaState = { ...mediaState, ...s }; },
  };
}

describe('historyStore', () => {
  let mocks: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    setHistoryDisabledForDebug(false);

    // Reset history store state
    useHistoryStore.setState({
      nodes: {},
      rootId: null,
      activeNodeId: null,
      lastVisitedChildByNodeId: {},
      eventLog: [],
      maxHistoryNodes: 150,
      isApplying: false,
      batchId: null,
      batchLabel: null,
    });

    mocks = createMockStores();
    initHistoryStoreRefs(mocks);
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  it('captureSnapshot: first capture sets currentSnapshot', () => {
    getHistoryStateView().captureSnapshot('first');
    const state = getHistoryStateView();
    expect(state.currentSnapshot).not.toBeNull();
    expect(state.currentSnapshot!.label).toBe('first');
    expect(state.undoStack.length).toBe(0);
  });

  it('captureSnapshot: stores a runtime-free timeline edit sidecar', () => {
    const runtimeClip = mockClip({
      id: 'runtime-clip',
      file: { name: 'clip.mp4' } as File,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        file: { name: 'clip.mp4' } as File,
        videoElement: { tagName: 'VIDEO' } as HTMLVideoElement,
        naturalDuration: 12,
      },
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'waveform-ref' },
        processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform-ref' },
      },
    });
    const runtimeLayer = mockLayer({
      id: 'runtime-layer',
      sourceClipId: 'runtime-clip',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        file: { name: 'layer-source.mp4' } as File,
        videoElement: { tagName: 'VIDEO' } as HTMLVideoElement,
      } as NonNullable<Layer['source']>,
    });

    mocks.setTimelineState({
      clips: [runtimeClip],
      selectedClipIds: new Set(['runtime-clip']),
      layers: [runtimeLayer],
      selectedLayerId: 'runtime-layer',
    });

    getHistoryStateView().captureSnapshot('with runtime');
    const timelineEditState = getHistoryStateView().currentSnapshot?.timelineEditState;

    expect(timelineEditState).toBeDefined();
    expect(findHistoryStateBoundaryViolations(timelineEditState)).toEqual([]);
    expect(JSON.parse(JSON.stringify(timelineEditState))).toEqual(timelineEditState);
    expect(timelineEditState?.timeline.clips[0].runtimeRef).toEqual({
      kind: 'media-file',
      sourceType: 'video',
      mediaFileId: 'media-1',
      naturalDuration: 12,
    });
    expect(timelineEditState?.timeline.layers[0].sourceRef).toEqual({
      type: 'video',
      sourceClipId: 'runtime-clip',
      mediaFileId: 'media-1',
    });
  });

  it('captureSnapshot: derives legacy timeline data from the runtime-free sidecar', () => {
    const runtimeFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const runtimeVideo = { tagName: 'VIDEO', runtimeId: 'snapshot-video' } as unknown as HTMLVideoElement;
    const runtimeLayerSource = {
      type: 'video',
      mediaFileId: 'media-1',
      file: runtimeFile,
      videoElement: runtimeVideo,
    } as NonNullable<Layer['source']>;
    mocks.setTimelineState({
      clips: [
        mockClip({
          id: 'runtime-clip',
          file: runtimeFile,
          source: {
            type: 'video',
            mediaFileId: 'media-1',
            file: runtimeFile,
            videoElement: runtimeVideo,
            naturalDuration: 12,
          },
          mediaFileId: 'media-1',
        }),
      ],
      layers: [
        mockLayer({
          id: 'runtime-layer',
          sourceClipId: 'runtime-clip',
          source: runtimeLayerSource,
        }),
      ],
    });

    getHistoryStateView().captureSnapshot('with runtime');
    const snapshot = getHistoryStateView().currentSnapshot;
    const legacyClip = snapshot?.timeline.clips[0];
    const legacyLayer = snapshot?.timeline.layers[0];

    expect(legacyClip?.source?.videoElement).toBeUndefined();
    expect(legacyClip?.source?.webCodecsPlayer).toBeUndefined();
    expect(legacyClip?.source?.file).toBeUndefined();
    expect(legacyClip?.file).not.toBe(runtimeFile);
    expect(legacyClip?.file instanceof File).toBe(false);
    expect(legacyLayer?.source?.videoElement).toBeUndefined();
    expect(legacyLayer?.source?.file).toBeUndefined();
  });

  it('captureSnapshot: second capture pushes first to undoStack', () => {
    getHistoryStateView().captureSnapshot('first');
    getHistoryStateView().captureSnapshot('second');
    const state = getHistoryStateView();
    expect(state.undoStack.length).toBe(1);
    expect(state.undoStack[0].label).toBe('first');
    expect(state.currentSnapshot!.label).toBe('second');
  });

  it('captureSnapshot: clears redo stack on new action', () => {
    getHistoryStateView().captureSnapshot('first');
    getHistoryStateView().captureSnapshot('second');
    getHistoryStateView().captureSnapshot('third');
    // Undo to create redo stack
    getHistoryStateView().undo();
    expect(getHistoryStateView().redoStack.length).toBe(1);

    // New action clears redo
    getHistoryStateView().captureSnapshot('new-action');
    expect(getHistoryStateView().redoStack.length).toBe(0);
  });

  it('captureSnapshot: does not capture during isApplying', () => {
    useHistoryStore.setState({ isApplying: true });
    getHistoryStateView().captureSnapshot('should-not-capture');
    expect(getHistoryStateView().currentSnapshot).toBeNull();
  });

  it('debug disable: suppresses captures and batches', () => {
    setHistoryDisabledForDebug(true);
    expect(isHistoryDisabledForDebug()).toBe(true);

    getHistoryStateView().captureSnapshot('hidden');
    getHistoryStateView().startBatch('hidden batch');
    getHistoryStateView().endBatch();

    const state = getHistoryStateView();
    expect(state.currentSnapshot).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.batchId).toBeNull();
  });

  it('captureSnapshot: does not capture during batch', () => {
    getHistoryStateView().captureSnapshot('initial');
    getHistoryStateView().startBatch('batch');
    getHistoryStateView().captureSnapshot('during-batch');
    // Still only 1 snapshot (initial), nothing new pushed
    expect(getHistoryStateView().undoStack.length).toBe(0);
  });

  it('undo: restores previous state', () => {
    // Capture initial state
    getHistoryStateView().captureSnapshot('add track');

    // Change state
    mocks.setTimelineState({ zoom: 100 });
    getHistoryStateView().captureSnapshot('zoom change');

    expect(getHistoryStateView().undoStack.length).toBe(1);

    // Undo
    getHistoryStateView().undo();

    // Timeline state should be restored
    expect(mocks.timeline.getState().zoom).toBe(50); // original value
    expect(getHistoryStateView().undoStack.length).toBe(0);
    expect(getHistoryStateView().redoStack.length).toBe(1);
  });

  it('undo: restores from timelineEditState and reuses compatible current runtime', () => {
    const oldVideo = { tagName: 'VIDEO', runtimeId: 'old-video' } as unknown as HTMLVideoElement;
    const currentVideo = { tagName: 'VIDEO', runtimeId: 'current-video' } as unknown as HTMLVideoElement;
    const firstClip = mockClip({
      id: 'runtime-clip',
      startTime: 0,
      mediaFileId: 'media-1',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        videoElement: oldVideo,
        naturalDuration: 12,
      },
    });
    const secondClip = mockClip({
      ...firstClip,
      startTime: 5,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        videoElement: currentVideo,
        naturalDuration: 12,
      },
    });

    mocks.setTimelineState({ clips: [firstClip] });
    getHistoryStateView().captureSnapshot('initial runtime');
    mocks.setTimelineState({ clips: [secondClip] });
    getHistoryStateView().captureSnapshot('moved runtime');

    getHistoryStateView().undo();
    const restoredClip = mocks.timeline.getState().clips[0];

    expect(restoredClip.startTime).toBe(0);
    expect(restoredClip.source?.videoElement).toBe(currentVideo);
    expect(restoredClip.source?.videoElement).not.toBe(oldVideo);
  });

  it('undo: reports rehydrated compatible runtime resources after restore', () => {
    const oldVideo = document.createElement('video');
    oldVideo.src = 'blob:old-video';
    const currentVideo = document.createElement('video');
    currentVideo.src = 'blob:current-video';
    const firstClip = mockClip({
      id: 'runtime-clip',
      startTime: 0,
      mediaFileId: 'media-1',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        runtimeSourceId: 'media:media-1',
        runtimeSessionKey: 'interactive:old',
        videoElement: oldVideo,
        naturalDuration: 12,
      },
    });
    const secondClip = mockClip({
      ...firstClip,
      startTime: 5,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        runtimeSourceId: 'media:media-1',
        runtimeSessionKey: 'interactive:current',
        videoElement: currentVideo,
        naturalDuration: 12,
      },
    });

    mocks.setTimelineState({ clips: [firstClip] });
    getHistoryStateView().captureSnapshot('initial runtime');
    mocks.setTimelineState({ clips: [secondClip] });
    getHistoryStateView().captureSnapshot('moved runtime');

    timelineRuntimeCoordinator.clearResources();
    getHistoryStateView().undo();

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources.map((resource) => resource.owner.ownerId).toSorted()).toEqual([
      'history-rehydrate:runtime-clip',
      'history-rehydrate:runtime-clip',
    ]);
    expect(JSON.stringify(resources)).toContain('interactive:current');
    expect(JSON.stringify(resources)).not.toContain('interactive:old');
  });

  it('undo: restores deleted clips as data-only lazy reload entries', () => {
    const oldVideo = { tagName: 'VIDEO', runtimeId: 'deleted-video' } as unknown as HTMLVideoElement;
    const firstClip = mockClip({
      id: 'deleted-runtime-clip',
      mediaFileId: 'media-1',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        videoElement: oldVideo,
        naturalDuration: 12,
      },
    });

    mocks.setTimelineState({ clips: [firstClip] });
    getHistoryStateView().captureSnapshot('initial runtime');
    mocks.setTimelineState({ clips: [] });
    getHistoryStateView().captureSnapshot('delete runtime');

    getHistoryStateView().undo();
    const restoredClip = mocks.timeline.getState().clips[0];

    expect(restoredClip.id).toBe('deleted-runtime-clip');
    expect(restoredClip.source?.videoElement).toBeUndefined();
    expect(restoredClip.source?.mediaFileId).toBe('media-1');
    expect(restoredClip.mediaFileId).toBe('media-1');
    expect(restoredClip.needsReload).toBe(true);
  });

  it('undo: returns the label of the action being undone', () => {
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 100 });
    getHistoryStateView().captureSnapshot('zoom change');

    const result = getHistoryStateView().undo();

    expect(result).toEqual({ operation: 'undo', label: 'zoom change' });
  });

  it('redo: restores undone state', () => {
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 100 });
    getHistoryStateView().captureSnapshot('zoom 100');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(50);

    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(100);
    expect(getHistoryStateView().redoStack.length).toBe(0);
    expect(getHistoryStateView().undoStack.length).toBe(1);
  });

  it('redo: returns the label of the action being redone', () => {
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 100 });
    getHistoryStateView().captureSnapshot('zoom 100');
    getHistoryStateView().undo();

    const result = getHistoryStateView().redo();

    expect(result).toEqual({ operation: 'redo', label: 'zoom 100' });
  });

  it('canUndo / canRedo: reflect stack state', () => {
    expect(getHistoryStateView().canUndo()).toBe(false);
    expect(getHistoryStateView().canRedo()).toBe(false);

    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');

    expect(getHistoryStateView().canUndo()).toBe(true);
    expect(getHistoryStateView().canRedo()).toBe(false);

    getHistoryStateView().undo();
    expect(getHistoryStateView().canUndo()).toBe(false);
    expect(getHistoryStateView().canRedo()).toBe(true);
  });

  it('getHistoryEntries: lists undoable, current, and redoable snapshots', () => {
    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');
    getHistoryStateView().captureSnapshot('c');

    getHistoryStateView().undo();

    expect(getHistoryStateView().getHistoryEntries().map((entry) => ({
      kind: entry.kind,
      label: entry.label,
    }))).toEqual([
      { kind: 'undoable', label: 'a' },
      { kind: 'current', label: 'b' },
      { kind: 'redoable', label: 'c' },
    ]);
  });

  it('project persistence: serializes and hydrates visible history metadata', () => {
    mocks.setTimelineState({ zoom: 10 });
    getHistoryStateView().captureSnapshot('zoom 10');
    mocks.setTimelineState({ zoom: 20 });
    getHistoryStateView().captureSnapshot('zoom 20');

    const persisted = serializeHistoryStateForProject();
    getHistoryStateView().clearHistory();
    mocks.setTimelineState({ zoom: 999 });

    hydrateHistoryStateFromProject(persisted);
    expect(getHistoryStateView().getHistoryEntries().map((entry) => entry.label))
      .toEqual(['zoom 10', 'zoom 20']);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo', label: 'zoom 20' });
    expect(mocks.timeline.getState().zoom).toBe(10);
  });

  it('project persistence: strips browser-only media payloads from snapshots', () => {
    const file = new File(['payload'], 'clip.mp4', { type: 'video/mp4' });
    mocks.setMediaState({
      files: [
        mockMediaFile({
          file,
          url: 'blob:video-url',
          thumbnailUrl: 'blob:thumb-url',
          proxyVideoUrl: 'blob:proxy-url',
        }),
      ],
    });

    getHistoryStateView().captureSnapshot('with media file');
    const serialized = JSON.stringify(serializeHistoryStateForProject());

    expect(serialized).not.toContain('blob:');
    expect(serialized).not.toContain('"file"');
  });

  // ─── Batch operations ────────────────────────────────────────────────

  it('startBatch / endBatch: groups changes into one undo step', () => {
    getHistoryStateView().captureSnapshot('initial');
    expect(getHistoryStateView().undoStack.length).toBe(0);

    getHistoryStateView().startBatch('batch op');

    // Multiple state changes during batch
    mocks.setTimelineState({ zoom: 80 });
    mocks.setTimelineState({ zoom: 120 });

    getHistoryStateView().endBatch();

    // Only one entry should be in undo stack
    expect(getHistoryStateView().undoStack.length).toBe(1);
    expect(getHistoryStateView().currentSnapshot!.label).toBe('batch op');
  });

  it('startBatch: ignored if already batching', () => {
    getHistoryStateView().startBatch('first');
    const batchId = getHistoryStateView().batchId;
    getHistoryStateView().startBatch('second');
    // Should not change
    expect(getHistoryStateView().batchId).toBe(batchId);
    expect(getHistoryStateView().batchLabel).toBe('first');
    getHistoryStateView().endBatch();
  });

  it('endBatch: no-op if not batching', () => {
    getHistoryStateView().endBatch(); // should not throw
    expect(getHistoryStateView().batchId).toBeNull();
  });

  // ─── Map serialization ───────────────────────────────────────────────

  it('snapshot serializes Map<string, Keyframe[]> to Record', () => {
    const keyframeMap = new Map([
      ['clip-1', [{ id: 'kf1', clipId: 'clip-1', time: 0, property: 'opacity', value: 1, easing: 'linear' }]],
    ]);
    mocks.setTimelineState({ clipKeyframes: keyframeMap });

    getHistoryStateView().captureSnapshot('with keyframes');
    const snapshot = getHistoryStateView().currentSnapshot!;
    // Should be serialized to Record, not Map
    expect(snapshot.timeline.clipKeyframes).toHaveProperty('clip-1');
    expect(Array.isArray(snapshot.timeline.clipKeyframes['clip-1'])).toBe(true);
  });

  it('undo restores Map from Record (deserialization)', () => {
    // Set up initial state with Map
    const keyframeMap = new Map([
      ['clip-1', [{ id: 'kf1', clipId: 'clip-1', time: 0, property: 'opacity', value: 1, easing: 'linear' }]],
    ]);
    mocks.setTimelineState({ clipKeyframes: keyframeMap });
    getHistoryStateView().captureSnapshot('with keyframes');

    // Change keyframes
    mocks.setTimelineState({ clipKeyframes: new Map() });
    getHistoryStateView().captureSnapshot('removed keyframes');

    // Undo should restore the Map
    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().clipKeyframes;
    expect(restored instanceof Map).toBe(true);
    expect(restored.get('clip-1')?.length).toBe(1);
  });

  it('undo restores Set from array (selectedClipIds)', () => {
    mocks.setTimelineState({ selectedClipIds: new Set(['a', 'b']) });
    getHistoryStateView().captureSnapshot('with selection');

    mocks.setTimelineState({ selectedClipIds: new Set() });
    getHistoryStateView().captureSnapshot('cleared');

    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().selectedClipIds;
    expect(restored instanceof Set).toBe(true);
    expect(restored.has('a')).toBe(true);
    expect(restored.has('b')).toBe(true);
  });

  // ─── clearHistory ────────────────────────────────────────────────────

  it('clearHistory: resets all stacks', () => {
    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');
    getHistoryStateView().clearHistory();
    const state = getHistoryStateView();
    expect(state.undoStack.length).toBe(0);
    expect(state.redoStack.length).toBe(0);
    expect(state.currentSnapshot).toBeNull();
  });

  // ─── History size limit ──────────────────────────────────────────────

  it('respects maxHistorySize', () => {
    useHistoryStore.setState({ maxHistoryNodes: 3 });
    for (let i = 0; i < 6; i++) {
      getHistoryStateView().captureSnapshot(`action-${i}`);
    }
    // 5 captures create 5 undo entries (first becomes current, next 5 push)
    // But capped at 3
    expect(getHistoryStateView().undoStack.length).toBeLessThanOrEqual(3);
  });

  it('respects maxHistorySize: oldest entries are removed first', () => {
    useHistoryStore.setState({ maxHistoryNodes: 3 });
    for (let i = 0; i < 6; i++) {
      getHistoryStateView().captureSnapshot(`action-${i}`);
    }
    const state = getHistoryStateView();
    // The oldest labels should have been shifted out
    const labels = state.undoStack.map((s) => s.label);
    expect(labels).not.toContain('action-0');
    expect(labels).not.toContain('action-1');
    // Current snapshot should be the latest
    expect(state.currentSnapshot!.label).toBe('action-5');
  });

  // ─── Undo edge cases ──────────────────────────────────────────────

  it('undo: no-op when undo stack is empty', () => {
    getHistoryStateView().captureSnapshot('only');
    const stateBefore = getHistoryStateView();
    expect(stateBefore.undoStack.length).toBe(0);

    getHistoryStateView().undo(); // should not throw

    const stateAfter = getHistoryStateView();
    expect(stateAfter.undoStack.length).toBe(0);
    expect(stateAfter.redoStack.length).toBe(0);
    expect(stateAfter.currentSnapshot!.label).toBe('only');
  });

  it('undo: no-op when no snapshots exist at all', () => {
    getHistoryStateView().undo(); // should not throw
    expect(getHistoryStateView().currentSnapshot).toBeNull();
    expect(getHistoryStateView().undoStack.length).toBe(0);
    expect(getHistoryStateView().redoStack.length).toBe(0);
  });

  it('redo: no-op when redo stack is empty', () => {
    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');

    getHistoryStateView().redo(); // should not throw, redo is empty

    const state = getHistoryStateView();
    expect(state.currentSnapshot!.label).toBe('b');
    expect(state.undoStack.length).toBe(1);
    expect(state.redoStack.length).toBe(0);
  });

  // ─── Multiple sequential undo/redo ─────────────────────────────────

  it('undo/redo: blocked while timeline export is active', () => {
    mocks.setTimelineState({ zoom: 10 });
    getHistoryStateView().captureSnapshot('zoom-10');
    mocks.setTimelineState({ zoom: 20 });
    getHistoryStateView().captureSnapshot('zoom-20');
    mocks.setTimelineState({ isExporting: true });

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);
    expect(getHistoryStateView().currentSnapshot!.label).toBe('zoom-20');

    mocks.setTimelineState({ isExporting: false });
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);

    mocks.setTimelineState({ isExporting: true });
    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(10);
  });

  it('multiple sequential undos restore state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    getHistoryStateView().captureSnapshot('zoom-10');

    mocks.setTimelineState({ zoom: 20 });
    getHistoryStateView().captureSnapshot('zoom-20');

    mocks.setTimelineState({ zoom: 30 });
    getHistoryStateView().captureSnapshot('zoom-30');

    // Undo to zoom-20
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);
    expect(getHistoryStateView().undoStack.length).toBe(1);
    expect(getHistoryStateView().redoStack.length).toBe(1);

    // Undo to zoom-10
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);
    expect(getHistoryStateView().undoStack.length).toBe(0);
    expect(getHistoryStateView().redoStack.length).toBe(2);
  });

  it('multiple sequential redos restore state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    getHistoryStateView().captureSnapshot('zoom-10');

    mocks.setTimelineState({ zoom: 20 });
    getHistoryStateView().captureSnapshot('zoom-20');

    mocks.setTimelineState({ zoom: 30 });
    getHistoryStateView().captureSnapshot('zoom-30');

    // Undo twice
    getHistoryStateView().undo();
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);

    // Redo to zoom-20
    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(20);
    expect(getHistoryStateView().redoStack.length).toBe(1);

    // Redo to zoom-30
    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(30);
    expect(getHistoryStateView().redoStack.length).toBe(0);
  });

  it('interleaved undo/redo preserves state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    getHistoryStateView().captureSnapshot('z10');

    mocks.setTimelineState({ zoom: 20 });
    getHistoryStateView().captureSnapshot('z20');

    mocks.setTimelineState({ zoom: 30 });
    getHistoryStateView().captureSnapshot('z30');

    // Undo to z20
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);

    // Redo back to z30
    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(30);

    // Undo to z20 again
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);

    // Undo to z10
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);

    // Redo to z20
    getHistoryStateView().redo();
    expect(mocks.timeline.getState().zoom).toBe(20);
  });

  // ─── Undo/redo ends stuck batches ──────────────────────────────────

  it('undo: ends stuck batch before undoing', () => {
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 80 });
    getHistoryStateView().captureSnapshot('zoom-80');

    // Start a batch but "forget" to end it (simulate lost mouseup)
    getHistoryStateView().startBatch('stuck-batch');
    mocks.setTimelineState({ zoom: 150 });

    // Undo should first end the batch, then undo
    getHistoryStateView().undo();

    // Batch should be ended
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().batchLabel).toBeNull();
  });

  it('redo: ends stuck batch before redoing', () => {
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 80 });
    getHistoryStateView().captureSnapshot('zoom-80');

    // Undo to create redo entry
    getHistoryStateView().undo();

    // Start a batch but "forget" to end it
    getHistoryStateView().startBatch('stuck-batch');

    // Redo should first end the batch
    getHistoryStateView().redo();

    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().batchLabel).toBeNull();
  });

  // ─── Batch advanced scenarios ──────────────────────────────────────

  it('endBatch: clears redo stack', () => {
    getHistoryStateView().captureSnapshot('initial');
    mocks.setTimelineState({ zoom: 80 });
    getHistoryStateView().captureSnapshot('zoom-80');

    // Undo to create redo entries
    getHistoryStateView().undo();
    expect(getHistoryStateView().redoStack.length).toBe(1);

    // Start and end a batch — should clear redo
    getHistoryStateView().startBatch('new-batch');
    mocks.setTimelineState({ zoom: 200 });
    getHistoryStateView().endBatch();

    expect(getHistoryStateView().redoStack.length).toBe(0);
  });

  it('startBatch: creates currentSnapshot if none exists', () => {
    expect(getHistoryStateView().currentSnapshot).toBeNull();

    getHistoryStateView().startBatch('from-scratch');

    // startBatch should have auto-created a snapshot
    expect(getHistoryStateView().currentSnapshot).not.toBeNull();
    expect(getHistoryStateView().currentSnapshot!.label).toBe('initial');
    expect(getHistoryStateView().batchId).not.toBeNull();

    getHistoryStateView().endBatch();
  });

  it('endBatch without prior currentSnapshot: only sets currentSnapshot', () => {
    // Manually reset to ensure no currentSnapshot
    useHistoryStore.setState({
      nodes: {},
      rootId: null,
      activeNodeId: null,
      lastVisitedChildByNodeId: {},
      batchId: Date.now(),
      batchLabel: 'test',
    });
    getHistoryStateView().endBatch();

    // When currentSnapshot is null during endBatch, it should just set the final snapshot
    const state = getHistoryStateView();
    expect(state.currentSnapshot).not.toBeNull();
    expect(state.currentSnapshot!.label).toBe('test');
    expect(state.undoStack.length).toBe(0); // no previous snapshot to push
    expect(state.batchId).toBeNull();
    expect(state.batchLabel).toBeNull();
  });

  it('endBatch respects maxHistorySize', () => {
    // Tree capacity includes the current snapshot in addition to undoable nodes.
    useHistoryStore.setState({ maxHistoryNodes: 3 });

    // Fill undo stack
    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');
    getHistoryStateView().captureSnapshot('c');
    // undoStack should already be capped at 2
    expect(getHistoryStateView().undoStack.length).toBe(2);

    // Do a batch — should also respect cap
    getHistoryStateView().startBatch('batch');
    mocks.setTimelineState({ zoom: 999 });
    getHistoryStateView().endBatch();

    expect(getHistoryStateView().undoStack.length).toBeLessThanOrEqual(2);
  });

  it('batch then undo restores pre-batch state', () => {
    mocks.setTimelineState({ zoom: 50 });
    getHistoryStateView().captureSnapshot('initial');

    getHistoryStateView().startBatch('drag resize');
    mocks.setTimelineState({ zoom: 60 });
    mocks.setTimelineState({ zoom: 70 });
    mocks.setTimelineState({ zoom: 80 });
    getHistoryStateView().endBatch();

    expect(mocks.timeline.getState().zoom).toBe(80);

    // Undo the entire batch
    getHistoryStateView().undo();
    expect(mocks.timeline.getState().zoom).toBe(50);
  });

  it('batch undo restores legacy transition links and removes the upgraded composition', () => {
    const legacyLink = { id: 'transition-1', type: 'crossfade' as const, duration: 1, linkedClipId: 'in', compositionId: 'legacy' };
    const outgoing = mockClip({ id: 'out', transitionOut: legacyLink });
    const incoming = mockClip({ id: 'in', transitionIn: { ...legacyLink, linkedClipId: 'out' } });
    const parent = mockComposition({
      id: 'parent',
      timelineData: { tracks: [], clips: [outgoing, incoming], duration: 10 } as never,
    });
    const legacy = mockComposition({
      id: 'legacy',
      transitionComp: {
        kind: 'transition-comp',
        sourceLayout: 'legacy-segmented',
        parentCompositionId: parent.id,
        parentTransitionId: legacyLink.id,
        parentOutgoingClipId: outgoing.id,
        parentIncomingClipId: incoming.id,
        linkedOutgoingClipId: 'legacy-out',
        linkedIncomingClipId: 'legacy-in',
        innerTransitionId: 'legacy-inner',
        paddingBefore: 0,
        paddingAfter: 0,
        bodyStart: 0,
        bodyEnd: 1,
      },
    });
    const mappedId = 'mapped';
    const upgradedParent = {
      ...parent,
      timelineData: {
        ...parent.timelineData!,
        clips: parent.timelineData!.clips.map((clip) => (
          clip.id === outgoing.id
            ? { ...clip, transitionOut: { ...clip.transitionOut!, compositionId: mappedId } }
            : { ...clip, transitionIn: { ...clip.transitionIn!, compositionId: mappedId } }
        )),
      },
    };
    const upgraded = mockComposition({
      id: mappedId,
      transitionComp: {
        ...legacy.transitionComp!,
        sourceLayout: 'mapped-v3',
        legacyBackupCompositionId: legacy.id,
      },
    });

    mocks.setMediaState({ compositions: [parent, legacy] });
    getHistoryStateView().startBatch('Upgrade transition composition');
    mocks.setMediaState({ compositions: [upgradedParent, legacy, upgraded] });
    getHistoryStateView().endBatch();

    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().currentSnapshot?.label).toBe('Upgrade transition composition');

    getHistoryStateView().undo();

    const restoredCompositions = mocks.media.getState().compositions;
    const restoredParent = restoredCompositions.find((composition) => composition.id === parent.id)!;
    expect(restoredCompositions.map((composition) => composition.id)).toEqual([parent.id, legacy.id]);
    expect(restoredParent.timelineData?.clips.find((clip) => clip.id === outgoing.id)?.transitionOut?.compositionId)
      .toBe(legacy.id);
    expect(restoredParent.timelineData?.clips.find((clip) => clip.id === incoming.id)?.transitionIn?.compositionId)
      .toBe(legacy.id);
  });

  // ─── Media state undo/redo ─────────────────────────────────────────

  it('undo/redo restores media state (files)', () => {
    mocks.setMediaState({ files: [mockMediaFile({ id: 'f1', name: 'file1.mp4' })] });
    getHistoryStateView().captureSnapshot('add file');

    mocks.setMediaState({ files: [] });
    getHistoryStateView().captureSnapshot('remove file');

    expect(mocks.media.getState().files.length).toBe(0);

    getHistoryStateView().undo();
    expect(mocks.media.getState().files.length).toBe(1);
    expect(mocks.media.getState().files[0].id).toBe('f1');

    getHistoryStateView().redo();
    expect(mocks.media.getState().files.length).toBe(0);
  });

  it('undo/redo restores media state (compositions)', () => {
    mocks.setMediaState({
      compositions: [mockComposition({ id: 'comp1', name: 'Main' })],
    });
    getHistoryStateView().captureSnapshot('add comp');

    mocks.setMediaState({
      compositions: [
        mockComposition({ id: 'comp1', name: 'Main' }),
        mockComposition({ id: 'comp2', name: 'Secondary' }),
      ],
    });
    getHistoryStateView().captureSnapshot('add comp2');

    getHistoryStateView().undo();
    expect(mocks.media.getState().compositions.length).toBe(1);
    expect(mocks.media.getState().compositions[0].name).toBe('Main');
  });

  it('undo/redo restores media state (folders)', () => {
    mocks.setMediaState({ folders: [mockFolder({ id: 'folder1', name: 'Clips' })] });
    getHistoryStateView().captureSnapshot('add folder');

    mocks.setMediaState({ folders: [] });
    getHistoryStateView().captureSnapshot('remove folder');

    getHistoryStateView().undo();
    expect(mocks.media.getState().folders.length).toBe(1);
  });

  it('undo/redo restores media selectedIds and expandedFolderIds', () => {
    mocks.setMediaState({ selectedIds: ['a', 'b'], expandedFolderIds: ['f1'] });
    getHistoryStateView().captureSnapshot('select');

    mocks.setMediaState({ selectedIds: [], expandedFolderIds: [] });
    getHistoryStateView().captureSnapshot('deselect');

    getHistoryStateView().undo();
    expect(mocks.media.getState().selectedIds).toEqual(['a', 'b']);
    expect(mocks.media.getState().expandedFolderIds).toEqual(['f1']);
  });

  it('undo/redo restores textItems and solidItems', () => {
    mocks.setMediaState({
      textItems: [mockTextItem({ id: 't1', text: 'Hello' })],
      solidItems: [mockSolidItem({ id: 's1', color: '#ff0000' })],
    });
    getHistoryStateView().captureSnapshot('add items');

    mocks.setMediaState({ textItems: [], solidItems: [] });
    getHistoryStateView().captureSnapshot('clear items');

    getHistoryStateView().undo();
    expect(mocks.media.getState().textItems.length).toBe(1);
    expect(mocks.media.getState().solidItems.length).toBe(1);
  });

  // ─── Dock state undo/redo ──────────────────────────────────────────

  it('undo/redo restores dock layout', () => {
    mocks.dock.setState({ layout: { type: 'row', children: [] } });
    getHistoryStateView().captureSnapshot('layout-1');

    mocks.dock.setState({ layout: { type: 'col', children: [{ id: 'panel' }] } });
    getHistoryStateView().captureSnapshot('layout-2');

    getHistoryStateView().undo();
    expect(mocks.dock.getState().layout).toEqual({ type: 'row', children: [] });

    getHistoryStateView().redo();
    expect(mocks.dock.getState().layout).toEqual({ type: 'col', children: [{ id: 'panel' }] });
  });

  // ─── Timeline state: tracks, layers, markers ──────────────────────

  it('undo/redo restores tracks', () => {
    const track1 = { id: 'v1', name: 'V1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false };
    const track2 = { id: 'v2', name: 'V2', type: 'video' as const, height: 60, muted: false, visible: true, solo: false };

    mocks.setTimelineState({ tracks: [track1] });
    getHistoryStateView().captureSnapshot('one track');

    mocks.setTimelineState({ tracks: [track1, track2] });
    getHistoryStateView().captureSnapshot('two tracks');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().tracks.length).toBe(1);
    expect(mocks.timeline.getState().tracks[0].id).toBe('v1');
  });

  it('undo/redo restores clips', () => {
    const clip1 = mockClip({ id: 'c1', trackId: 'v1', startFrame: 0, endFrame: 100, mediaId: 'm1' });
    mocks.setTimelineState({ clips: [] });
    getHistoryStateView().captureSnapshot('no clips');

    mocks.setTimelineState({ clips: [clip1] });
    getHistoryStateView().captureSnapshot('one clip');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().clips.length).toBe(0);

    getHistoryStateView().redo();
    expect(mocks.timeline.getState().clips.length).toBe(1);
    expect(mocks.timeline.getState().clips[0].id).toBe('c1');
  });

  it('undo/redo restores markers', () => {
    mocks.setTimelineState({ markers: [] });
    getHistoryStateView().captureSnapshot('no markers');

    mocks.setTimelineState({ markers: [{ id: 'm1', time: 100, color: 'red', label: 'mark1' }] });
    getHistoryStateView().captureSnapshot('one marker');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().markers.length).toBe(0);

    getHistoryStateView().redo();
    expect(mocks.timeline.getState().markers.length).toBe(1);
  });

  it('undo/redo restores layers', () => {
    mocks.setTimelineState({ layers: [mockLayer({ id: 'L1', name: 'Layer 1' })] });
    getHistoryStateView().captureSnapshot('one layer');

    mocks.setTimelineState({ layers: [] });
    getHistoryStateView().captureSnapshot('no layers');

    getHistoryStateView().undo();
    const restoredLayers = mocks.timeline.getState().layers;
    expect(restoredLayers.length).toBe(1);
    expect(restoredLayers[0].id).toBe('L1');
  });

  it('undo/redo restores selectedLayerId', () => {
    mocks.setTimelineState({ selectedLayerId: 'L1' });
    getHistoryStateView().captureSnapshot('selected');

    mocks.setTimelineState({ selectedLayerId: null });
    getHistoryStateView().captureSnapshot('deselected');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().selectedLayerId).toBe('L1');
  });

  it('undo/redo restores scrollX', () => {
    mocks.setTimelineState({ scrollX: 0 });
    getHistoryStateView().captureSnapshot('scroll-0');

    mocks.setTimelineState({ scrollX: 500 });
    getHistoryStateView().captureSnapshot('scroll-500');

    getHistoryStateView().undo();
    expect(mocks.timeline.getState().scrollX).toBe(0);
  });

  // ─── Snapshot deep clone isolation ─────────────────────────────────

  it('snapshots are deep cloned: mutating source does not affect snapshot', () => {
    const clips = [mockClip({ id: 'c1', trackId: 'v1', startTime: 0, duration: 100, startFrame: 0, endFrame: 100 })];
    mocks.setTimelineState({ clips });
    getHistoryStateView().captureSnapshot('with clips');

    // Mutate the original array
    clips[0].startTime = 999;
    clips[0].endFrame = 999;
    clips.push({ id: 'c2', trackId: 'v1', startFrame: 200, endFrame: 300 });

    const snapshot = getHistoryStateView().currentSnapshot!;
    // Snapshot should not be affected
    expect(snapshot.timeline.clips.length).toBe(1);
    expect(snapshot.timeline.clips[0].startTime).toBe(0);
    expect(snapshot.timelineEditState?.timeline.clips[0].startTime).toBe(0);
    expect((snapshot.timeline.clips[0] as LegacyClip).endFrame).toBeUndefined();
  });

  it('snapshots are deep cloned: mutating snapshot does not affect subsequent undo', () => {
    mocks.setTimelineState({ clips: [mockClip({ id: 'c1', startFrame: 0, endFrame: 100 })] });
    getHistoryStateView().captureSnapshot('initial');

    mocks.setTimelineState({ clips: [mockClip({ id: 'c1', startFrame: 0, endFrame: 200 })] });
    getHistoryStateView().captureSnapshot('modified');

    // Mutate the undo stack snapshot directly (should not matter for undo)
    const undoSnapshot = getHistoryStateView().undoStack[0];
    (undoSnapshot.timeline.clips[0] as LegacyClip).endFrame = 9999;

    // Undo - the applySnapshot deep clones again, so the mutation above
    // means the applied state will have the mutated value.
    // This test validates that the store's state after undo reflects
    // what was in the undo stack (even if mutated).
    getHistoryStateView().undo();
    // The timeline should have the value from the undo stack snapshot
    expect(mocks.timeline.getState().clips.length).toBe(1);
  });

  // ─── selectedClipIds serialization in snapshot ─────────────────────

  it('snapshot serializes Set<string> to array for selectedClipIds', () => {
    mocks.setTimelineState({ selectedClipIds: new Set(['x', 'y', 'z']) });
    getHistoryStateView().captureSnapshot('selected');

    const snapshot = getHistoryStateView().currentSnapshot!;
    // Should be array in snapshot, not Set
    expect(Array.isArray(snapshot.timeline.selectedClipIds)).toBe(true);
    expect(snapshot.timeline.selectedClipIds).toContain('x');
    expect(snapshot.timeline.selectedClipIds).toContain('y');
    expect(snapshot.timeline.selectedClipIds).toContain('z');
  });

  // ─── setIsApplying ─────────────────────────────────────────────────

  it('setIsApplying: sets isApplying flag', () => {
    expect(getHistoryStateView().isApplying).toBe(false);

    getHistoryStateView().setIsApplying(true);
    expect(getHistoryStateView().isApplying).toBe(true);

    getHistoryStateView().setIsApplying(false);
    expect(getHistoryStateView().isApplying).toBe(false);
  });

  // ─── setHistoryCallbacks: flushPendingCapture ──────────────────────

  it('undo calls flushPendingCapture callback', () => {
    const flushFn = vi.fn();
    const suppressFn = vi.fn();
    setHistoryCallbacks({ flushPendingCapture: flushFn, suppressCaptures: suppressFn });

    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');
    // Explicit captures now suppress the trailing auto-capture fallback too;
    // clear so this assertion isolates undo's own suppression call.
    suppressFn.mockClear();

    getHistoryStateView().undo();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledTimes(1);

    // Clean up: reset callbacks to avoid affecting other tests
    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  });

  it('explicit captureSnapshot suppresses the auto-capture fallback; isAutoCapture does not', () => {
    const suppressFn = vi.fn();
    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: suppressFn });

    // Explicit (slice) capture → suppress the trailing debounced fallback so one
    // edit is one undo step.
    getHistoryStateView().captureSnapshot('explicit');
    expect(suppressFn).toHaveBeenCalledTimes(1);

    // The fallback path itself must NOT self-suppress, or it would swallow the
    // next distinct auto-captured edit.
    getHistoryStateView().captureSnapshot('auto', { isAutoCapture: true });
    expect(suppressFn).toHaveBeenCalledTimes(1);

    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  });

  it('redo calls flushPendingCapture callback', () => {
    const flushFn = vi.fn();
    const suppressFn = vi.fn();
    setHistoryCallbacks({ flushPendingCapture: flushFn, suppressCaptures: suppressFn });

    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');
    getHistoryStateView().undo();
    flushFn.mockClear();
    suppressFn.mockClear();

    getHistoryStateView().redo();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledTimes(1);

    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  });

  // ─── Convenience exports ───────────────────────────────────────────

  it('convenience captureSnapshot function works', () => {
    captureSnapshotFn('via-export');
    expect(getHistoryStateView().currentSnapshot).not.toBeNull();
    expect(getHistoryStateView().currentSnapshot!.label).toBe('via-export');
  });

  it('convenience undo/redo functions work', () => {
    captureSnapshotFn('a');
    mocks.setTimelineState({ zoom: 75 });
    captureSnapshotFn('b');

    undoFn();
    expect(mocks.timeline.getState().zoom).toBe(50);

    redoFn();
    expect(mocks.timeline.getState().zoom).toBe(75);
  });

  it('convenience startBatch/endBatch functions work', () => {
    captureSnapshotFn('initial');

    startBatchFn('batch');
    mocks.setTimelineState({ zoom: 200 });
    endBatchFn();

    expect(getHistoryStateView().undoStack.length).toBe(1);
    expect(getHistoryStateView().currentSnapshot!.label).toBe('batch');
  });

  // ─── Snapshot timestamp ────────────────────────────────────────────

  it('snapshot includes timestamp', () => {
    const before = Date.now();
    getHistoryStateView().captureSnapshot('timed');
    const after = Date.now();

    const snapshot = getHistoryStateView().currentSnapshot!;
    expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
    expect(snapshot.timestamp).toBeLessThanOrEqual(after);
  });

  // ─── Full round-trip: multi-store state ────────────────────────────

  it('full round-trip: undo restores all three stores atomically', () => {
    // Set up initial state across all stores
    mocks.setTimelineState({ zoom: 50, clips: [], tracks: [{ id: 'v1', name: 'V1', type: 'video', height: 60, muted: false, visible: true, solo: false }] });
    mocks.setMediaState({ files: [mockMediaFile({ id: 'f1', name: 'vid.mp4' })], selectedIds: ['f1'] });
    mocks.dock.setState({ layout: { type: 'row' } });
    getHistoryStateView().captureSnapshot('initial-state');

    // Change all stores simultaneously
    mocks.setTimelineState({ zoom: 150, clips: [mockClip({ id: 'c1' })] });
    mocks.setMediaState({ files: [], selectedIds: [] });
    mocks.dock.setState({ layout: { type: 'col' } });
    getHistoryStateView().captureSnapshot('changed-state');

    // Undo should restore all three stores
    getHistoryStateView().undo();

    expect(mocks.timeline.getState().zoom).toBe(50);
    expect(mocks.timeline.getState().clips.length).toBe(0);
    expect(mocks.media.getState().files.length).toBe(1);
    expect(mocks.media.getState().selectedIds).toEqual(['f1']);
    expect(mocks.dock.getState().layout).toEqual({ type: 'row' });
  });

  it('redo after undo restores the changed state for all stores', () => {
    mocks.setTimelineState({ zoom: 50 });
    mocks.setMediaState({ files: [] });
    mocks.dock.setState({ layout: { type: 'row' } });
    getHistoryStateView().captureSnapshot('before');

    mocks.setTimelineState({ zoom: 200 });
    mocks.setMediaState({ files: [mockMediaFile({ id: 'f2', name: 'pic.jpg' })] });
    mocks.dock.setState({ layout: { type: 'tabs' } });
    getHistoryStateView().captureSnapshot('after');

    getHistoryStateView().undo();
    getHistoryStateView().redo();

    expect(mocks.timeline.getState().zoom).toBe(200);
    expect(mocks.media.getState().files.length).toBe(1);
    expect(mocks.dock.getState().layout).toEqual({ type: 'tabs' });
  });

  // ─── Empty Map/Set edge cases ──────────────────────────────────────

  it('undo restores empty Map for clipKeyframes', () => {
    mocks.setTimelineState({ clipKeyframes: new Map() });
    getHistoryStateView().captureSnapshot('empty map');

    const kfMap = new Map([['clip-x', [{ id: 'kf1', clipId: 'clip-x', time: 0, property: 'opacity', value: 1, easing: 'linear' }]]]);
    mocks.setTimelineState({ clipKeyframes: kfMap });
    getHistoryStateView().captureSnapshot('with kfs');

    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().clipKeyframes;
    expect(restored instanceof Map).toBe(true);
    expect(restored.size).toBe(0);
  });

  it('undo restores empty Set for selectedClipIds', () => {
    mocks.setTimelineState({ selectedClipIds: new Set() });
    getHistoryStateView().captureSnapshot('empty');

    mocks.setTimelineState({ selectedClipIds: new Set(['a']) });
    getHistoryStateView().captureSnapshot('selected');

    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().selectedClipIds;
    expect(restored instanceof Set).toBe(true);
    expect(restored.size).toBe(0);
  });

  // ─── Keyframe round-trip with multiple clips ──────────────────────

  it('undo/redo preserves keyframes across multiple clips', () => {
    const kfMap = new Map([
      ['clip-a', [
        { id: 'kf1', clipId: 'clip-a', time: 0, property: 'opacity', value: 1, easing: 'linear' },
        { id: 'kf2', clipId: 'clip-a', time: 30, property: 'opacity', value: 0, easing: 'easeIn' },
      ]],
      ['clip-b', [
        { id: 'kf3', clipId: 'clip-b', time: 10, property: 'scale', value: 1.5, easing: 'linear' },
      ]],
    ]);
    mocks.setTimelineState({ clipKeyframes: kfMap });
    getHistoryStateView().captureSnapshot('multi-clip kf');

    // Remove all keyframes
    mocks.setTimelineState({ clipKeyframes: new Map() });
    getHistoryStateView().captureSnapshot('cleared kf');

    // Undo
    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().clipKeyframes;
    expect(restored instanceof Map).toBe(true);
    expect(restored.size).toBe(2);
    expect(restored.get('clip-a')?.length).toBe(2);
    expect(restored.get('clip-b')?.length).toBe(1);
    expect(restored.get('clip-a')?.[1]?.easing).toBe('easeIn');
  });

  // ─── clearHistory does not affect external stores ──────────────────

  it('clearHistory does not modify external store state', () => {
    mocks.setTimelineState({ zoom: 123 });
    mocks.setMediaState({ selectedIds: ['x'] });
    getHistoryStateView().captureSnapshot('a');
    getHistoryStateView().captureSnapshot('b');

    getHistoryStateView().clearHistory();

    // External stores should be untouched
    expect(mocks.timeline.getState().zoom).toBe(123);
    expect(mocks.media.getState().selectedIds).toEqual(['x']);
  });

  // ─── Layer source preservation ─────────────────────────────────────

  it('undo preserves existing layer source references', () => {
    const fakeSource = { type: 'video', element: 'mock-element' } as unknown as Layer['source'];
    mocks.setTimelineState({
      layers: [mockLayer({ id: 'L1', name: 'Layer 1', source: fakeSource })],
    });
    getHistoryStateView().captureSnapshot('with source');

    // Change layers
    mocks.setTimelineState({
      layers: [mockLayer({ id: 'L1', name: 'Layer 1 modified', source: fakeSource })],
    });
    getHistoryStateView().captureSnapshot('modified');

    // Undo — should preserve the source reference from current state
    getHistoryStateView().undo();
    const restored = mocks.timeline.getState().layers;
    expect(restored.length).toBe(1);
    expect(restored[0].source).toBe(fakeSource);
  });
});
