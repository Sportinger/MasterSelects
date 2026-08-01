import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureSnapshot,
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';

const initialTimelineState = useTimelineStore.getState();

function createClip(id: string): TimelineClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    file: new File([id], `${id}.mp4`, { type: 'video/mp4' }),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: { type: 'video', naturalDuration: 1 },
    transform: {} as TimelineClip['transform'],
    effects: [],
  };
}

function initializeHistoryRefs(): void {
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

describe('history batch debounce timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'));
    initializeHistoryRefs();
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    getHistoryStateView().clearHistory();
    useTimelineStore.setState({
      clips: [createClip('base')],
      tracks: [],
      selectedClipIds: new Set(),
      layers: [],
      selectedLayerId: null,
      clipKeyframes: new Map(),
      markers: [],
      isExporting: false,
    });
  });

  afterEach(() => {
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('flushes a pending user edit before begin and drops the post-abort capture', () => {
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingLabel = '';
    let suppressUntil = 0;

    const schedulePendingCapture = (label: string): void => {
      pendingLabel = label;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (Date.now() < suppressUntil) return;
        captureSnapshot(pendingLabel, { isAutoCapture: true });
      }, 1000);
    };

    setHistoryCallbacks({
      flushPendingCapture: () => {
        if (pendingTimer === null) return;
        clearTimeout(pendingTimer);
        pendingTimer = null;
        if (Date.now() < suppressUntil) return;
        captureSnapshot(pendingLabel || 'pending', { isAutoCapture: true });
      },
      suppressCaptures: () => {
        if (pendingTimer !== null) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
          pendingLabel = '';
        }
        suppressUntil = Date.now() + 250;
      },
      afterApply: () => schedulePendingCapture('post-abort no-op'),
    });

    captureSnapshot('initial');
    vi.advanceTimersByTime(251);
    useTimelineStore.setState((state) => ({
      clips: [...state.clips, createClip('user-edit')],
    }));
    schedulePendingCapture('pending user edit');

    getHistoryStateView().startBatch('AI task');

    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().currentSnapshot?.label).toBe('pending user edit');
    expect(getHistoryStateView().currentSnapshot?.timeline.clips.map((clip) => clip.id))
      .toEqual(['base', 'user-edit']);

    useTimelineStore.setState((state) => ({
      clips: [...state.clips, createClip('ai-edit')],
    }));
    getHistoryStateView().cancelBatch();

    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base', 'user-edit']);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    const currentSentinel = getHistoryStateView().currentSnapshot!;
    captureSnapshot('redo sentinel');
    getHistoryStateView().undo();
    const redoSentinel = getHistoryStateView().redoStack;

    vi.advanceTimersByTime(1001);

    expect(getHistoryStateView().redoStack).toEqual(redoSentinel);
    expect(getHistoryStateView().currentSnapshot).toBe(currentSentinel);
  });
});
