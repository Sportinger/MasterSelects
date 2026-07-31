import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
  useHistoryStore,
} from '../../historyStore';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import { resultFromWarnings } from './editOperationResults';
import {
  changedKeyframeClipIds,
  keyframeSnapshot,
} from './keyframeTransactionHelpers';
import { applyKeyframeTransactionMutations } from './keyframeTransactionMutationOperations';
import {
  collectKeyframeIds,
  preflightKeyframeTransaction,
  recordCreatedKeyframeIds,
  rememberKeyframeTransactionTargets,
  restoreKeyframeTransactionTargets,
  type KeyframeTransactionTargetSnapshot,
} from './keyframeTransactionPlanning';
import type { KeyframeTransactionOperation } from './transactionTypes';
import type { TimelineEditOperation, TimelineEditResult, TimelineEditWarning } from './types';

type KeyframeTransactionSession = KeyframeTransactionTargetSnapshot & {
  transactionId: string;
  historyBatchId: string;
  originalSelection: Set<string>;
  ownedHistoryBatchId: number | null;
  attachedHistoryBatchId: number | null;
  historyBatchResolved: boolean;
  changedClipIds: Set<string>;
  hasContentMutation: boolean;
  hasSelectionMutation: boolean;
};

const activeKeyframeTransactions = new Map<string, KeyframeTransactionSession>();

export function isKeyframeTransactionOperation(operation: TimelineEditOperation): operation is KeyframeTransactionOperation {
  return (
    operation.type === 'keyframe-transaction-begin' ||
    operation.type === 'keyframe-transaction-update' ||
    operation.type === 'keyframe-transaction-commit' ||
    operation.type === 'keyframe-transaction-cancel'
  );
}

function createTransactionSession(
  operation: KeyframeTransactionOperation,
  context: TimelineEditOperationApplyContext,
): KeyframeTransactionSession {
  const session: KeyframeTransactionSession = {
    transactionId: operation.transactionId,
    historyBatchId: operation.historyBatchId,
    originalSelection: new Set(context.get().selectedKeyframeIds),
    keyframesById: new Map(),
    createdKeyframeIds: new Set(),
    ownedHistoryBatchId: null,
    attachedHistoryBatchId: null,
    historyBatchResolved: false,
    changedClipIds: new Set(),
    hasContentMutation: false,
    hasSelectionMutation: false,
  };
  rememberKeyframeTransactionTargets(session, operation, context.get().clipKeyframes);
  activeKeyframeTransactions.set(operation.transactionId, session);
  return session;
}

function getKnownTransactionKeyframeIds(session: KeyframeTransactionSession | undefined): Set<string> {
  return new Set([
    ...(session?.keyframesById.keys() ?? []),
    ...(session?.createdKeyframeIds ?? []),
  ]);
}

function resolveHistoryBatch(
  session: KeyframeTransactionSession,
  historyLabel: string,
): void {
  if (session.historyBatchResolved) return;

  const historyBatch = startBatch(historyLabel);
  session.historyBatchResolved = true;
  session.attachedHistoryBatchId = historyBatch.batchId;
  session.ownedHistoryBatchId = historyBatch.opened ? historyBatch.batchId : null;
}

function ownsActiveHistoryBatch(session: KeyframeTransactionSession): boolean {
  return session.ownedHistoryBatchId !== null
    && useHistoryStore.getState().batchId === session.ownedHistoryBatchId;
}

function lostAttachedHistoryBatch(session: KeyframeTransactionSession): boolean {
  return session.historyBatchResolved
    && useHistoryStore.getState().batchId !== session.attachedHistoryBatchId;
}

function rollbackTransactionSession(
  context: TimelineEditOperationApplyContext,
  session: KeyframeTransactionSession,
  discardKeyframeIds: readonly string[] = [],
): string[] {
  const beforeKeyframes = keyframeSnapshot(context.get().clipKeyframes);

  if (ownsActiveHistoryBatch(session)) {
    cancelHistoryBatch();
  }

  context.set({
    clipKeyframes: restoreKeyframeTransactionTargets(
      session,
      context.get().clipKeyframes,
      discardKeyframeIds,
    ),
    selectedKeyframeIds: new Set(session.originalSelection),
  });
  context.get().invalidateCache();

  activeKeyframeTransactions.delete(session.transactionId);
  return changedKeyframeClipIds(beforeKeyframes, context.get().clipKeyframes);
}

function finalizeTransactionSession(
  session: KeyframeTransactionSession,
): void {
  if (ownsActiveHistoryBatch(session)) {
    if (session.hasContentMutation || session.hasSelectionMutation) {
      endBatch();
    } else {
      cancelHistoryBatch();
    }
  }
  activeKeyframeTransactions.delete(session.transactionId);
}

export function applyKeyframeTransactionOperation(
  operation: KeyframeTransactionOperation,
  context: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const { get, options } = context;
  const operationId = operation.id;
  const existingSession = activeKeyframeTransactions.get(operation.transactionId);
  const isImplicitUpdate = operation.type === 'keyframe-transaction-update'
    && existingSession === undefined;

  if (existingSession && existingSession.historyBatchId !== operation.historyBatchId) {
    rollbackTransactionSession(context, existingSession);
    return resultFromWarnings(operationId, [{
      code: 'unsupported',
      message: `Keyframe transaction history batch changed during ${operation.transactionId}.`,
      clipId: operation.clipId,
    }]);
  }

  if (existingSession
    && operation.type !== 'keyframe-transaction-cancel'
    && lostAttachedHistoryBatch(existingSession)) {
    rollbackTransactionSession(context, existingSession);
    return resultFromWarnings(operationId, [{
      code: 'unsupported',
      message: `Keyframe transaction lost its attached history batch during ${operation.transactionId}.`,
      clipId: operation.clipId,
    }]);
  }

  const preflightWarnings = preflightKeyframeTransaction(
    operation,
    {
      clips: get().clips,
      tracks: get().tracks,
      clipKeyframes: get().clipKeyframes,
    },
    getKnownTransactionKeyframeIds(existingSession),
  );
  if (preflightWarnings.length > 0) {
    if (existingSession) {
      rollbackTransactionSession(context, existingSession);
    }
    return resultFromWarnings(operationId, preflightWarnings);
  }

  if (operation.type === 'keyframe-transaction-begin') {
    const session = existingSession ?? createTransactionSession(operation, context);
    rememberKeyframeTransactionTargets(session, operation, get().clipKeyframes);
    return {
      success: true,
      operationId,
      changedClipIds: [],
      warnings: [],
    };
  }

  if (operation.type === 'keyframe-transaction-cancel') {
    if (!existingSession) {
      return resultFromWarnings(operationId, [{
        code: 'no-op',
        message: `Keyframe transaction is not active: ${operation.transactionId}.`,
        clipId: operation.clipId,
      }]);
    }
    const session = existingSession;
    const knownSessionKeyframeIds = getKnownTransactionKeyframeIds(session);
    const outOfScopeKeyframeIds = [
      ...operation.restoreKeyframeIds,
      ...operation.discardKeyframeIds,
    ].filter((keyframeId) => !knownSessionKeyframeIds.has(keyframeId));
    if (outOfScopeKeyframeIds.length > 0) {
      rollbackTransactionSession(context, session);
      return resultFromWarnings(operationId, [{
        code: 'unsupported',
        message: `Keyframe cancel referenced targets outside transaction scope: ${[...new Set(outOfScopeKeyframeIds)].join(', ')}.`,
        clipId: operation.clipId,
      }]);
    }
    rememberKeyframeTransactionTargets(session, operation, get().clipKeyframes);
    const changedClipIds = rollbackTransactionSession(
      context,
      session,
      operation.discardKeyframeIds,
    );
    return {
      success: true,
      operationId,
      changedClipIds,
      warnings: [],
    };
  }

  const session = existingSession ?? createTransactionSession(operation, context);
  rememberKeyframeTransactionTargets(session, operation, get().clipKeyframes);
  const hasContentOperation = operation.operations.some(
    (editOperation) => editOperation.type !== 'keyframe-select',
  );
  if (hasContentOperation) {
    resolveHistoryBatch(session, options.historyLabel ?? 'Edit keyframes');
  }

  const beforeKeyframes = keyframeSnapshot(get().clipKeyframes);
  const beforeSelection = new Set(get().selectedKeyframeIds);
  const beforeIds = collectKeyframeIds(get().clipKeyframes);
  const warnings: TimelineEditWarning[] = [];

  applyKeyframeTransactionMutations(operation.operations, context, warnings);
  recordCreatedKeyframeIds(session, beforeIds, get().clipKeyframes);

  if (warnings.length > 0) {
    rollbackTransactionSession(context, session);
    return resultFromWarnings(operationId, warnings);
  }

  const phaseChangedClipIds = changedKeyframeClipIds(beforeKeyframes, get().clipKeyframes);
  phaseChangedClipIds.forEach((clipId) => session.changedClipIds.add(clipId));
  if (phaseChangedClipIds.length > 0) {
    session.hasContentMutation = true;
  }
  const selectionChanged = JSON.stringify([...beforeSelection].sort()) !== JSON.stringify([...get().selectedKeyframeIds].sort());
  if (selectionChanged) {
    session.hasSelectionMutation = true;
  }

  // Some motion-path actions intentionally send a fresh deferred update inside
  // an outer history batch. Without a prior begin there can be no later phase
  // to finalize this session, so treat that protocol as a one-shot operation.
  const shouldFinalize = operation.type === 'keyframe-transaction-commit'
    || (operation.type === 'keyframe-transaction-update'
      && (options.deferHistoryCommit !== true || isImplicitUpdate));
  const accumulatedChangedClipIds = [...session.changedClipIds];
  const hadContentMutation = session.hasContentMutation;
  const hadSelectionMutation = session.hasSelectionMutation;
  if (shouldFinalize) {
    finalizeTransactionSession(session);
  }

  if (!hadContentMutation && !hadSelectionMutation) {
    return resultFromWarnings(operationId, [{
      code: 'no-op',
      message: 'No keyframes changed.',
    }]);
  }

  return {
    success: true,
    operationId,
    changedClipIds: accumulatedChangedClipIds,
    warnings: [],
  };
}
