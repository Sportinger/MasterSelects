import {
  bindHostedAgentK1ClientBatchResult,
  type HostedAgentK1ToolBatchRequestEvent,
} from './clientBridge';
import type {
  HostedAgentK1ClientAuthorityReceipt,
  HostedAgentK1ToolBatchResult,
  HostedAgentK1ToolResult,
} from './contracts';

export interface HostedAgentK2BatchExecutorResult {
  authority: HostedAgentK1ClientAuthorityReceipt;
  results: HostedAgentK1ToolResult[];
}

export type HostedAgentK2BatchExecutor = (
  event: HostedAgentK1ToolBatchRequestEvent,
) => Promise<HostedAgentK2BatchExecutorResult>;

function batchKey(sessionId: string, sequence: number): string {
  return `${sessionId}:${sequence}`;
}

/**
 * Exactly-once ledger for one browser-tab turn. Completed batches can be
 * restored after a reload so an acknowledged or in-flight result is reposted
 * without executing the editor mutation twice.
 */
export class HostedAgentK2InPageLedger {
  private readonly completed = new Map<string, HostedAgentK1ToolBatchResult>();
  private readonly inFlight = new Map<string, Promise<HostedAgentK1ToolBatchResult>>();
  private readonly binding: {
    clientInstanceId: string;
    sessionId: string;
    toolSchemaVersion: string;
    turnId: string;
  };
  private nextSequence = 0;

  constructor(binding: {
    clientInstanceId: string;
    completedBatches?: HostedAgentK1ToolBatchResult[];
    sessionId: string;
    toolSchemaVersion: string;
    turnId: string;
  }) {
    this.binding = binding;
    const restored = [...(binding.completedBatches ?? [])]
      .toSorted((left, right) => left.sequence - right.sequence);
    for (const batch of restored) {
      if (
        batch.clientInstanceId !== binding.clientInstanceId
        || batch.sessionId !== binding.sessionId
        || batch.turnId !== binding.turnId
        || batch.toolSchemaVersion !== binding.toolSchemaVersion
        || batch.sequence !== this.nextSequence
      ) {
        throw new Error('The restored hosted-agent tool ledger is invalid.');
      }
      this.completed.set(batchKey(binding.sessionId, batch.sequence), batch);
      this.nextSequence += 1;
    }
  }

  get expectedSequence(): number {
    return this.nextSequence;
  }

  get completedBatchCount(): number {
    return this.completed.size;
  }

  getCachedBatch(sequence: number): HostedAgentK1ToolBatchResult | null {
    return this.completed.get(batchKey(this.binding.sessionId, sequence)) ?? null;
  }

  completedBatches(): HostedAgentK1ToolBatchResult[] {
    return [...this.completed.values()]
      .toSorted((left, right) => left.sequence - right.sequence)
      .map((batch) => structuredClone(batch));
  }

  async executeOnce(
    event: HostedAgentK1ToolBatchRequestEvent,
    execute: HostedAgentK2BatchExecutor,
  ): Promise<HostedAgentK1ToolBatchResult> {
    if (
      event.sessionId !== this.binding.sessionId
      || event.turnId !== this.binding.turnId
      || event.toolSchemaVersion !== this.binding.toolSchemaVersion
      || !Number.isInteger(event.sequence)
      || event.sequence < 0
    ) {
      throw new Error('The hosted-agent tool batch does not match this open-page ledger.');
    }

    const key = batchKey(event.sessionId, event.sequence);
    const cached = this.completed.get(key);
    if (cached) {
      return cached;
    }
    const running = this.inFlight.get(key);
    if (running) {
      return running;
    }
    if (event.sequence !== this.nextSequence) {
      throw new Error('The hosted-agent tool batch sequence is skipped or reordered.');
    }

    const promise = (async () => {
      const executed = await execute(event);
      const batch = bindHostedAgentK1ClientBatchResult({
        authority: executed.authority,
        clientInstanceId: this.binding.clientInstanceId,
        event,
        results: executed.results,
      });
      // Record the complete grouped result before any network acknowledgement.
      this.completed.set(key, batch);
      this.nextSequence += 1;
      return batch;
    })();
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
