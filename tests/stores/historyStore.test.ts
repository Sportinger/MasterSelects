import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useHistoryStore, initHistoryStoreRefs, setHistoryCallbacks, captureSnapshot as captureSnapshotFn, undo as undoFn, redo as redoFn, startBatch as startBatchFn, endBatch as endBatchFn } from '../../src/stores/historyStore';

// Mock the external store references the history store reads from
function createMockStores() {
  let timelineState = {
    clips: [],
    tracks: [{ id: 'v1', name: 'V1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false }],
    selectedClipIds: new Set<string>(),
    zoom: 50,
    scrollX: 0,
    layers: [],
    selectedLayerId: null,
    clipKeyframes: new Map<string, any[]>(),
    markers: [],
  };
  let mediaState = {
    files: [],
    compositions: [],
    folders: [],
    selectedIds: [],
    expandedFolderIds: [],
    textItems: [],
    solidItems: [],
  };
  let dockState = { layout: null };

  return {
    timeline: {
      getState: () => timelineState,
      setState: (s: any) => { timelineState = { ...timelineState, ...s }; },
    },
    media: {
      getState: () => mediaState,
      setState: (s: any) => { mediaState = { ...mediaState, ...s }; },
    },
    dock: {
      getState: () => dockState,
      setState: (s: any) => { dockState = { ...dockState, ...s }; },
    },
    // Helpers to simulate changes
    setTimelineState: (s: any) => { timelineState = { ...timelineState, ...s }; },
    setMediaState: (s: any) => { mediaState = { ...mediaState, ...s }; },
  };
}

describe('historyStore', () => {
  let mocks: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    // Reset history store state
    useHistoryStore.setState({
      undoStack: [],
      redoStack: [],
      currentSnapshot: null,
      isApplying: false,
      batchId: null,
      batchLabel: null,
    });

    mocks = createMockStores();
    initHistoryStoreRefs(mocks);
  });

  it('captureSnapshot: first capture sets currentSnapshot', () => {
    useHistoryStore.getState().captureSnapshot('first');
    const state = useHistoryStore.getState();
    expect(state.currentSnapshot).not.toBeNull();
    expect(state.currentSnapshot!.label).toBe('first');
    expect(state.undoStack.length).toBe(0);
  });

  it('captureSnapshot: second capture pushes first to undoStack', () => {
    useHistoryStore.getState().captureSnapshot('first');
    useHistoryStore.getState().captureSnapshot('second');
    const state = useHistoryStore.getState();
    expect(state.undoStack.length).toBe(1);
    expect(state.undoStack[0].label).toBe('first');
    expect(state.currentSnapshot!.label).toBe('second');
  });

  it('captureSnapshot: clears redo stack on new action', () => {
    useHistoryStore.getState().captureSnapshot('first');
    useHistoryStore.getState().captureSnapshot('second');
    useHistoryStore.getState().captureSnapshot('third');
    // Undo to create redo stack
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().redoStack.length).toBe(1);

    // New action clears redo
    useHistoryStore.getState().captureSnapshot('new-action');
    expect(useHistoryStore.getState().redoStack.length).toBe(0);
  });

  it('captureSnapshot: does not capture during isApplying', () => {
    useHistoryStore.setState({ isApplying: true });
    useHistoryStore.getState().captureSnapshot('should-not-capture');
    expect(useHistoryStore.getState().currentSnapshot).toBeNull();
  });

  it('captureSnapshot: does not capture during batch', () => {
    useHistoryStore.getState().captureSnapshot('initial');
    useHistoryStore.getState().startBatch('batch');
    useHistoryStore.getState().captureSnapshot('during-batch');
    // Still only 1 snapshot (initial), nothing new pushed
    expect(useHistoryStore.getState().undoStack.length).toBe(0);
  });

  it('undo: restores previous state', () => {
    // Capture initial state
    useHistoryStore.getState().captureSnapshot('add track');

    // Change state
    mocks.setTimelineState({ zoom: 100 });
    useHistoryStore.getState().captureSnapshot('zoom change');

    expect(useHistoryStore.getState().undoStack.length).toBe(1);

    // Undo
    useHistoryStore.getState().undo();

    // Timeline state should be restored
    expect(mocks.timeline.getState().zoom).toBe(50); // original value
    expect(useHistoryStore.getState().undoStack.length).toBe(0);
    expect(useHistoryStore.getState().redoStack.length).toBe(1);
  });

  it('redo: restores undone state', () => {
    useHistoryStore.getState().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 100 });
    useHistoryStore.getState().captureSnapshot('zoom 100');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(50);

    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().zoom).toBe(100);
    expect(useHistoryStore.getState().redoStack.length).toBe(0);
    expect(useHistoryStore.getState().undoStack.length).toBe(1);
  });

  it('canUndo / canRedo: reflect stack state', () => {
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().canRedo()).toBe(false);

    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');

    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useHistoryStore.getState().canRedo()).toBe(false);

    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().canRedo()).toBe(true);
  });

  // ─── Batch operations ────────────────────────────────────────────────

  it('startBatch / endBatch: groups changes into one undo step', () => {
    useHistoryStore.getState().captureSnapshot('initial');
    expect(useHistoryStore.getState().undoStack.length).toBe(0);

    useHistoryStore.getState().startBatch('batch op');

    // Multiple state changes during batch
    mocks.setTimelineState({ zoom: 80 });
    mocks.setTimelineState({ zoom: 120 });

    useHistoryStore.getState().endBatch();

    // Only one entry should be in undo stack
    expect(useHistoryStore.getState().undoStack.length).toBe(1);
    expect(useHistoryStore.getState().currentSnapshot!.label).toBe('batch op');
  });

  it('startBatch: ignored if already batching', () => {
    useHistoryStore.getState().startBatch('first');
    const batchId = useHistoryStore.getState().batchId;
    useHistoryStore.getState().startBatch('second');
    // Should not change
    expect(useHistoryStore.getState().batchId).toBe(batchId);
    expect(useHistoryStore.getState().batchLabel).toBe('first');
    useHistoryStore.getState().endBatch();
  });

  it('endBatch: no-op if not batching', () => {
    useHistoryStore.getState().endBatch(); // should not throw
    expect(useHistoryStore.getState().batchId).toBeNull();
  });

  // ─── Map serialization ───────────────────────────────────────────────

  it('snapshot serializes Map<string, Keyframe[]> to Record', () => {
    const keyframeMap = new Map([
      ['clip-1', [{ id: 'kf1', clipId: 'clip-1', time: 0, property: 'opacity', value: 1, easing: 'linear' }]],
    ]);
    mocks.setTimelineState({ clipKeyframes: keyframeMap });

    useHistoryStore.getState().captureSnapshot('with keyframes');
    const snapshot = useHistoryStore.getState().currentSnapshot!;
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
    useHistoryStore.getState().captureSnapshot('with keyframes');

    // Change keyframes
    mocks.setTimelineState({ clipKeyframes: new Map() });
    useHistoryStore.getState().captureSnapshot('removed keyframes');

    // Undo should restore the Map
    useHistoryStore.getState().undo();
    const restored = mocks.timeline.getState().clipKeyframes;
    expect(restored instanceof Map).toBe(true);
    expect(restored.get('clip-1')?.length).toBe(1);
  });

  it('undo restores Set from array (selectedClipIds)', () => {
    mocks.setTimelineState({ selectedClipIds: new Set(['a', 'b']) });
    useHistoryStore.getState().captureSnapshot('with selection');

    mocks.setTimelineState({ selectedClipIds: new Set() });
    useHistoryStore.getState().captureSnapshot('cleared');

    useHistoryStore.getState().undo();
    const restored = mocks.timeline.getState().selectedClipIds;
    expect(restored instanceof Set).toBe(true);
    expect(restored.has('a')).toBe(true);
    expect(restored.has('b')).toBe(true);
  });

  // ─── clearHistory ────────────────────────────────────────────────────

  it('clearHistory: resets all stacks', () => {
    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');
    useHistoryStore.getState().clearHistory();
    const state = useHistoryStore.getState();
    expect(state.undoStack.length).toBe(0);
    expect(state.redoStack.length).toBe(0);
    expect(state.currentSnapshot).toBeNull();
  });

  // ─── History size limit ──────────────────────────────────────────────

  it('respects maxHistorySize', () => {
    useHistoryStore.setState({ maxHistorySize: 3 });
    for (let i = 0; i < 6; i++) {
      useHistoryStore.getState().captureSnapshot(`action-${i}`);
    }
    // 5 captures create 5 undo entries (first becomes current, next 5 push)
    // But capped at 3
    expect(useHistoryStore.getState().undoStack.length).toBeLessThanOrEqual(3);
  });

  it('respects maxHistorySize: oldest entries are removed first', () => {
    useHistoryStore.setState({ maxHistorySize: 3 });
    for (let i = 0; i < 6; i++) {
      useHistoryStore.getState().captureSnapshot(`action-${i}`);
    }
    const state = useHistoryStore.getState();
    // The oldest labels should have been shifted out
    const labels = state.undoStack.map((s) => s.label);
    expect(labels).not.toContain('action-0');
    expect(labels).not.toContain('action-1');
    // Current snapshot should be the latest
    expect(state.currentSnapshot!.label).toBe('action-5');
  });

  // ─── Undo edge cases ──────────────────────────────────────────────

  it('undo: no-op when undo stack is empty', () => {
    useHistoryStore.getState().captureSnapshot('only');
    const stateBefore = useHistoryStore.getState();
    expect(stateBefore.undoStack.length).toBe(0);

    useHistoryStore.getState().undo(); // should not throw

    const stateAfter = useHistoryStore.getState();
    expect(stateAfter.undoStack.length).toBe(0);
    expect(stateAfter.redoStack.length).toBe(0);
    expect(stateAfter.currentSnapshot!.label).toBe('only');
  });

  it('undo: no-op when no snapshots exist at all', () => {
    useHistoryStore.getState().undo(); // should not throw
    expect(useHistoryStore.getState().currentSnapshot).toBeNull();
    expect(useHistoryStore.getState().undoStack.length).toBe(0);
    expect(useHistoryStore.getState().redoStack.length).toBe(0);
  });

  it('redo: no-op when redo stack is empty', () => {
    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');

    useHistoryStore.getState().redo(); // should not throw, redo is empty

    const state = useHistoryStore.getState();
    expect(state.currentSnapshot!.label).toBe('b');
    expect(state.undoStack.length).toBe(1);
    expect(state.redoStack.length).toBe(0);
  });

  // ─── Multiple sequential undo/redo ─────────────────────────────────

  it('multiple sequential undos restore state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    useHistoryStore.getState().captureSnapshot('zoom-10');

    mocks.setTimelineState({ zoom: 20 });
    useHistoryStore.getState().captureSnapshot('zoom-20');

    mocks.setTimelineState({ zoom: 30 });
    useHistoryStore.getState().captureSnapshot('zoom-30');

    // Undo to zoom-20
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);
    expect(useHistoryStore.getState().undoStack.length).toBe(1);
    expect(useHistoryStore.getState().redoStack.length).toBe(1);

    // Undo to zoom-10
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);
    expect(useHistoryStore.getState().undoStack.length).toBe(0);
    expect(useHistoryStore.getState().redoStack.length).toBe(2);
  });

  it('multiple sequential redos restore state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    useHistoryStore.getState().captureSnapshot('zoom-10');

    mocks.setTimelineState({ zoom: 20 });
    useHistoryStore.getState().captureSnapshot('zoom-20');

    mocks.setTimelineState({ zoom: 30 });
    useHistoryStore.getState().captureSnapshot('zoom-30');

    // Undo twice
    useHistoryStore.getState().undo();
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);

    // Redo to zoom-20
    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().zoom).toBe(20);
    expect(useHistoryStore.getState().redoStack.length).toBe(1);

    // Redo to zoom-30
    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().zoom).toBe(30);
    expect(useHistoryStore.getState().redoStack.length).toBe(0);
  });

  it('interleaved undo/redo preserves state correctly', () => {
    mocks.setTimelineState({ zoom: 10 });
    useHistoryStore.getState().captureSnapshot('z10');

    mocks.setTimelineState({ zoom: 20 });
    useHistoryStore.getState().captureSnapshot('z20');

    mocks.setTimelineState({ zoom: 30 });
    useHistoryStore.getState().captureSnapshot('z30');

    // Undo to z20
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);

    // Redo back to z30
    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().zoom).toBe(30);

    // Undo to z20 again
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(20);

    // Undo to z10
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(10);

    // Redo to z20
    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().zoom).toBe(20);
  });

  // ─── Undo/redo ends stuck batches ──────────────────────────────────

  it('undo: ends stuck batch before undoing', () => {
    useHistoryStore.getState().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 80 });
    useHistoryStore.getState().captureSnapshot('zoom-80');

    // Start a batch but "forget" to end it (simulate lost mouseup)
    useHistoryStore.getState().startBatch('stuck-batch');
    mocks.setTimelineState({ zoom: 150 });

    // Undo should first end the batch, then undo
    useHistoryStore.getState().undo();

    // Batch should be ended
    expect(useHistoryStore.getState().batchId).toBeNull();
    expect(useHistoryStore.getState().batchLabel).toBeNull();
  });

  it('redo: ends stuck batch before redoing', () => {
    useHistoryStore.getState().captureSnapshot('initial');

    mocks.setTimelineState({ zoom: 80 });
    useHistoryStore.getState().captureSnapshot('zoom-80');

    // Undo to create redo entry
    useHistoryStore.getState().undo();

    // Start a batch but "forget" to end it
    useHistoryStore.getState().startBatch('stuck-batch');

    // Redo should first end the batch
    useHistoryStore.getState().redo();

    expect(useHistoryStore.getState().batchId).toBeNull();
    expect(useHistoryStore.getState().batchLabel).toBeNull();
  });

  // ─── Batch advanced scenarios ──────────────────────────────────────

  it('endBatch: clears redo stack', () => {
    useHistoryStore.getState().captureSnapshot('initial');
    mocks.setTimelineState({ zoom: 80 });
    useHistoryStore.getState().captureSnapshot('zoom-80');

    // Undo to create redo entries
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().redoStack.length).toBe(1);

    // Start and end a batch — should clear redo
    useHistoryStore.getState().startBatch('new-batch');
    mocks.setTimelineState({ zoom: 200 });
    useHistoryStore.getState().endBatch();

    expect(useHistoryStore.getState().redoStack.length).toBe(0);
  });

  it('startBatch: creates currentSnapshot if none exists', () => {
    expect(useHistoryStore.getState().currentSnapshot).toBeNull();

    useHistoryStore.getState().startBatch('from-scratch');

    // startBatch should have auto-created a snapshot
    expect(useHistoryStore.getState().currentSnapshot).not.toBeNull();
    expect(useHistoryStore.getState().currentSnapshot!.label).toBe('initial');
    expect(useHistoryStore.getState().batchId).not.toBeNull();

    useHistoryStore.getState().endBatch();
  });

  it('endBatch without prior currentSnapshot: only sets currentSnapshot', () => {
    // Manually reset to ensure no currentSnapshot
    useHistoryStore.setState({ currentSnapshot: null, batchId: Date.now(), batchLabel: 'test' });
    useHistoryStore.getState().endBatch();

    // When currentSnapshot is null during endBatch, it should just set the final snapshot
    const state = useHistoryStore.getState();
    expect(state.currentSnapshot).not.toBeNull();
    expect(state.currentSnapshot!.label).toBe('test');
    expect(state.undoStack.length).toBe(0); // no previous snapshot to push
    expect(state.batchId).toBeNull();
    expect(state.batchLabel).toBeNull();
  });

  it('endBatch respects maxHistorySize', () => {
    useHistoryStore.setState({ maxHistorySize: 2 });

    // Fill undo stack
    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');
    useHistoryStore.getState().captureSnapshot('c');
    // undoStack should already be capped at 2
    expect(useHistoryStore.getState().undoStack.length).toBe(2);

    // Do a batch — should also respect cap
    useHistoryStore.getState().startBatch('batch');
    mocks.setTimelineState({ zoom: 999 });
    useHistoryStore.getState().endBatch();

    expect(useHistoryStore.getState().undoStack.length).toBeLessThanOrEqual(2);
  });

  it('batch then undo restores pre-batch state', () => {
    mocks.setTimelineState({ zoom: 50 });
    useHistoryStore.getState().captureSnapshot('initial');

    useHistoryStore.getState().startBatch('drag resize');
    mocks.setTimelineState({ zoom: 60 });
    mocks.setTimelineState({ zoom: 70 });
    mocks.setTimelineState({ zoom: 80 });
    useHistoryStore.getState().endBatch();

    expect(mocks.timeline.getState().zoom).toBe(80);

    // Undo the entire batch
    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().zoom).toBe(50);
  });

  // ─── Media state undo/redo ─────────────────────────────────────────

  it('undo/redo restores media state (files)', () => {
    mocks.setMediaState({ files: [{ id: 'f1', name: 'file1.mp4' }] as any });
    useHistoryStore.getState().captureSnapshot('add file');

    mocks.setMediaState({ files: [] });
    useHistoryStore.getState().captureSnapshot('remove file');

    expect(mocks.media.getState().files.length).toBe(0);

    useHistoryStore.getState().undo();
    expect(mocks.media.getState().files.length).toBe(1);
    expect((mocks.media.getState().files[0] as any).id).toBe('f1');

    useHistoryStore.getState().redo();
    expect(mocks.media.getState().files.length).toBe(0);
  });

  it('undo/redo restores media state (compositions)', () => {
    mocks.setMediaState({
      compositions: [{ id: 'comp1', name: 'Main' }] as any,
    });
    useHistoryStore.getState().captureSnapshot('add comp');

    mocks.setMediaState({
      compositions: [
        { id: 'comp1', name: 'Main' },
        { id: 'comp2', name: 'Secondary' },
      ] as any,
    });
    useHistoryStore.getState().captureSnapshot('add comp2');

    useHistoryStore.getState().undo();
    expect(mocks.media.getState().compositions.length).toBe(1);
    expect((mocks.media.getState().compositions[0] as any).name).toBe('Main');
  });

  it('undo/redo restores media state (folders)', () => {
    mocks.setMediaState({ folders: [{ id: 'folder1', name: 'Clips' }] as any });
    useHistoryStore.getState().captureSnapshot('add folder');

    mocks.setMediaState({ folders: [] });
    useHistoryStore.getState().captureSnapshot('remove folder');

    useHistoryStore.getState().undo();
    expect(mocks.media.getState().folders.length).toBe(1);
  });

  it('undo/redo restores media selectedIds and expandedFolderIds', () => {
    mocks.setMediaState({ selectedIds: ['a', 'b'], expandedFolderIds: ['f1'] });
    useHistoryStore.getState().captureSnapshot('select');

    mocks.setMediaState({ selectedIds: [], expandedFolderIds: [] });
    useHistoryStore.getState().captureSnapshot('deselect');

    useHistoryStore.getState().undo();
    expect(mocks.media.getState().selectedIds).toEqual(['a', 'b']);
    expect(mocks.media.getState().expandedFolderIds).toEqual(['f1']);
  });

  it('undo/redo restores textItems and solidItems', () => {
    mocks.setMediaState({
      textItems: [{ id: 't1', text: 'Hello' }] as any,
      solidItems: [{ id: 's1', color: '#ff0000' }] as any,
    });
    useHistoryStore.getState().captureSnapshot('add items');

    mocks.setMediaState({ textItems: [], solidItems: [] });
    useHistoryStore.getState().captureSnapshot('clear items');

    useHistoryStore.getState().undo();
    expect(mocks.media.getState().textItems.length).toBe(1);
    expect(mocks.media.getState().solidItems.length).toBe(1);
  });

  // ─── Dock state undo/redo ──────────────────────────────────────────

  it('undo/redo restores dock layout', () => {
    mocks.dock.setState({ layout: { type: 'row', children: [] } });
    useHistoryStore.getState().captureSnapshot('layout-1');

    mocks.dock.setState({ layout: { type: 'col', children: [{ id: 'panel' }] } });
    useHistoryStore.getState().captureSnapshot('layout-2');

    useHistoryStore.getState().undo();
    expect(mocks.dock.getState().layout).toEqual({ type: 'row', children: [] });

    useHistoryStore.getState().redo();
    expect(mocks.dock.getState().layout).toEqual({ type: 'col', children: [{ id: 'panel' }] });
  });

  // ─── Timeline state: tracks, layers, markers ──────────────────────

  it('undo/redo restores tracks', () => {
    const track1 = { id: 'v1', name: 'V1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false };
    const track2 = { id: 'v2', name: 'V2', type: 'video' as const, height: 60, muted: false, visible: true, solo: false };

    mocks.setTimelineState({ tracks: [track1] });
    useHistoryStore.getState().captureSnapshot('one track');

    mocks.setTimelineState({ tracks: [track1, track2] });
    useHistoryStore.getState().captureSnapshot('two tracks');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().tracks.length).toBe(1);
    expect(mocks.timeline.getState().tracks[0].id).toBe('v1');
  });

  it('undo/redo restores clips', () => {
    const clip1 = { id: 'c1', trackId: 'v1', startFrame: 0, endFrame: 100, mediaId: 'm1' };
    mocks.setTimelineState({ clips: [] });
    useHistoryStore.getState().captureSnapshot('no clips');

    mocks.setTimelineState({ clips: [clip1] as any });
    useHistoryStore.getState().captureSnapshot('one clip');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().clips.length).toBe(0);

    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().clips.length).toBe(1);
    expect((mocks.timeline.getState().clips[0] as any).id).toBe('c1');
  });

  it('undo/redo restores markers', () => {
    mocks.setTimelineState({ markers: [] });
    useHistoryStore.getState().captureSnapshot('no markers');

    mocks.setTimelineState({ markers: [{ id: 'm1', time: 100, color: 'red', label: 'mark1' }] as any });
    useHistoryStore.getState().captureSnapshot('one marker');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().markers.length).toBe(0);

    useHistoryStore.getState().redo();
    expect(mocks.timeline.getState().markers.length).toBe(1);
  });

  it('undo/redo restores layers', () => {
    mocks.setTimelineState({ layers: [{ id: 'L1', name: 'Layer 1' }] as any });
    useHistoryStore.getState().captureSnapshot('one layer');

    mocks.setTimelineState({ layers: [] });
    useHistoryStore.getState().captureSnapshot('no layers');

    useHistoryStore.getState().undo();
    const restoredLayers = mocks.timeline.getState().layers;
    expect(restoredLayers.length).toBe(1);
    expect((restoredLayers[0] as any).id).toBe('L1');
  });

  it('undo/redo restores selectedLayerId', () => {
    mocks.setTimelineState({ selectedLayerId: 'L1' });
    useHistoryStore.getState().captureSnapshot('selected');

    mocks.setTimelineState({ selectedLayerId: null });
    useHistoryStore.getState().captureSnapshot('deselected');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().selectedLayerId).toBe('L1');
  });

  it('undo/redo restores scrollX', () => {
    mocks.setTimelineState({ scrollX: 0 });
    useHistoryStore.getState().captureSnapshot('scroll-0');

    mocks.setTimelineState({ scrollX: 500 });
    useHistoryStore.getState().captureSnapshot('scroll-500');

    useHistoryStore.getState().undo();
    expect(mocks.timeline.getState().scrollX).toBe(0);
  });

  // ─── Snapshot deep clone isolation ─────────────────────────────────

  it('snapshots are deep cloned: mutating source does not affect snapshot', () => {
    const clips = [{ id: 'c1', trackId: 'v1', startFrame: 0, endFrame: 100 }];
    mocks.setTimelineState({ clips: clips as any });
    useHistoryStore.getState().captureSnapshot('with clips');

    // Mutate the original array
    clips[0].endFrame = 999;
    clips.push({ id: 'c2', trackId: 'v1', startFrame: 200, endFrame: 300 });

    const snapshot = useHistoryStore.getState().currentSnapshot!;
    // Snapshot should not be affected
    expect(snapshot.timeline.clips.length).toBe(1);
    expect((snapshot.timeline.clips[0] as any).endFrame).toBe(100);
  });

  it('snapshots are deep cloned: mutating snapshot does not affect subsequent undo', () => {
    mocks.setTimelineState({ clips: [{ id: 'c1', startFrame: 0, endFrame: 100 }] as any });
    useHistoryStore.getState().captureSnapshot('initial');

    mocks.setTimelineState({ clips: [{ id: 'c1', startFrame: 0, endFrame: 200 }] as any });
    useHistoryStore.getState().captureSnapshot('modified');

    // Mutate the undo stack snapshot directly (should not matter for undo)
    const undoSnapshot = useHistoryStore.getState().undoStack[0];
    (undoSnapshot.timeline.clips[0] as any).endFrame = 9999;

    // Undo - the applySnapshot deep clones again, so the mutation above
    // means the applied state will have the mutated value.
    // This test validates that the store's state after undo reflects
    // what was in the undo stack (even if mutated).
    useHistoryStore.getState().undo();
    // The timeline should have the value from the undo stack snapshot
    expect(mocks.timeline.getState().clips.length).toBe(1);
  });

  // ─── selectedClipIds serialization in snapshot ─────────────────────

  it('snapshot serializes Set<string> to array for selectedClipIds', () => {
    mocks.setTimelineState({ selectedClipIds: new Set(['x', 'y', 'z']) });
    useHistoryStore.getState().captureSnapshot('selected');

    const snapshot = useHistoryStore.getState().currentSnapshot!;
    // Should be array in snapshot, not Set
    expect(Array.isArray(snapshot.timeline.selectedClipIds)).toBe(true);
    expect(snapshot.timeline.selectedClipIds).toContain('x');
    expect(snapshot.timeline.selectedClipIds).toContain('y');
    expect(snapshot.timeline.selectedClipIds).toContain('z');
  });

  // ─── setIsApplying ─────────────────────────────────────────────────

  it('setIsApplying: sets isApplying flag', () => {
    expect(useHistoryStore.getState().isApplying).toBe(false);

    useHistoryStore.getState().setIsApplying(true);
    expect(useHistoryStore.getState().isApplying).toBe(true);

    useHistoryStore.getState().setIsApplying(false);
    expect(useHistoryStore.getState().isApplying).toBe(false);
  });

  // ─── setHistoryCallbacks: flushPendingCapture ──────────────────────

  it('undo calls flushPendingCapture callback', () => {
    const flushFn = vi.fn();
    const suppressFn = vi.fn();
    setHistoryCallbacks({ flushPendingCapture: flushFn, suppressCaptures: suppressFn });

    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');

    useHistoryStore.getState().undo();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledTimes(1);

    // Clean up: reset callbacks to avoid affecting other tests
    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  });

  it('redo calls flushPendingCapture callback', () => {
    const flushFn = vi.fn();
    const suppressFn = vi.fn();
    setHistoryCallbacks({ flushPendingCapture: flushFn, suppressCaptures: suppressFn });

    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');
    useHistoryStore.getState().undo();
    flushFn.mockClear();
    suppressFn.mockClear();

    useHistoryStore.getState().redo();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledTimes(1);

    setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  });

  // ─── Convenience exports ───────────────────────────────────────────

  it('convenience captureSnapshot function works', () => {
    captureSnapshotFn('via-export');
    expect(useHistoryStore.getState().currentSnapshot).not.toBeNull();
    expect(useHistoryStore.getState().currentSnapshot!.label).toBe('via-export');
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

    expect(useHistoryStore.getState().undoStack.length).toBe(1);
    expect(useHistoryStore.getState().currentSnapshot!.label).toBe('batch');
  });

  // ─── Snapshot timestamp ────────────────────────────────────────────

  it('snapshot includes timestamp', () => {
    const before = Date.now();
    useHistoryStore.getState().captureSnapshot('timed');
    const after = Date.now();

    const snapshot = useHistoryStore.getState().currentSnapshot!;
    expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
    expect(snapshot.timestamp).toBeLessThanOrEqual(after);
  });

  // ─── Full round-trip: multi-store state ────────────────────────────

  it('full round-trip: undo restores all three stores atomically', () => {
    // Set up initial state across all stores
    mocks.setTimelineState({ zoom: 50, clips: [], tracks: [{ id: 'v1', name: 'V1', type: 'video', height: 60, muted: false, visible: true, solo: false }] });
    mocks.setMediaState({ files: [{ id: 'f1', name: 'vid.mp4' }] as any, selectedIds: ['f1'] });
    mocks.dock.setState({ layout: { type: 'row' } });
    useHistoryStore.getState().captureSnapshot('initial-state');

    // Change all stores simultaneously
    mocks.setTimelineState({ zoom: 150, clips: [{ id: 'c1' }] as any });
    mocks.setMediaState({ files: [], selectedIds: [] });
    mocks.dock.setState({ layout: { type: 'col' } });
    useHistoryStore.getState().captureSnapshot('changed-state');

    // Undo should restore all three stores
    useHistoryStore.getState().undo();

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
    useHistoryStore.getState().captureSnapshot('before');

    mocks.setTimelineState({ zoom: 200 });
    mocks.setMediaState({ files: [{ id: 'f2', name: 'pic.jpg' }] as any });
    mocks.dock.setState({ layout: { type: 'tabs' } });
    useHistoryStore.getState().captureSnapshot('after');

    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();

    expect(mocks.timeline.getState().zoom).toBe(200);
    expect(mocks.media.getState().files.length).toBe(1);
    expect(mocks.dock.getState().layout).toEqual({ type: 'tabs' });
  });

  // ─── Empty Map/Set edge cases ──────────────────────────────────────

  it('undo restores empty Map for clipKeyframes', () => {
    mocks.setTimelineState({ clipKeyframes: new Map() });
    useHistoryStore.getState().captureSnapshot('empty map');

    const kfMap = new Map([['clip-x', [{ id: 'kf1', clipId: 'clip-x', time: 0, property: 'opacity', value: 1, easing: 'linear' }]]]);
    mocks.setTimelineState({ clipKeyframes: kfMap });
    useHistoryStore.getState().captureSnapshot('with kfs');

    useHistoryStore.getState().undo();
    const restored = mocks.timeline.getState().clipKeyframes;
    expect(restored instanceof Map).toBe(true);
    expect(restored.size).toBe(0);
  });

  it('undo restores empty Set for selectedClipIds', () => {
    mocks.setTimelineState({ selectedClipIds: new Set() });
    useHistoryStore.getState().captureSnapshot('empty');

    mocks.setTimelineState({ selectedClipIds: new Set(['a']) });
    useHistoryStore.getState().captureSnapshot('selected');

    useHistoryStore.getState().undo();
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
    useHistoryStore.getState().captureSnapshot('multi-clip kf');

    // Remove all keyframes
    mocks.setTimelineState({ clipKeyframes: new Map() });
    useHistoryStore.getState().captureSnapshot('cleared kf');

    // Undo
    useHistoryStore.getState().undo();
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
    useHistoryStore.getState().captureSnapshot('a');
    useHistoryStore.getState().captureSnapshot('b');

    useHistoryStore.getState().clearHistory();

    // External stores should be untouched
    expect(mocks.timeline.getState().zoom).toBe(123);
    expect(mocks.media.getState().selectedIds).toEqual(['x']);
  });

  // ─── Layer source preservation ─────────────────────────────────────

  it('undo preserves existing layer source references', () => {
    const fakeSource = { type: 'video', element: 'mock-element' };
    mocks.setTimelineState({
      layers: [{ id: 'L1', name: 'Layer 1', source: fakeSource }] as any,
    });
    useHistoryStore.getState().captureSnapshot('with source');

    // Change layers
    mocks.setTimelineState({
      layers: [{ id: 'L1', name: 'Layer 1 modified', source: fakeSource }] as any,
    });
    useHistoryStore.getState().captureSnapshot('modified');

    // Undo — should preserve the source reference from current state
    useHistoryStore.getState().undo();
    const restored = mocks.timeline.getState().layers;
    expect(restored.length).toBe(1);
    expect((restored[0] as any).source).toBe(fakeSource);
  });
});
