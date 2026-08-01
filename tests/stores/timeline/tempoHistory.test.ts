// Undo threading for the tempo map (issue #299, Packet 1).
//
// `tempoMap` had to be added to 12 sites across 5 history files. Missing one
// drops tempo on undo *silently* — no type error — so this suite drives the real
// capture/undo/redo path end to end instead of type-checking the shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useHistoryStore,
  initHistoryStoreRefs,
  captureSnapshot as captureSnapshotFn,
  undo as undoFn,
  redo as redoFn,
  setHistoryDisabledForDebug,
} from '../../../src/stores/historyStore';
import { createHistoryTimelineEditState } from '../../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../../src/stores/timeline/historyTimelineRestoreState';
import { normalizeTempoMap } from '../../../src/timeline/tempo/tempoEdits';
import type { TempoMap } from '../../../src/types/timeline';

type HistoryStoreRefs = Parameters<typeof initHistoryStoreRefs>[0];
type TimelineMockState = ReturnType<HistoryStoreRefs['timeline']['getState']>;
type MediaMockState = ReturnType<HistoryStoreRefs['media']['getState']>;
type DockMockState = ReturnType<HistoryStoreRefs['dock']['getState']>;

function tempoMap(...bpms: number[]): TempoMap {
  return normalizeTempoMap({
    events: bpms.map((bpm, index) => ({
      id: `tempo-${index}`,
      time: index * 8,
      bpm,
      numerator: 4,
      denominator: 4,
    })),
  });
}

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
    tempoMap: tempoMap(60),
    isExporting: false,
  };
  // Only the fields this suite touches; the history store reads the rest defensively.
  let mediaState = {
    files: [], compositions: [], folders: [], selectedIds: [],
    expandedFolderIds: [], textItems: [], solidItems: [],
  } as unknown as MediaMockState;
  let dockState = { layout: null } as unknown as DockMockState;

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
    setTimelineState: (s: Partial<TimelineMockState>) => { timelineState = { ...timelineState, ...s }; },
  };
}

describe('tempo map history threading', () => {
  let mocks: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    setHistoryDisabledForDebug(false);
    useHistoryStore.setState({
      nodes: {}, rootId: null, activeNodeId: null,
      lastVisitedChildByNodeId: {}, eventLog: [],
      isApplying: false, batchId: null, batchLabel: null,
    });
    mocks = createMockStores();
    initHistoryStoreRefs(mocks);
  });

  afterEach(() => {
    setHistoryDisabledForDebug(false);
  });

  it('undo restores the previous tempo map and redo re-applies the new one', () => {
    captureSnapshotFn('Baseline');

    mocks.setTimelineState({ tempoMap: tempoMap(60, 120) });
    captureSnapshotFn('Add tempo change');

    undoFn();
    expect(mocks.timeline.getState().tempoMap?.events.map(e => e.bpm)).toEqual([60]);

    redoFn();
    expect(mocks.timeline.getState().tempoMap?.events.map(e => e.bpm)).toEqual([60, 120]);
  });

  it('undo restores tempo-event ids and meters, not just BPM', () => {
    captureSnapshotFn('Baseline');
    const before = mocks.timeline.getState().tempoMap!;

    mocks.setTimelineState({
      tempoMap: normalizeTempoMap({
        events: [{ id: 'tempo-0', time: 0, bpm: 90, numerator: 7, denominator: 8 }],
      }),
    });
    captureSnapshotFn('Edit tempo change');

    undoFn();
    expect(mocks.timeline.getState().tempoMap).toEqual(before);
  });

  it('an entry captured before #299 (no tempoMap) leaves the live map alone', () => {
    captureSnapshotFn('Baseline');
    mocks.setTimelineState({ markers: [] });
    captureSnapshotFn('Unrelated edit');

    // Simulate persisted pre-#299 entries: strip tempoMap from both snapshot
    // tiers, exactly as an entry written before this feature would look.
    const state = useHistoryStore.getState();
    const nodes = Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => {
      const snapshot = structuredClone(node.snapshot);
      delete (snapshot.timeline as { tempoMap?: unknown }).tempoMap;
      if (snapshot.timelineEditState) {
        delete (snapshot.timelineEditState.timeline as { tempoMap?: unknown }).tempoMap;
      }
      return [id, { ...node, snapshot }];
    }));
    useHistoryStore.setState({ nodes });

    // The live map is newer than the history entries; undo must not erase it.
    mocks.setTimelineState({ tempoMap: tempoMap(60, 150) });
    undoFn();

    expect(mocks.timeline.getState().tempoMap?.events.map(e => e.bpm)).toEqual([60, 150]);
  });

  it('the edit-state tier carries the tempo map through a capture/restore round trip', () => {
    const map = tempoMap(60, 120, 90);
    const editState = createHistoryTimelineEditState({
      id: 'test', label: 'test', timestamp: 0,
      tracks: [], clips: [], selectedClipIds: new Set<string>(),
      zoom: 50, scrollX: 0, markers: [], tempoMap: map,
    });

    expect(editState.timeline.tempoMap).toEqual(map);

    const restored = createHistoryTimelineRestoreState(editState, {}, {
      placeholderFileMode: 'plain-data',
    }).state;
    expect(restored.tempoMap).toEqual(map);
  });
});
