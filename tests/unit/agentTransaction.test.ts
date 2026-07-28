import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelHistoryBatch,
  captureSnapshot,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import { executeAIToolCalls } from '../../src/services/aiTools';
import { listAIToolAuditEntries } from '../../src/services/aiTools/audit';
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
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
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
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    vi.restoreAllMocks();
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
    expect(committedPassthrough.abortNoop).toBe(true);
    expect(committedPassthrough.historyBatchId).toBe(outerBatchId);
    appendClip('first');
    commitAgentTransaction(committedPassthrough);
    expect(useHistoryStore.getState().batchId).toBe(outerBatchId);

    const abortedPassthrough = beginAgentTransaction('AI task: passthrough abort');
    abortAgentTransaction(abortedPassthrough);
    expect(useHistoryStore.getState().batchId).toBe(outerBatchId);

    cancelHistoryBatch();
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('treats a batch opened by the pre-start flush as outer-owned', () => {
    const flushBatchId = 987_654_321;
    let openedBatch = false;
    setHistoryCallbacks({
      flushPendingCapture: () => {
        if (openedBatch) return;
        openedBatch = true;
        useHistoryStore.setState({
          batchId: flushBatchId,
          batchLabel: 'flush owner',
        });
      },
      suppressCaptures: () => undefined,
    });

    const transaction = beginAgentTransaction('AI task: flush ownership');
    expect(transaction.alreadyBatching).toBe(true);
    expect(transaction.abortNoop).toBe(true);
    expect(transaction.historyBatchId).toBe(flushBatchId);
    expect(openedBatch).toBe(true);

    appendClip('first');
    abortAgentTransaction(transaction);

    expect(useHistoryStore.getState().batchId).toBe(flushBatchId);
    expect(useHistoryStore.getState().batchLabel).toBe('flush owner');
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base', 'first']);
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

  it('leaves a same-millisecond replacement batch untouched when commit ownership is lost', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const transaction = beginAgentTransaction('AI task: lost ownership');
    const originalBatchId = transaction.historyBatchId;
    appendClip('first');
    useHistoryStore.getState().endBatch();
    useHistoryStore.getState().startBatch('replacement owner');
    const replacementBatchId = useHistoryStore.getState().batchId;
    const undoLengthBeforeCommit = useHistoryStore.getState().undoStack.length;

    expect(originalBatchId).not.toBeNull();
    expect(replacementBatchId).not.toBe(originalBatchId);
    commitAgentTransaction(transaction);

    expect(isAgentTransactionOpen()).toBe(false);
    expect(useHistoryStore.getState().batchId).toBe(replacementBatchId);
    expect(useHistoryStore.getState().batchLabel).toBe('replacement owner');
    expect(useHistoryStore.getState().undoStack).toHaveLength(undoLengthBeforeCommit);
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base', 'first']);
  });

  it('rolls back a grouped partial failure without creating an undo entry', async () => {
    const undoLengthBefore = useHistoryStore.getState().undoStack.length;
    const auditIdPrefix = `rollback-audit-${Date.now()}-${Math.random()}`;
    const createCallId = `${auditIdPrefix}-create`;
    const missingCallId = `${auditIdPrefix}-missing`;

    const results = await executeAIToolCalls([
      { id: createCallId, tool: 'createTrack', args: { type: 'video' } },
      { id: missingCallId, tool: 'deleteClip', args: { clipId: 'missing', withLinked: false } },
    ], 'internal', { guidedReplay: false });

    expect(results.map((entry) => entry.result.success)).toEqual([true, false]);
    expect(results[0]?.result.data).toMatchObject({
      partialFailure: {
        occurred: true,
        rolledBack: true,
        rollbackDeferred: false,
        transactionOwnershipLost: false,
        failedModifyingTools: [{ id: missingCallId, tool: 'deleteClip' }],
      },
    });
    const createdTrackData = results[0]?.result.data as { trackId: string; trackType: string };
    const auditEntries = await listAIToolAuditEntries({ limit: 100, tool: 'createTrack' });
    const createAudit = auditEntries.find((entry) => entry.providerToolCallId === createCallId);
    expect(createAudit).toMatchObject({
      status: 'failed',
      result: {
        success: false,
        error: {
          category: 'partialTransaction',
          message: expect.stringContaining('rolled back:'),
        },
        data: {
          originalResult: {
            success: true,
            data: {
              trackId: createdTrackData.trackId,
              trackType: 'video',
            },
          },
        },
      },
    });
    expect(createAudit?.result).toMatchObject({
      error: {
        message: expect.stringContaining('deleteClip'),
      },
    });
    expect(useTimelineStore.getState().tracks).toEqual([]);
    expect(useHistoryStore.getState().undoStack).toHaveLength(undoLengthBefore);
    expect(useHistoryStore.getState().batchId).toBeNull();
  });

  it('does not open a transaction or create undo history when history is suppressed', async () => {
    const undoLengthBefore = useHistoryStore.getState().undoStack.length;

    const results = await executeAIToolCalls([
      { tool: 'createTrack', args: { type: 'video' } },
      { tool: 'createTrack', args: { type: 'audio' } },
    ], 'internal', { guidedReplay: false, suppressHistory: true });

    expect(results.every((entry) => entry.result.success)).toBe(true);
    expect(isAgentTransactionOpen()).toBe(false);
    expect(useHistoryStore.getState().batchId).toBeNull();
    expect(useHistoryStore.getState().undoStack).toHaveLength(undoLengthBefore);
    expect(useTimelineStore.getState().tracks).toHaveLength(2);
  });
});
