import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type {
  KeyframeEditOperation,
  KeyframeTransactionBeginOperation,
  KeyframeTransactionCancelOperation,
  KeyframeTransactionCommitOperation,
  KeyframeTransactionUpdateOperation,
} from '../../src/stores/timeline/editOperations/transactionTypes';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

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

function installFixture(): void {
  useTimelineStore.setState({
    tracks: [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'video-2', type: 'video' }),
    ],
    clips: [
      createMockClip({ id: 'clip-a', trackId: 'video-1', duration: 10 }),
      createMockClip({ id: 'clip-b', trackId: 'video-2', duration: 10 }),
    ],
    clipKeyframes: new Map([
      ['clip-a', [
        createMockKeyframe({
          id: 'kf-position',
          clipId: 'clip-a',
          property: 'position.x',
          time: 1,
          value: 0.1,
        }),
      ]],
      ['clip-b', [
        createMockKeyframe({
          id: 'kf-opacity',
          clipId: 'clip-b',
          property: 'opacity',
          time: 2,
          value: 0.5,
        }),
      ]],
    ]),
    selectedKeyframeIds: new Set(['kf-position']),
    isExporting: false,
  });
}

function beginOperation(
  transactionId: string,
  keyframeIds: string[] = ['kf-position'],
): KeyframeTransactionBeginOperation {
  return {
    id: `${transactionId}:begin`,
    type: 'keyframe-transaction-begin',
    transactionId,
    historyBatchId: `${transactionId}:history`,
    source: 'ui',
    phase: 'begin',
    clipId: 'clip-a',
    keyframeIds,
    intent: 'viewport-motion-path',
  };
}

function updateOperation(
  transactionId: string,
  operations: readonly KeyframeEditOperation[],
  keyframeIds = operations.flatMap(operation => (
    'keyframeId' in operation ? [operation.keyframeId] : []
  )),
): KeyframeTransactionUpdateOperation {
  return {
    id: `${transactionId}:update`,
    type: 'keyframe-transaction-update',
    transactionId,
    historyBatchId: `${transactionId}:history`,
    source: 'ui',
    phase: 'update',
    clipId: 'clip-a',
    keyframeIds,
    operations,
  };
}

function commitOperation(
  transactionId: string,
  operations: readonly KeyframeEditOperation[],
  keyframeIds = operations.flatMap(operation => (
    'keyframeId' in operation ? [operation.keyframeId] : []
  )),
): KeyframeTransactionCommitOperation {
  return {
    id: `${transactionId}:commit`,
    type: 'keyframe-transaction-commit',
    transactionId,
    historyBatchId: `${transactionId}:history`,
    source: 'ui',
    phase: 'commit',
    clipId: 'clip-a',
    keyframeIds,
    operations,
  };
}

function cancelOperation(transactionId: string): KeyframeTransactionCancelOperation {
  return {
    id: `${transactionId}:cancel`,
    type: 'keyframe-transaction-cancel',
    transactionId,
    historyBatchId: `${transactionId}:history`,
    source: 'ui',
    phase: 'cancel',
    clipId: 'clip-a',
    keyframeIds: ['kf-position'],
    restoreKeyframeIds: ['kf-position'],
    discardKeyframeIds: [],
  };
}

function movePositionOperation(time: number, value = 0.25): KeyframeEditOperation[] {
  return [
    {
      type: 'keyframe-move',
      keyframeId: 'kf-position',
      clipId: 'clip-a',
      property: 'position.x',
      originalTime: 1,
      requestedTime: time,
      resolvedTime: time,
    },
    {
      type: 'keyframe-update-value',
      keyframeId: 'kf-position',
      clipId: 'clip-a',
      property: 'position.x',
      value: { value },
    },
  ];
}

function getPositionKeyframe() {
  return useTimelineStore.getState().clipKeyframes.get('clip-a')?.find(keyframe => keyframe.id === 'kf-position');
}

describe('keyframe transaction lifecycle', () => {
  beforeEach(() => {
    initializeHistoryRefs();
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    getHistoryStateView().clearHistory();
    installFixture();
  });

  afterEach(() => {
    if (getHistoryStateView().batchId !== null) {
      getHistoryStateView().cancelBatch();
    }
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    vi.restoreAllMocks();
  });

  it('owns a deferred history batch through update and closes it on commit as one undo step', () => {
    const transactionId = 'owned-deferred';
    const firstOperations = movePositionOperation(2, 0.25);
    const finalOperations = movePositionOperation(3, 0.4);
    const store = useTimelineStore.getState();

    expect(store.applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Move viewport path',
    }).success).toBe(true);
    expect(store.applyTimelineEditOperation(updateOperation(transactionId, firstOperations), {
      source: 'ui',
      historyLabel: 'Move viewport path',
      deferHistoryCommit: true,
    }).success).toBe(true);
    expect(store.applyTimelineEditOperation(updateOperation(transactionId, finalOperations), {
      source: 'ui',
      historyLabel: 'Move viewport path',
      deferHistoryCommit: true,
    }).success).toBe(true);

    const ownedBatchId = getHistoryStateView().batchId;
    expect(ownedBatchId).not.toBeNull();
    expect(getPositionKeyframe()).toMatchObject({ time: 3, value: 0.4 });

    const commit = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation(transactionId, finalOperations),
      { source: 'ui', historyLabel: 'Move viewport path' },
    );
    expect(commit.success).toBe(true);
    expect(commit.changedClipIds).toEqual(['clip-a']);
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    getHistoryStateView().undo();
    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });
    getHistoryStateView().redo();
    expect(getPositionKeyframe()).toMatchObject({ time: 3, value: 0.4 });
  });

  it('fails closed without closing a different numeric history batch that replaced its owned batch', () => {
    const transactionId = 'numeric-owner-mismatch';
    const operations = movePositionOperation(4.5, 0.65);

    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Graph drag',
    });
    useTimelineStore.getState().applyTimelineEditOperation(updateOperation(transactionId, operations), {
      source: 'ui',
      historyLabel: 'Graph drag',
      deferHistoryCommit: true,
    });

    const ownedBatchId = getHistoryStateView().batchId;
    expect(ownedBatchId).not.toBeNull();
    const replacementBatchId = (ownedBatchId ?? 0) + 10_000;
    useHistoryStore.setState({
      batchId: replacementBatchId,
      batchLabel: 'Foreign replacement batch',
    });

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation(transactionId, operations),
      { source: 'ui', historyLabel: 'Graph drag' },
    );
    expect(result.success).toBe(false);
    expect(result.warnings[0]?.message).toContain('lost its attached history batch');
    expect(getHistoryStateView().batchId).toBe(replacementBatchId);
    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });

    getHistoryStateView().cancelBatch();
  });

  it('attaches to but never closes a foreign outer AI history batch', () => {
    const outer = getHistoryStateView().startBatch('Outer AI batch');
    expect(outer.opened).toBe(true);
    const transactionId = 'foreign-batch';
    const operations = movePositionOperation(4, 0.6);

    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Graph edit',
    });
    useTimelineStore.getState().applyTimelineEditOperation(updateOperation(transactionId, operations), {
      source: 'ui',
      historyLabel: 'Graph edit',
      deferHistoryCommit: true,
    });
    useTimelineStore.getState().applyTimelineEditOperation(commitOperation(transactionId, operations), {
      source: 'ui',
      historyLabel: 'Graph edit',
    });

    expect(getHistoryStateView().batchId).toBe(outer.batchId);
    expect(getPositionKeyframe()).toMatchObject({ time: 4, value: 0.6 });
    getHistoryStateView().endBatch();
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it('treats a deferred update without begin inside a foreign batch as a one-shot operation', () => {
    const outer = getHistoryStateView().startBatch('Outer AI batch');
    const transactionId = 'path-action-one-shot';

    const update = useTimelineStore.getState().applyTimelineEditOperation(
      updateOperation(transactionId, movePositionOperation(3.5, 0.55)),
      { source: 'ui', historyLabel: 'Update motion path', deferHistoryCommit: true },
    );

    expect(update.success).toBe(true);
    expect(getPositionKeyframe()).toMatchObject({ time: 3.5, value: 0.55 });
    expect(getHistoryStateView().batchId).toBe(outer.batchId);

    // Reusing the transaction ID with a different logical history ID proves
    // that the implicit update did not leave a transaction session behind.
    const replacementBegin = {
      ...beginOperation(transactionId),
      historyBatchId: 'replacement-history',
    } satisfies KeyframeTransactionBeginOperation;
    expect(useTimelineStore.getState().applyTimelineEditOperation(replacementBegin, {
      source: 'ui',
      historyLabel: 'Replacement transaction',
    }).success).toBe(true);

    const replacementCancel = {
      ...cancelOperation(transactionId),
      historyBatchId: 'replacement-history',
    } satisfies KeyframeTransactionCancelOperation;
    expect(useTimelineStore.getState().applyTimelineEditOperation(replacementCancel, {
      source: 'ui',
      historyLabel: 'Replacement transaction',
    }).success).toBe(true);
    expect(getHistoryStateView().batchId).toBe(outer.batchId);

    getHistoryStateView().endBatch();
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it('restores original keyframe values and selection when its own transaction is cancelled', () => {
    const transactionId = 'cancel-owned';
    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Viewport drag',
    });
    useTimelineStore.getState().applyTimelineEditOperation(
      updateOperation(transactionId, movePositionOperation(5, 0.8)),
      { source: 'ui', historyLabel: 'Viewport drag', deferHistoryCommit: true },
    );
    useTimelineStore.setState({ selectedKeyframeIds: new Set(['kf-opacity']) });

    const cancel = useTimelineStore.getState().applyTimelineEditOperation(cancelOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Viewport drag',
    });

    expect(cancel.success).toBe(true);
    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual(['kf-position']);
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('restores only its keyframe targets on cancel without closing a foreign batch', () => {
    const outer = getHistoryStateView().startBatch('Outer AI batch');
    const transactionId = 'cancel-foreign';
    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Graph drag',
    });
    useTimelineStore.getState().applyTimelineEditOperation(
      updateOperation(transactionId, movePositionOperation(6, 0.9)),
      { source: 'ui', historyLabel: 'Graph drag', deferHistoryCommit: true },
    );

    useTimelineStore.getState().applyTimelineEditOperation(cancelOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Graph drag',
    });

    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });
    expect(getHistoryStateView().batchId).toBe(outer.batchId);
    getHistoryStateView().endBatch();
  });

  it('applies multi-property multi-clip operations atomically through the same transaction', () => {
    const transactionId = 'multi-target';
    const operations: KeyframeEditOperation[] = [
      ...movePositionOperation(2.5, 0.3),
      {
        type: 'keyframe-update-value',
        keyframeId: 'kf-opacity',
        clipId: 'clip-b',
        property: 'opacity',
        value: { value: 0.75 },
      },
    ];

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation(transactionId, operations),
      { source: 'ui', historyLabel: 'Edit graph keyframes' },
    );

    expect(result.success).toBe(true);
    expect(new Set(result.changedClipIds)).toEqual(new Set(['clip-a', 'clip-b']));
    expect(getPositionKeyframe()).toMatchObject({ time: 2.5, value: 0.3 });
    expect(useTimelineStore.getState().clipKeyframes.get('clip-b')?.[0]).toMatchObject({ value: 0.75 });
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it('preflights all targets and leaves every keyframe untouched when one target is invalid', () => {
    const operations: KeyframeEditOperation[] = [
      ...movePositionOperation(7, 0.7),
      {
        type: 'keyframe-update-value',
        keyframeId: 'kf-missing',
        clipId: 'clip-b',
        property: 'opacity',
        value: { value: 1 },
      },
    ];

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation('invalid-target', operations),
      { source: 'ui', historyLabel: 'Edit graph keyframes' },
    );

    expect(result.success).toBe(false);
    expect(result.warnings.map(warning => warning.code)).toContain('keyframe-not-found');
    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });
    expect(useTimelineStore.getState().clipKeyframes.get('clip-b')?.[0]).toMatchObject({ value: 0.5 });
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('commits a selection-only transaction instead of rolling the selection back', () => {
    const operation: KeyframeEditOperation = {
      type: 'keyframe-select',
      selectedKeyframeIds: ['kf-opacity'],
      mode: 'replace',
    };

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation('selection-only', [operation], []),
      { source: 'ui', historyLabel: 'Select graph keyframe' },
    );

    expect(result.success).toBe(true);
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual(['kf-opacity']);
    expect(getHistoryStateView().batchId).toBeNull();
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('does not let a standalone cancel discard an unrelated keyframe', () => {
    const cancel = {
      ...cancelOperation('missing-session'),
      discardKeyframeIds: ['kf-opacity'],
    } satisfies KeyframeTransactionCancelOperation;

    const result = useTimelineStore.getState().applyTimelineEditOperation(cancel, {
      source: 'ui',
      historyLabel: 'Cancel missing transaction',
    });

    expect(result.success).toBe(false);
    expect(result.warnings[0]?.code).toBe('no-op');
    expect(useTimelineStore.getState().clipKeyframes.get('clip-b')?.[0]?.id).toBe('kf-opacity');
  });

  it('lets explicit discard win over restoring the same begin snapshot keyframe', () => {
    const transactionId = 'discard-snapshot-target';
    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Begin temporary keyframe edit',
    });
    useTimelineStore.getState().applyTimelineEditOperation(
      updateOperation(transactionId, movePositionOperation(2, 0.2)),
      { source: 'ui', historyLabel: 'Update temporary keyframe edit', deferHistoryCommit: true },
    );

    const cancel = {
      ...cancelOperation(transactionId),
      discardKeyframeIds: ['kf-position'],
    } satisfies KeyframeTransactionCancelOperation;
    expect(useTimelineStore.getState().applyTimelineEditOperation(cancel, {
      source: 'ui',
      historyLabel: 'Discard temporary keyframe',
    }).success).toBe(true);

    expect(getPositionKeyframe()).toBeUndefined();
    expect(getHistoryStateView().batchId).toBeNull();
  });

  it('rejects active cancel discard ids outside the transaction scope', () => {
    const transactionId = 'foreign-discard-target';
    useTimelineStore.getState().applyTimelineEditOperation(beginOperation(transactionId), {
      source: 'ui',
      historyLabel: 'Begin scoped keyframe edit',
    });

    const cancel = {
      ...cancelOperation(transactionId),
      discardKeyframeIds: ['kf-opacity'],
    } satisfies KeyframeTransactionCancelOperation;
    const result = useTimelineStore.getState().applyTimelineEditOperation(cancel, {
      source: 'ui',
      historyLabel: 'Reject foreign discard',
    });

    expect(result.success).toBe(false);
    expect(result.warnings[0]?.message).toContain('outside transaction scope');
    expect(getPositionKeyframe()).toMatchObject({ id: 'kf-position', time: 1, value: 0.1 });
    expect(useTimelineStore.getState().clipKeyframes.get('clip-b')?.[0]?.id).toBe('kf-opacity');
  });

  it('rejects an empty update-value payload before applying sibling operations', () => {
    const operations: KeyframeEditOperation[] = [
      ...movePositionOperation(7, 0.7),
      {
        type: 'keyframe-update-value',
        keyframeId: 'kf-opacity',
        clipId: 'clip-b',
        property: 'opacity',
        value: {},
      },
    ];

    const result = useTimelineStore.getState().applyTimelineEditOperation(
      commitOperation('invalid-value-payload', operations),
      { source: 'ui', historyLabel: 'Edit graph keyframes' },
    );

    expect(result.success).toBe(false);
    expect(result.warnings.map(warning => warning.code)).toContain('unsupported');
    expect(getPositionKeyframe()).toMatchObject({ time: 1, value: 0.1 });
    expect(useTimelineStore.getState().clipKeyframes.get('clip-b')?.[0]).toMatchObject({ value: 0.5 });
  });
});
