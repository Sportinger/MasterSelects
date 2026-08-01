import {
  abortAgentTransaction,
  beginAgentTransaction,
  commitAgentTransaction,
  hasAgentTransactionOwnership,
  type AgentTransaction,
} from '../../aiTools/agentTransaction';
import {
  acquireExclusiveTimelineMutationLease,
  releaseExclusiveTimelineMutationLease,
  runWithExclusiveTimelineMutationLease,
  type ExclusiveTimelineMutationLease,
} from '../../../stores/timeline/exclusiveMutationLease';
import {
  PublicOperationTransactionOwnershipLostError,
  type BoundaryTransactionV1,
} from './candidateOneOperationExecutor';

interface Wp1AgentTransactionHandle {
  lease: ExclusiveTimelineMutationLease;
  transaction: AgentTransaction;
}

function agentTransactionHandle(handle: unknown): Wp1AgentTransactionHandle {
  if (
    handle === null
    || typeof handle !== 'object'
    || typeof (handle as Partial<Wp1AgentTransactionHandle>).transaction?.transactionId !== 'string'
    || typeof (handle as Partial<Wp1AgentTransactionHandle>).lease?.id !== 'symbol'
  ) {
    throw new Error('invalid agent transaction handle');
  }
  return handle as Wp1AgentTransactionHandle;
}

/**
 * Gives a kernel operation plan exclusive ownership of one history batch.
 * Existing outer batches are rejected because their abort is owned elsewhere
 * and therefore cannot satisfy task-level rollback.
 */
export function createWp1AgentTransactionAdapter(): BoundaryTransactionV1 {
  return {
    abort: (handle) => {
      const { lease, transaction } = agentTransactionHandle(handle);
      try {
        if (!hasAgentTransactionOwnership(transaction)) {
          commitAgentTransaction(transaction);
          throw new PublicOperationTransactionOwnershipLostError();
        }
        runWithExclusiveTimelineMutationLease(
          lease,
          () => abortAgentTransaction(transaction),
        );
      } finally {
        releaseExclusiveTimelineMutationLease(lease);
      }
    },
    begin: (label) => {
      const lease = acquireExclusiveTimelineMutationLease(label);
      try {
        const transaction = runWithExclusiveTimelineMutationLease(
          lease,
          () => beginAgentTransaction(label),
        );
        if (transaction.abortNoop || transaction.historyBatchId === null) {
          runWithExclusiveTimelineMutationLease(
            lease,
            () => abortAgentTransaction(transaction),
          );
          throw new Error('kernel operation requires an exclusive history transaction');
        }
        return { lease, transaction } satisfies Wp1AgentTransactionHandle;
      } catch (error) {
        releaseExclusiveTimelineMutationLease(lease);
        throw error;
      }
    },
    commit: (handle) => {
      const { lease, transaction } = agentTransactionHandle(handle);
      try {
        if (!hasAgentTransactionOwnership(transaction)) {
          commitAgentTransaction(transaction);
          throw new PublicOperationTransactionOwnershipLostError();
        }
        runWithExclusiveTimelineMutationLease(
          lease,
          () => commitAgentTransaction(transaction),
        );
      } finally {
        releaseExclusiveTimelineMutationLease(lease);
      }
    },
    run: (handle, action) => runWithExclusiveTimelineMutationLease(
      agentTransactionHandle(handle).lease,
      action,
    ),
  };
}
