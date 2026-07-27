import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
  useHistoryStore,
} from '../../stores/historyStore';
import { getTimelineRevision } from '../../stores/timeline/revisionMiddleware';
import { Logger } from '../logger';
import {
  MODIFYING_TOOLS,
  type AIToolCallExecutionResult,
} from './types';

const log = Logger.create('AgentTransaction');

export interface AgentTransaction {
  transactionId: string;
  label: string;
  stateRevisionBefore: number;
  alreadyBatching: boolean;
  historyBatchId: number | null;
  abortNoop: boolean;
}

export interface AgentTransactionCommitResult {
  stateRevisionAfter: number;
}

export interface GroupedPartialFailureInfo {
  occurred: true;
  rolledBack: boolean;
  rollbackDeferred: boolean;
  transactionOwnershipLost: boolean;
  failedModifyingTools: Array<{
    id?: string;
    tool: string;
    error?: string;
  }>;
}

let transactionCounter = 0;
const openTransactionIds = new Set<string>();

export function beginAgentTransaction(label: string): AgentTransaction {
  const transactionId = `agent-tx-${++transactionCounter}`;
  const existingBatchId = useHistoryStore.getState().batchId;
  const alreadyBatching = existingBatchId !== null;

  if (!alreadyBatching) {
    startBatch(label);
  }

  const historyBatchId = alreadyBatching
    ? existingBatchId
    : useHistoryStore.getState().batchId;
  openTransactionIds.add(transactionId);
  return {
    transactionId,
    label,
    stateRevisionBefore: getTimelineRevision(),
    alreadyBatching,
    historyBatchId,
    abortNoop: alreadyBatching,
  };
}

function hasHistoryBatchOwnership(transaction: AgentTransaction): boolean {
  const currentBatchId = useHistoryStore.getState().batchId;
  if (currentBatchId === transaction.historyBatchId) {
    return true;
  }

  log.warn('transaction ownership lost', {
    transactionId: transaction.transactionId,
    expectedBatchId: transaction.historyBatchId,
    currentBatchId,
  });
  return false;
}

export function commitAgentTransaction(
  transaction: AgentTransaction,
): AgentTransactionCommitResult {
  try {
    if (!hasHistoryBatchOwnership(transaction)) {
      return {
        stateRevisionAfter: getTimelineRevision(),
      };
    }
    if (!transaction.alreadyBatching) {
      endBatch();
    }
    return {
      stateRevisionAfter: getTimelineRevision(),
    };
  } finally {
    openTransactionIds.delete(transaction.transactionId);
  }
}

export function abortAgentTransaction(transaction: AgentTransaction): void {
  try {
    if (!hasHistoryBatchOwnership(transaction)) {
      return;
    }
    if (transaction.abortNoop) {
      log.warn('Agent transaction rollback deferred to the outer owner', {
        transactionId: transaction.transactionId,
        historyBatchId: transaction.historyBatchId,
      });
      return;
    }
    cancelHistoryBatch();
  } finally {
    openTransactionIds.delete(transaction.transactionId);
  }
}

export function createGroupedPartialFailureInfo(
  results: AIToolCallExecutionResult[],
  transaction: AgentTransaction | null,
  historySuppressed: boolean,
): GroupedPartialFailureInfo | null {
  const failedModifyingTools = results
    .filter((entry) => MODIFYING_TOOLS.has(entry.tool) && entry.result.success === false)
    .map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      tool: entry.tool,
      ...(entry.result.error ? { error: entry.result.error } : {}),
    }));
  if (failedModifyingTools.length === 0) {
    return null;
  }

  const transactionOwnershipLost = transaction !== null
    && useHistoryStore.getState().batchId !== transaction.historyBatchId;
  const rolledBack = transaction !== null
    && transaction.historyBatchId !== null
    && !transaction.abortNoop
    && !transactionOwnershipLost;

  return {
    occurred: true,
    rolledBack,
    rollbackDeferred: transaction?.abortNoop === true || historySuppressed,
    transactionOwnershipLost,
    failedModifyingTools,
  };
}

export function attachGroupedPartialFailure(
  results: AIToolCallExecutionResult[],
  partialFailure: GroupedPartialFailureInfo,
): AIToolCallExecutionResult[] {
  return results.map((entry) => {
    const existingData = entry.result.data;
    const data = existingData !== null
      && typeof existingData === 'object'
      && !Array.isArray(existingData)
      ? existingData as Record<string, unknown>
      : existingData === undefined
        ? {}
        : { originalData: existingData };

    return {
      ...entry,
      result: {
        ...entry.result,
        data: {
          ...data,
          partialFailure,
        },
      },
    };
  });
}

export function isAgentTransactionOpen(): boolean {
  return openTransactionIds.size > 0;
}
