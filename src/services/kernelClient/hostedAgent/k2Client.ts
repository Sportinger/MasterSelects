import type {
  HostedAgentEvent,
  HostedAgentK2BatchPostResponse,
  HostedAgentK2EventReplay,
  HostedAgentK2PageLease,
  HostedAgentK2SessionStatus,
  HostedAgentK1ToolBatchResult,
  HostedAgentK2OperationResultPost,
  HostedAgentK2OperationSettlementPost,
} from './contracts';
import {
  HostedAgentK2InPageLedger,
  type HostedAgentK2BatchExecutor,
} from './k2Ledger';
import {
  KernelOperationRoundTripV1,
} from '../wp1Spike/operationRoundTrip';
import type { KernelOperationSessionDescriptorV1 } from '../wp1Spike/operationSessionAuthority';

type ToolBatchEvent = Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>;

export interface HostedAgentK2ClientTransport {
  cancel(input: HostedAgentK2BoundRequest & { signal?: AbortSignal }): Promise<void>;
  interrupt(input: HostedAgentK2BoundRequest): Promise<void>;
  postToolResults(input: HostedAgentK2BoundRequest & {
    batch: Awaited<ReturnType<HostedAgentK2InPageLedger['executeOnce']>>;
  }): Promise<HostedAgentK2BatchPostResponse>;
  postOperationResult(input: HostedAgentK2BoundRequest & HostedAgentK2OperationResultPost):
    Promise<HostedAgentK2BatchPostResponse>;
  postOperationSettlement(input: HostedAgentK2BoundRequest & HostedAgentK2OperationSettlementPost):
    Promise<HostedAgentK2BatchPostResponse>;
  replayEvents(input: HostedAgentK2BoundRequest & {
    afterEventId: string | null;
    signal?: AbortSignal;
  }): Promise<HostedAgentK2EventReplay>;
}

export interface HostedAgentK2BoundRequest {
  clientInstanceId: string;
  leaseToken: string;
  sessionId: string;
  turnId: string;
}

export interface HostedAgentK2ClientRunResult {
  cursor: string | null;
  status: Exclude<HostedAgentK2SessionStatus, 'active'>;
}

export interface HostedAgentK2ClientPersistedState {
  completedBatches: HostedAgentK1ToolBatchResult[];
  cursor: string | null;
  status: HostedAgentK2SessionStatus;
}

export type HostedAgentK2OperationRoundTripFactory = (
  descriptor: KernelOperationSessionDescriptorV1,
) => KernelOperationRoundTripV1;

export class HostedAgentK2ReconnectableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAgentK2ReconnectableError';
  }
}

function isTerminalEvent(event: HostedAgentEvent): boolean {
  return event.kind === 'turn-complete'
    || event.kind === 'turn-failed'
    || event.kind === 'turn-canceled'
    || event.kind === 'turn-interrupted';
}

function statusForTerminalEvent(
  event: HostedAgentEvent,
): Exclude<HostedAgentK2SessionStatus, 'active'> {
  if (event.kind === 'turn-complete') {
    return 'completed';
  }
  if (event.kind === 'turn-canceled') {
    return 'cancelled';
  }
  if (event.kind === 'turn-interrupted') {
    return 'interrupted';
  }
  return 'failed';
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Hosted-agent client session stopped.', 'AbortError');
}

async function retryPause(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) {
    throw abortError(signal);
  }
  if (delayMs <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(abortError(signal));
    }, { once: true });
  });
}

/**
 * Reconnectable client adapter for one open page. The lease and exactly-once
 * ledger live only in this object and are never project-persisted.
 */
export class HostedAgentK2ClientSession {
  private closed = false;
  private cursor: string | null = null;
  private readonly operationAbortController = new AbortController();
  private readonly input: {
    clientInstanceId: string;
    lease: HostedAgentK2PageLease;
    onStateChange?: (state: HostedAgentK2ClientPersistedState) => void;
    toolSchemaVersion: string;
    transport: HostedAgentK2ClientTransport;
    turnId: string;
  };
  private terminalStatus: Exclude<HostedAgentK2SessionStatus, 'active'> | null = null;
  private operationRoundTrip: KernelOperationRoundTripV1 | null = null;

  readonly ledger: HostedAgentK2InPageLedger;

  constructor(input: {
    clientInstanceId: string;
    completedBatches?: HostedAgentK1ToolBatchResult[];
    cursor?: string | null;
    lease: HostedAgentK2PageLease;
    onStateChange?: (state: HostedAgentK2ClientPersistedState) => void;
    toolSchemaVersion: string;
    transport: HostedAgentK2ClientTransport;
    turnId: string;
  }) {
    if (input.cursor !== undefined && input.cursor !== null && !/^[1-9]\d*$/.test(input.cursor)) {
      throw new Error('The restored hosted-agent event cursor is invalid.');
    }
    this.input = input;
    this.cursor = input.cursor ?? null;
    this.ledger = new HostedAgentK2InPageLedger({
      clientInstanceId: input.clientInstanceId,
      completedBatches: input.completedBatches,
      sessionId: input.lease.sessionId,
      toolSchemaVersion: input.toolSchemaVersion,
      turnId: input.turnId,
    });
  }

  get lastEventId(): string | null {
    return this.cursor;
  }

  get status(): HostedAgentK2SessionStatus {
    return this.terminalStatus ?? 'active';
  }

  private boundRequest(): HostedAgentK2BoundRequest {
    return {
      clientInstanceId: this.input.clientInstanceId,
      leaseToken: this.input.lease.leaseToken,
      sessionId: this.input.lease.sessionId,
      turnId: this.input.turnId,
    };
  }

  private persistState(): void {
    this.input.onStateChange?.({
      completedBatches: this.ledger.completedBatches(),
      cursor: this.cursor,
      status: this.status,
    });
  }

  private abortLocalOperations(reason: unknown): void {
    if (!this.operationAbortController.signal.aborted) {
      this.operationAbortController.abort(reason);
    }
    this.operationRoundTrip?.abortPending();
  }

  private assertReplayBinding(replay: HostedAgentK2EventReplay): void {
    if (
      replay.sessionId !== this.input.lease.sessionId
      || replay.turnId !== this.input.turnId
    ) {
      throw new Error('The hosted-agent replay does not match this page session.');
    }
  }

  private async acceptEvent(
    event: HostedAgentEvent,
    execute: HostedAgentK2BatchExecutor,
    onEvent?: (event: HostedAgentEvent) => void,
    signal?: AbortSignal,
    createOperationRoundTrip?: HostedAgentK2OperationRoundTripFactory,
  ): Promise<void> {
    if (
      event.sessionId !== this.input.lease.sessionId
      || event.turnId !== this.input.turnId
      || !/^[1-9]\d*$/.test(event.eventId)
    ) {
      throw new Error('The hosted-agent event binding or cursor is invalid.');
    }
    const eventNumber = Number(event.eventId);
    const cursorNumber = this.cursor === null ? 0 : Number(this.cursor);
    if (eventNumber <= cursorNumber) {
      return;
    }
    if (eventNumber !== cursorNumber + 1) {
      throw new Error('The hosted-agent event stream skipped or reordered an event.');
    }

    if (event.kind === 'operation-session-ready') {
      if (this.operationRoundTrip !== null || !createOperationRoundTrip) {
        throw new Error('The hosted-agent operation session is duplicated or unsupported.');
      }
      this.operationRoundTrip = createOperationRoundTrip(event.descriptor);
    } else if (event.kind === 'operation-plan-request') {
      if (!this.operationRoundTrip) {
        throw new Error('The hosted-agent operation plan has no authenticated session authority.');
      }
      const operationSignal = this.operationAbortController.signal;
      const result = await this.operationRoundTrip.execute(
        event.request,
        Date.now(),
        operationSignal,
      );
      this.persistState();
      if (operationSignal.aborted && result.status !== 'committed') {
        this.operationRoundTrip.abortPending();
        throw abortError(operationSignal);
      }
      await this.input.transport.postOperationResult({
        ...this.boundRequest(),
        result,
      });
    } else if (event.kind === 'operation-plan-settlement') {
      if (!this.operationRoundTrip) {
        throw new Error('The hosted-agent operation settlement has no prepared execution.');
      }
      if (this.operationAbortController.signal.aborted) {
        this.operationRoundTrip.abortPending();
        throw abortError(this.operationAbortController.signal);
      }
      const receipt = await this.operationRoundTrip.settle(event.settlement);
      this.persistState();
      await this.input.transport.postOperationSettlement({
        ...this.boundRequest(),
        receipt,
      });
    } else if (event.kind === 'tool-batch-request') {
      const batch = await this.ledger.executeOnce(event as ToolBatchEvent, execute);
      // Persist the complete result before posting it. If the page reloads
      // during the acknowledgement, the next page reposts this same batch
      // instead of executing the editor mutation again.
      this.persistState();
      if (signal?.aborted) {
        throw abortError(signal);
      }
      await this.input.transport.postToolResults({
        ...this.boundRequest(),
        batch,
      });
    }
    onEvent?.(event);
    this.cursor = event.eventId;
    if (isTerminalEvent(event)) {
      this.operationRoundTrip?.abortPending();
      this.terminalStatus = statusForTerminalEvent(event);
      this.closed = true;
    }
    this.persistState();
  }

  async runUntilTerminal(input: {
    createOperationRoundTrip?: HostedAgentK2OperationRoundTripFactory;
    execute: HostedAgentK2BatchExecutor;
    maximumReconnects?: number;
    onEvent?: (event: HostedAgentEvent) => void;
    reconnectDelayMs?: number;
    signal?: AbortSignal;
  }): Promise<HostedAgentK2ClientRunResult> {
    const maximumReconnects = input.maximumReconnects ?? 32;
    let reconnects = 0;
    if (input.signal) {
      const externalSignal = input.signal;
      const abortOperations = () => this.abortLocalOperations(abortError(externalSignal));
      if (externalSignal.aborted) abortOperations();
      else externalSignal.addEventListener('abort', abortOperations, { once: true });
    }
    while (!this.closed) {
      if (input.signal?.aborted) {
        await this.cancelAndDrainAccounting(input.onEvent);
        throw abortError(input.signal);
      }
      try {
        const replay = await this.input.transport.replayEvents({
          ...this.boundRequest(),
          afterEventId: this.cursor,
        });
        this.assertReplayBinding(replay);
        for (const event of replay.events) {
          if (this.closed) break;
          await this.acceptEvent(
            event,
            input.execute,
            input.onEvent,
            input.signal,
            input.createOperationRoundTrip,
          );
          if (this.closed) {
            break;
          }
        }
        if (
          !this.closed
          && replay.status !== 'active'
          && replay.events.length === 0
        ) {
          throw new Error('The hosted-agent terminal state has no ordered terminal event.');
        }
        reconnects = 0;
      } catch (error) {
        if (this.closed) {
          if (input.signal?.aborted) {
            throw abortError(input.signal);
          }
          break;
        }
        if (input.signal?.aborted) {
          await this.cancelAndDrainAccounting(input.onEvent);
          throw abortError(input.signal);
        }
        if (!(error instanceof HostedAgentK2ReconnectableError)) {
          throw error;
        }
        reconnects += 1;
        if (reconnects > maximumReconnects) {
          throw error;
        }
      }
      if (!this.closed) {
        if (input.signal?.aborted) {
          await this.cancelAndDrainAccounting(input.onEvent);
          throw abortError(input.signal);
        }
        try {
          await retryPause(input.reconnectDelayMs ?? 250, input.signal);
        } catch (error) {
          if (input.signal?.aborted) {
            await this.cancelAndDrainAccounting(input.onEvent);
            throw abortError(input.signal);
          }
          throw error;
        }
      }
    }
    return {
      cursor: this.cursor,
      status: this.terminalStatus ?? 'interrupted',
    };
  }

  private async cancelAndDrainAccounting(
    onEvent?: (event: HostedAgentEvent) => void,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.terminalStatus = 'cancelled';
    this.abortLocalOperations(new DOMException('Hosted-agent turn was canceled.', 'AbortError'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      try {
        await this.input.transport.cancel({
          ...this.boundRequest(),
          signal: controller.signal,
        });
      } catch {
        // Cancellation delivery is best effort. The authoritative account
        // reconciliation remains the final fallback.
      }

      try {
        const replay = await this.input.transport.replayEvents({
          ...this.boundRequest(),
          afterEventId: this.cursor,
          signal: controller.signal,
        });
        this.assertReplayBinding(replay);
        let cursorNumber = this.cursor === null ? 0 : Number(this.cursor);
        for (const event of replay.events) {
          if (
            event.sessionId !== this.input.lease.sessionId
            || event.turnId !== this.input.turnId
            || !/^[1-9]\d*$/.test(event.eventId)
          ) {
            throw new Error('The hosted-agent accounting drain binding is invalid.');
          }
          const eventNumber = Number(event.eventId);
          if (eventNumber <= cursorNumber) {
            continue;
          }
          if (eventNumber !== cursorNumber + 1) {
            throw new Error('The hosted-agent accounting drain skipped an event.');
          }
          if (event.kind === 'billing-settled' || isTerminalEvent(event)) {
            onEvent?.(event);
          }
          this.cursor = event.eventId;
          cursorNumber = eventNumber;
          if (isTerminalEvent(event)) {
            this.terminalStatus = statusForTerminalEvent(event);
          }
        }
      } catch {
        // A bounded terminal account refresh reconciles an unavailable drain.
      }
    } finally {
      clearTimeout(timeout);
      this.persistState();
    }
  }

  async cancel(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.terminalStatus = 'cancelled';
    this.abortLocalOperations(new DOMException('Hosted-agent turn was canceled.', 'AbortError'));
    await this.input.transport.cancel(this.boundRequest());
  }

  /**
   * Legacy tool-batch turns remain resumable from their persisted ledger.
   * A live operation round trip owns an in-memory editor transaction and is
   * therefore terminal on full-page detach: abort locally, discard resumable
   * state, and best-effort interrupt the server with the short lease as the
   * orphan fallback.
   */
  detachForReload(): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalStatus = 'interrupted';
    this.abortLocalOperations(new DOMException('Hosted-agent page detached.', 'AbortError'));
    if (this.operationRoundTrip) {
      this.persistState();
      void this.input.transport.interrupt(this.boundRequest()).catch(() => {
        // Page-unload delivery is best effort; lease expiry is authoritative.
      });
    }
  }

  /**
   * Called from the page lifecycle. This intentionally cannot be undone; a new
   * page must not reuse the old in-memory ledger or page lease.
   */
  async interruptForReload(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.terminalStatus = 'interrupted';
    this.abortLocalOperations(new DOMException('Hosted-agent page reloaded.', 'AbortError'));
    try {
      await this.input.transport.interrupt(this.boundRequest());
    } catch {
      // Page-unload delivery is best effort; the short server lease is the
      // authoritative orphan cleanup path.
    }
  }
}
