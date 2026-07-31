import type {
  HostedAgentEvent,
  HostedAgentK1ToolBatchResult,
  HostedAgentK2BatchPostResponse,
  HostedAgentK2EventReplay,
  HostedAgentK2LargeResultReference,
  HostedAgentK2PageLease,
  HostedAgentK2SessionStatus,
  HostedAgentToolExecutionMode,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

const DEFAULT_ACTIVE_LEASE_MS = 55_000;
const DEFAULT_TERMINAL_TTL_MS = 60_000;
const DEFAULT_LARGE_RESULT_TTL_MS = 60_000;
const MAX_TOOL_RESULT_BYTES = 32 * 1024 * 1024;
const MAX_BINARY_RESULT_BYTES = 16 * 1024 * 1024;

export interface HostedAgentK2Diagnostic {
  action:
    | 'batch-result'
    | 'event'
    | 'large-result-created'
    | 'large-result-read'
    | 'session-created'
    | 'session-purged'
    | 'terminal';
  at: string;
  byteLength?: number;
  eventId?: string;
  eventKind?: HostedAgentEvent['kind'];
  sequence?: number;
  sessionId: string;
  status?: HostedAgentK2SessionStatus;
}

export type HostedAgentK2DiagnosticSink = (
  diagnostic: HostedAgentK2Diagnostic,
) => void;

interface BatchWaiter {
  reject(error: unknown): void;
  resolve(batch: HostedAgentK1ToolBatchResult): void;
}

interface StoredBatch {
  digest: string;
  result: HostedAgentK1ToolBatchResult;
}

interface HostedAgentK2StoredSession {
  abortController: AbortController;
  activeLeaseMs: number;
  clientInstanceId: string;
  createdAt: number;
  events: HostedAgentEvent[];
  leaseDigest: string;
  leaseExpiresAt: number;
  protectedState: unknown;
  purgeAt: number | null;
  resultBatches: Map<number, StoredBatch>;
  sessionId: string;
  status: HostedAgentK2SessionStatus;
  terminalTtlMs: number;
  toolBatchEvents: Map<number, Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>>;
  toolExecutionMode: HostedAgentToolExecutionMode;
  toolSchemaVersion: string;
  turnId: string;
  waiters: Map<number, Set<BatchWaiter>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(value: number): string {
  return new Date(value).toISOString();
}

function terminalStatusForEvent(
  event: HostedAgentEvent,
): Exclude<HostedAgentK2SessionStatus, 'active'> | null {
  if (event.kind === 'turn-complete') {
    return 'completed';
  }
  if (event.kind === 'turn-canceled') {
    return 'cancelled';
  }
  if (event.kind === 'turn-interrupted') {
    return 'interrupted';
  }
  if (event.kind === 'turn-failed') {
    return 'failed';
  }
  return null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function newSecret(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}_${crypto.randomUUID()}`;
}

function containsDataUrl(value: unknown): boolean {
  if (typeof value === 'string') {
    return /^\s*data:/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsDataUrl);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsDataUrl);
  }
  return false;
}

function error(message: string): Error {
  return new Error(`Hosted-agent K2: ${message}`);
}

export class HostedAgentK2MemorySessionStore {
  private readonly options: {
    diagnostics?: HostedAgentK2DiagnosticSink;
    now?: () => number;
  };
  private readonly sessions = new Map<string, HostedAgentK2StoredSession>();

  constructor(options: {
    diagnostics?: HostedAgentK2DiagnosticSink;
    now?: () => number;
  } = {}) {
    this.options = options;
  }

  private currentTime(): number {
    return this.options.now?.() ?? Date.now();
  }

  private diagnostic(input: Omit<HostedAgentK2Diagnostic, 'at'>): void {
    this.options.diagnostics?.({
      ...input,
      at: nowIso(this.currentTime()),
    });
  }

  private requireSession(sessionId: string, turnId?: string): HostedAgentK2StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session || (turnId !== undefined && session.turnId !== turnId)) {
      throw error('the session was not found.');
    }
    return session;
  }

  private async verifyLease(
    session: HostedAgentK2StoredSession,
    input: {
      clientInstanceId: string;
      leaseToken: string;
    },
    options: { renew: boolean },
  ): Promise<void> {
    const now = this.currentTime();
    if (session.purgeAt !== null && now >= session.purgeAt) {
      this.sessions.delete(session.sessionId);
      throw error('the protected session state has expired.');
    }
    if (
      session.clientInstanceId !== input.clientInstanceId
      || await sha256(input.leaseToken) !== session.leaseDigest
    ) {
      throw error('the page lease does not match this tab-bound session.');
    }
    if (session.status === 'active' && now >= session.leaseExpiresAt) {
      this.markTerminal(session, 'interrupted', 'The open-page lease expired.');
      throw error('the open-page lease expired; cross-reload resume is not allowed.');
    }
    if (options.renew && session.status === 'active') {
      session.leaseExpiresAt = now + session.activeLeaseMs;
    }
  }

  async createSession(input: {
    activeLeaseMs?: number;
    clientInstanceId: string;
    protectedState?: unknown;
    sessionId: string;
    terminalTtlMs?: number;
    toolExecutionMode: HostedAgentToolExecutionMode;
    toolSchemaVersion: string;
    turnId: string;
  }): Promise<HostedAgentK2PageLease> {
    if (this.sessions.has(input.sessionId)) {
      throw error('the session ID is already in use.');
    }
    const activeLeaseMs = input.activeLeaseMs ?? DEFAULT_ACTIVE_LEASE_MS;
    const terminalTtlMs = input.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
    if (
      !Number.isInteger(activeLeaseMs)
      || activeLeaseMs < 1_000
      || activeLeaseMs > 5 * 60_000
      || !Number.isInteger(terminalTtlMs)
      || terminalTtlMs < 1_000
      || terminalTtlMs > 10 * 60_000
    ) {
      throw error('the session lease or retention duration is invalid.');
    }
    const leaseToken = newSecret('hal');
    const now = this.currentTime();
    this.sessions.set(input.sessionId, {
      abortController: new AbortController(),
      activeLeaseMs,
      clientInstanceId: input.clientInstanceId,
      createdAt: now,
      events: [],
      leaseDigest: await sha256(leaseToken),
      leaseExpiresAt: now + activeLeaseMs,
      protectedState: clone(input.protectedState),
      purgeAt: null,
      resultBatches: new Map(),
      sessionId: input.sessionId,
      status: 'active',
      terminalTtlMs,
      toolBatchEvents: new Map(),
      toolExecutionMode: input.toolExecutionMode,
      toolSchemaVersion: input.toolSchemaVersion,
      turnId: input.turnId,
      waiters: new Map(),
    });
    this.diagnostic({
      action: 'session-created',
      sessionId: input.sessionId,
      status: 'active',
    });
    return {
      expiresAt: nowIso(now + activeLeaseMs),
      leaseToken,
      sessionId: input.sessionId,
    };
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getStatus(sessionId: string): HostedAgentK2SessionStatus {
    return this.requireSession(sessionId).status;
  }

  runtimeSignal(sessionId: string): AbortSignal {
    return this.requireSession(sessionId).abortController.signal;
  }

  readProtectedStateForRuntime<T>(sessionId: string): T {
    return clone(this.requireSession(sessionId).protectedState) as T;
  }

  appendRuntimeEvent(sessionId: string, event: HostedAgentEvent): void {
    const session = this.requireSession(sessionId, event.turnId);
    if (event.sessionId !== session.sessionId) {
      throw error('the runtime event has the wrong session binding.');
    }
    if (session.status !== 'active') {
      return;
    }
    const expectedEventId = session.events.length + 1;
    if (event.eventId !== String(expectedEventId)) {
      throw error('the runtime event cursor is skipped, duplicated, or reordered.');
    }
    if (event.kind === 'tool-batch-request') {
      if (
        event.toolSchemaVersion !== session.toolSchemaVersion
        || event.sequence !== session.toolBatchEvents.size
        || event.toolCalls.length === 0
        || new Set(event.toolCalls.map((call) => call.toolCallId)).size !== event.toolCalls.length
      ) {
        throw error('the runtime tool-batch event is invalid or reordered.');
      }
      session.toolBatchEvents.set(event.sequence, clone(event));
    }
    session.events.push(clone(event));
    this.diagnostic({
      action: 'event',
      byteLength: new TextEncoder().encode(JSON.stringify(event)).byteLength,
      eventId: event.eventId,
      eventKind: event.kind,
      sequence: event.kind === 'tool-batch-request' ? event.sequence : undefined,
      sessionId,
      status: session.status,
    });
    const terminalStatus = terminalStatusForEvent(event);
    if (terminalStatus) {
      this.finishTerminal(session, terminalStatus);
    }
  }

  private finishTerminal(
    session: HostedAgentK2StoredSession,
    status: Exclude<HostedAgentK2SessionStatus, 'active'>,
  ): void {
    if (session.status !== 'active') {
      return;
    }
    session.status = status;
    session.purgeAt = this.currentTime() + session.terminalTtlMs;
    const reason = error(`the session is ${status}.`);
    for (const waiters of session.waiters.values()) {
      for (const waiter of waiters) {
        waiter.reject(reason);
      }
    }
    session.waiters.clear();
    if (!session.abortController.signal.aborted) {
      session.abortController.abort(reason);
    }
    this.diagnostic({
      action: 'terminal',
      sessionId: session.sessionId,
      status,
    });
  }

  private markTerminal(
    session: HostedAgentK2StoredSession,
    status: 'cancelled' | 'interrupted',
    message: string,
  ): void {
    if (session.status !== 'active') {
      return;
    }
    const kind = status === 'cancelled' ? 'turn-canceled' : 'turn-interrupted';
    const event: HostedAgentEvent = {
      eventId: String(session.events.length + 1),
      kind,
      message,
      recoverable: false,
      sessionId: session.sessionId,
      turnId: session.turnId,
    };
    session.events.push(event);
    this.diagnostic({
      action: 'event',
      byteLength: new TextEncoder().encode(JSON.stringify(event)).byteLength,
      eventId: event.eventId,
      eventKind: event.kind,
      sessionId: session.sessionId,
      status,
    });
    this.finishTerminal(session, status);
  }

  async replayEvents(input: {
    afterEventId: string | null;
    clientInstanceId: string;
    leaseToken: string;
    limit?: number;
    sessionId: string;
    turnId: string;
  }): Promise<HostedAgentK2EventReplay> {
    const session = this.requireSession(input.sessionId, input.turnId);
    await this.verifyLease(session, input, { renew: true });
    const after = input.afterEventId === null ? 0 : Number(input.afterEventId);
    if (
      !Number.isInteger(after)
      || after < 0
      || after > session.events.length
      || (input.limit !== undefined && (
        !Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 1_000
      ))
    ) {
      throw error('the event replay cursor or limit is invalid.');
    }
    const events = session.events.slice(after, after + (input.limit ?? 1_000));
    return {
      cursor: events.at(-1)?.eventId ?? input.afterEventId,
      events: clone(events),
      leaseExpiresAt: nowIso(session.leaseExpiresAt),
      sessionId: session.sessionId,
      status: session.status,
      turnId: session.turnId,
    };
  }

  async assertPageLease(input: {
    clientInstanceId: string;
    leaseToken: string;
    sessionId: string;
    turnId: string;
  }): Promise<void> {
    await this.verifyLease(
      this.requireSession(input.sessionId, input.turnId),
      input,
      { renew: false },
    );
  }

  private validateBatch(
    session: HostedAgentK2StoredSession,
    batch: HostedAgentK1ToolBatchResult,
  ): void {
    const event = session.toolBatchEvents.get(batch.sequence);
    const expectedIds = event?.toolCalls.map((call) => call.toolCallId) ?? [];
    const actualIds = batch.results.map((result) => result.toolCallId);
    const encodedBytes = new TextEncoder().encode(JSON.stringify(batch)).byteLength;
    if (
      !event
      || batch.sessionId !== session.sessionId
      || batch.turnId !== session.turnId
      || batch.clientInstanceId !== session.clientInstanceId
      || batch.toolSchemaVersion !== session.toolSchemaVersion
      || batch.authority.policyChecked !== true
      || batch.authority.executionMode !== session.toolExecutionMode
      || batch.authority.validationPassed !== true
      || actualIds.length !== expectedIds.length
      || actualIds.some((id, index) => id !== expectedIds[index])
      || new Set(actualIds).size !== actualIds.length
      || encodedBytes > MAX_TOOL_RESULT_BYTES
      || containsDataUrl(batch)
      || batch.results.some((result) => result.imageResultRefs?.some((reference) => (
        !/^har_[A-Za-z0-9_-]+$/.test(reference)
      )))
    ) {
      throw error('the grouped client result is invalid, unsafe, or reordered.');
    }
  }

  async postToolResults(input: {
    batch: HostedAgentK1ToolBatchResult;
    clientInstanceId: string;
    leaseToken: string;
    sessionId: string;
    turnId: string;
  }): Promise<HostedAgentK2BatchPostResponse> {
    const session = this.requireSession(input.sessionId, input.turnId);
    await this.verifyLease(session, input, { renew: true });
    this.validateBatch(session, input.batch);
    const digest = await sha256(stableJson(input.batch));
    const existing = session.resultBatches.get(input.batch.sequence);
    if (existing) {
      if (existing.digest !== digest) {
        throw error('a conflicting replay attempted to replace an acknowledged batch.');
      }
      return {
        accepted: true,
        cursor: session.events.at(-1)?.eventId ?? '0',
        replayed: true,
        sequence: input.batch.sequence,
        sessionId: session.sessionId,
        status: session.status,
        turnId: session.turnId,
      };
    }
    session.resultBatches.set(input.batch.sequence, {
      digest,
      result: clone(input.batch),
    });
    const waiters = session.waiters.get(input.batch.sequence);
    if (waiters) {
      for (const waiter of waiters) {
        waiter.resolve(clone(input.batch));
      }
      session.waiters.delete(input.batch.sequence);
    }
    this.diagnostic({
      action: 'batch-result',
      byteLength: new TextEncoder().encode(JSON.stringify(input.batch)).byteLength,
      sequence: input.batch.sequence,
      sessionId: session.sessionId,
      status: session.status,
    });
    return {
      accepted: true,
      cursor: session.events.at(-1)?.eventId ?? '0',
      replayed: false,
      sequence: input.batch.sequence,
      sessionId: session.sessionId,
      status: session.status,
      turnId: session.turnId,
    };
  }

  async waitForToolResults(input: {
    sequence: number;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<HostedAgentK1ToolBatchResult> {
    const session = this.requireSession(input.sessionId);
    const existing = session.resultBatches.get(input.sequence);
    if (existing) {
      return clone(existing.result);
    }
    if (session.status !== 'active' || !session.toolBatchEvents.has(input.sequence)) {
      throw error('the requested tool batch is unavailable or the session is terminal.');
    }
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error('the runtime wait was cancelled.');
    }
    return new Promise<HostedAgentK1ToolBatchResult>((resolve, reject) => {
      const waiter: BatchWaiter = { reject, resolve };
      const waiters = session.waiters.get(input.sequence) ?? new Set<BatchWaiter>();
      waiters.add(waiter);
      session.waiters.set(input.sequence, waiters);
      input.signal?.addEventListener('abort', () => {
        waiters.delete(waiter);
        reject(input.signal?.reason ?? error('the runtime wait was cancelled.'));
      }, { once: true });
    });
  }

  async cancel(input: {
    clientInstanceId: string;
    leaseToken: string;
    sessionId: string;
    turnId: string;
  }): Promise<void> {
    const session = this.requireSession(input.sessionId, input.turnId);
    await this.verifyLease(session, input, { renew: false });
    this.markTerminal(session, 'cancelled', 'The user canceled the hosted-agent turn.');
  }

  async interruptForReload(input: {
    clientInstanceId: string;
    leaseToken: string;
    sessionId: string;
    turnId: string;
  }): Promise<void> {
    const session = this.requireSession(input.sessionId, input.turnId);
    await this.verifyLease(session, input, { renew: false });
    this.markTerminal(
      session,
      'interrupted',
      'The page reloaded; this v1 session cannot resume across pages.',
    );
  }

  sweep(): { interrupted: number; purged: number } {
    const now = this.currentTime();
    let interrupted = 0;
    let purged = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && now >= session.leaseExpiresAt) {
        this.markTerminal(session, 'interrupted', 'The open-page lease expired.');
        interrupted += 1;
      }
      if (session.purgeAt !== null && now >= session.purgeAt) {
        this.sessions.delete(session.sessionId);
        this.diagnostic({
          action: 'session-purged',
          sessionId: session.sessionId,
          status: session.status,
        });
        purged += 1;
      }
    }
    return { interrupted, purged };
  }

  emitDiagnostic(input: Omit<HostedAgentK2Diagnostic, 'at'>): void {
    this.diagnostic(input);
  }
}

interface StoredLargeResult {
  bytes: Uint8Array;
  expiresAt: number;
  id: string;
  mediaType: string;
  sessionId: string;
  turnId: string;
}

export class HostedAgentK2MemoryLargeResultStore {
  private readonly options: {
    now?: () => number;
  };
  private readonly results = new Map<string, StoredLargeResult>();
  private readonly sessions: HostedAgentK2MemorySessionStore;

  constructor(
    sessions: HostedAgentK2MemorySessionStore,
    options: {
      now?: () => number;
    } = {},
  ) {
    this.sessions = sessions;
    this.options = options;
  }

  private currentTime(): number {
    return this.options.now?.() ?? Date.now();
  }

  put(input: {
    bytes: Uint8Array;
    mediaType: string;
    sessionId: string;
    ttlMs?: number;
    turnId: string;
  }): HostedAgentK2LargeResultReference {
    const ttlMs = input.ttlMs ?? DEFAULT_LARGE_RESULT_TTL_MS;
    if (
      input.bytes.byteLength <= 0
      || input.bytes.byteLength > MAX_BINARY_RESULT_BYTES
      || !/^(?:application\/octet-stream|audio\/|image\/|video\/)/i.test(input.mediaType)
      || !Number.isInteger(ttlMs)
      || ttlMs < 1_000
      || ttlMs > 5 * 60_000
    ) {
      throw error('the binary result or short TTL is invalid.');
    }
    // Runtime-only access proves the owning session exists. Client reads still
    // require the page lease below.
    this.sessions.runtimeSignal(input.sessionId);
    const id = `har_${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = this.currentTime() + ttlMs;
    this.results.set(id, {
      bytes: input.bytes.slice(),
      expiresAt,
      id,
      mediaType: input.mediaType,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
    this.sessions.emitDiagnostic({
      action: 'large-result-created',
      byteLength: input.bytes.byteLength,
      sessionId: input.sessionId,
    });
    return {
      byteLength: input.bytes.byteLength,
      expiresAt: nowIso(expiresAt),
      id,
      mediaType: input.mediaType,
    };
  }

  async read(input: {
    clientInstanceId: string;
    id: string;
    leaseToken: string;
    sessionId: string;
    turnId: string;
  }): Promise<{ bytes: Uint8Array; mediaType: string }> {
    await this.sessions.assertPageLease(input);
    const stored = this.results.get(input.id);
    if (
      !stored
      || stored.sessionId !== input.sessionId
      || stored.turnId !== input.turnId
      || this.currentTime() >= stored.expiresAt
    ) {
      if (stored && this.currentTime() >= stored.expiresAt) {
        this.results.delete(stored.id);
      }
      throw error('the authenticated large-result reference is unavailable or expired.');
    }
    this.sessions.emitDiagnostic({
      action: 'large-result-read',
      byteLength: stored.bytes.byteLength,
      sessionId: stored.sessionId,
    });
    return {
      bytes: stored.bytes.slice(),
      mediaType: stored.mediaType,
    };
  }

  sweep(): number {
    const now = this.currentTime();
    let purged = 0;
    for (const result of this.results.values()) {
      if (now >= result.expiresAt || !this.sessions.hasSession(result.sessionId)) {
        this.results.delete(result.id);
        purged += 1;
      }
    }
    return purged;
  }
}

export {
  DEFAULT_ACTIVE_LEASE_MS as HOSTED_AGENT_K2_ACTIVE_LEASE_MS,
  DEFAULT_TERMINAL_TTL_MS as HOSTED_AGENT_K2_TERMINAL_TTL_MS,
  MAX_BINARY_RESULT_BYTES as HOSTED_AGENT_K2_MAX_BINARY_RESULT_BYTES,
  MAX_TOOL_RESULT_BYTES as HOSTED_AGENT_K2_MAX_TOOL_RESULT_BYTES,
};
