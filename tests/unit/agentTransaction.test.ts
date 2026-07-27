import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cancelHistoryBatch,
  captureSnapshot,
  initHistoryStoreRefs,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import {
  abortAgentTransaction,
  beginAgentTransaction,
  commitAgentTransaction,
  isAgentTransactionOpen,
} from '../../src/services/aiTools/agentTransaction';
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

function appendClip(id: string): void {
  useTimelineStore.setState((state) => ({
    clips: [...state.clips, createClip(id)],
  }));
}

describe('agent mutation transactions', () => {
  beforeEach(() => {
    initializeHistoryRefs();
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
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
    captureSnapshot('initial');
  });

  afterEach(() => {
    if (useHistoryStore.getState().batchId !== null) {
      cancelHistoryBatch();
    }
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialTimelineState);
  });

  it('commits two store mutations as one undo entry', () => {
    const transaction = beginAgentTransaction('AI task: append clips');
    expect(isAgentTransactionOpen()).toBe(true);

    appendClip('first');
    appendClip('second');
    commitAgentTransaction(transaction);

    expect(isAgentTransactionOpen()).toBe(false);
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('aborts to the pre-transaction clips without changing undo history', () => {
    const undoLengthBefore = useHistoryStore.getState().undoStack.length;
    const transaction = beginAgentTransaction('AI task: abort clips');

    appendClip('first');
    appendClip('second');
    abortAgentTransaction(transaction);

    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
    expect(useHistoryStore.getState().undoStack).toHaveLength(undoLengthBefore);
    expect(useHistoryStore.getState().batchId).toBeNull();
  });

  it('keeps an outer history batch open for passthrough transactions', () => {
    useHistoryStore.getState().startBatch('outer');
    const outerBatchId = useHistoryStore.getState().batchId;
    const committedPassthrough = beginAgentTransaction('AI task: passthrough commit');

    expect(committedPassthrough.alreadyBatching).toBe(true);
    appendClip('first');
    commitAgentTransaction(committedPassthrough);
    expect(useHistoryStore.getState().batchId).toBe(outerBatchId);

    const abortedPassthrough = beginAgentTransaction('AI task: passthrough abort');
    abortAgentTransaction(abortedPassthrough);
    expect(useHistoryStore.getState().batchId).toBe(outerBatchId);

    cancelHistoryBatch();
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('reports monotonic timeline revisions across commit', () => {
    const revisionBefore = getTimelineRevision();
    const transaction = beginAgentTransaction('AI task: revision');

    expect(transaction.stateRevisionBefore).toBe(revisionBefore);
    appendClip('first');
    const committed = commitAgentTransaction(transaction);

    expect(committed.stateRevisionAfter).toBe(getTimelineRevision());
    expect(committed.stateRevisionAfter).toBeGreaterThan(transaction.stateRevisionBefore);
  });
});
