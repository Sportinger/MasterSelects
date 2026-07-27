import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
  useHistoryStore,
} from '../../stores/historyStore';
import { getTimelineRevision } from '../../stores/timeline/revisionMiddleware';

export interface AgentTransaction {
  transactionId: string;
  label: string;
  stateRevisionBefore: number;
  alreadyBatching: boolean;
}

export interface AgentTransactionCommitResult {
  stateRevisionAfter: number;
}

let transactionCounter = 0;
const openTransactionIds = new Set<string>();

export function beginAgentTransaction(label: string): AgentTransaction {
  const transactionId = `agent-tx-${++transactionCounter}`;
  const alreadyBatching = useHistoryStore.getState().batchId !== null;

  if (!alreadyBatching) {
    startBatch(label);
  }

  openTransactionIds.add(transactionId);
  return {
    transactionId,
    label,
    stateRevisionBefore: getTimelineRevision(),
    alreadyBatching,
  };
}

export function commitAgentTransaction(
  transaction: AgentTransaction,
): AgentTransactionCommitResult {
  try {
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
    if (!transaction.alreadyBatching) {
      cancelHistoryBatch();
    }
  } finally {
    openTransactionIds.delete(transaction.transactionId);
  }
}

export function isAgentTransactionOpen(): boolean {
  return openTransactionIds.size > 0;
}
