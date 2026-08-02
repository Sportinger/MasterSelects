import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelHistoryBatch,
  captureSnapshot,
  getHistoryStateView,
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
import type { TimelineClip } from '../../src/types/timeline';
import { createMockTrack } from '../helpers/mockData';

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
    captureSnapshot('initial');
  });

  afterEach(() => {
    if (getHistoryStateView().batchId !== null) {
      cancelHistoryBatch();
    }
    getHistoryStateView().clearHistory();
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
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('drops a pending fallback capture after committing an explicit batch', () => {
    let fallbackPending = false;
    setHistoryCallbacks({
      flushPendingCapture: () => {
        if (!fallbackPending) return;
        fallbackPending = false;
        captureSnapshot('duplicate fallback', { isAutoCapture: true });
      },
      suppressCaptures: () => {
        fallbackPending = false;
      },
    });
    const transaction = beginAgentTransaction('AI task: append clips');

    appendClip('first');
    appendClip('second');
    fallbackPending = true;
    commitAgentTransaction(transaction);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('keeps its history batch while a timeline operation uses nested history', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'track-1', type: 'video' })],
    });
    const transaction = beginAgentTransaction('AI task: nested timeline edit');

    const split = useTimelineStore.getState().applyTimelineEditOperation({
      id: 'agent-nested-split',
      type: 'split-at-time',
      clipIds: ['base'],
      time: 0.5,
      includeLinked: true,
    }, {
      source: 'ai-tool',
      historyLabel: 'AI: nested split',
    });

    expect(split.success).toBe(true);
    expect(getHistoryStateView().batchId).toBe(transaction.historyBatchId);
    commitAgentTransaction(transaction);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
  });

  it('aborts to the pre-transaction clips without changing undo history', () => {
    const undoLengthBefore = getHistoryStateView().undoStack.length;
    const transaction = beginAgentTransaction('AI task: abort clips');

    appendClip('first');
    appendClip('second');
    abortAgentTransaction(transaction);

    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base']);
    expect(getHistoryStateView().undoStack).toHaveLength(undoLengthBefore);
    expect(getHistoryStateView().batchId).toBeNull();
  });

  it('keeps an outer history batch open for passthrough transactions', () => {
    getHistoryStateView().startBatch('outer');
    const outerBatchId = getHistoryStateView().batchId;
    const committedPassthrough = beginAgentTransaction('AI task: passthrough commit');

    expect(committedPassthrough.alreadyBatching).toBe(true);
    expect(committedPassthrough.abortNoop).toBe(true);
    expect(committedPassthrough.historyBatchId).toBe(outerBatchId);
    appendClip('first');
    commitAgentTransaction(committedPassthrough);
    expect(getHistoryStateView().batchId).toBe(outerBatchId);

    const abortedPassthrough = beginAgentTransaction('AI task: passthrough abort');
    abortAgentTransaction(abortedPassthrough);
    expect(getHistoryStateView().batchId).toBe(outerBatchId);

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

    expect(getHistoryStateView().batchId).toBe(flushBatchId);
    expect(getHistoryStateView().batchLabel).toBe('flush owner');
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
    getHistoryStateView().endBatch();
    getHistoryStateView().startBatch('replacement owner');
    const replacementBatchId = getHistoryStateView().batchId;
    const undoLengthBeforeCommit = getHistoryStateView().undoStack.length;

    expect(originalBatchId).not.toBeNull();
    expect(replacementBatchId).not.toBe(originalBatchId);
    commitAgentTransaction(transaction);

    expect(isAgentTransactionOpen()).toBe(false);
    expect(getHistoryStateView().batchId).toBe(replacementBatchId);
    expect(getHistoryStateView().batchLabel).toBe('replacement owner');
    expect(getHistoryStateView().undoStack).toHaveLength(undoLengthBeforeCommit);
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).toEqual(['base', 'first']);
  });

  it('rolls back a grouped partial failure without creating an undo entry', async () => {
    const undoLengthBefore = getHistoryStateView().undoStack.length;
    const auditIdPrefix = `rollback-audit-${Date.now()}-${Math.random()}`;
    const createCallId = `${auditIdPrefix}-create`;
    const missingCallId = `${auditIdPrefix}-missing`;

    const results = await executeAIToolCalls([
      { id: createCallId, tool: 'createTrack', args: { type: 'video' } },
      { id: missingCallId, tool: 'deleteClip', args: { clipId: 'missing', withLinked: false } },
    ], 'internal', { guidedReplay: false });

    expect(results.map((entry) => entry.result.success)).toEqual([false, false]);
    expect(results[0]?.result.data).toMatchObject({
      applied: false,
      rolledBack: true,
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
    expect(getHistoryStateView().undoStack).toHaveLength(undoLengthBefore);
    expect(getHistoryStateView().batchId).toBeNull();
  });

  it('does not open a transaction or create undo history when history is suppressed', async () => {
    const undoLengthBefore = getHistoryStateView().undoStack.length;

    const results = await executeAIToolCalls([
      { tool: 'createTrack', args: { type: 'video' } },
      { tool: 'createTrack', args: { type: 'audio' } },
    ], 'internal', { guidedReplay: false, suppressHistory: true });

    expect(results.every((entry) => entry.result.success)).toBe(true);
    expect(isAgentTransactionOpen()).toBe(false);
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(undoLengthBefore);
    expect(useTimelineStore.getState().tracks).toHaveLength(2);
  });
});
