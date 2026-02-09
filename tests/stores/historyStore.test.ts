import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore, initHistoryStoreRefs } from '../../src/stores/historyStore';

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
});
