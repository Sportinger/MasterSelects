import type {
  HostedAgentK3ExecutionRoute,
  HostedAgentK3ProviderRoute,
} from '../../../src/services/kernelClient/hostedAgent/k3Routing';

const DEFAULT_RETENTION_MS = 60 * 60_000;
const MAX_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_EVENTS = 2_048;
const MAX_EVENTS = 10_000;

export type HostedAgentK3TelemetryKind =
  | 'batch-result'
  | 'canary-route'
  | 'provider-round'
  | 'reconnect'
  | 'turn-terminal';

export type HostedAgentK3FailureCode =
  | 'billing'
  | 'cancelled'
  | 'contract'
  | 'interrupted'
  | 'network'
  | 'none'
  | 'provider'
  | 'tool';

export interface HostedAgentK3TelemetryRecord {
  at: string;
  byteLength?: number;
  creditsCharged?: number;
  executionRoute: HostedAgentK3ExecutionRoute;
  failureCode: HostedAgentK3FailureCode;
  kind: HostedAgentK3TelemetryKind;
  latencyMs?: number;
  providerRoute: HostedAgentK3ProviderRoute;
  reconnectCount?: number;
  roundIndex?: number;
  sessionCorrelation: string;
  toolCallCount?: number;
}

export interface HostedAgentK3TelemetryDashboard {
  completedTurns: number;
  eventCount: number;
  failedTurns: number;
  hostedRouteDecisions: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  reconnects: number;
  totalCreditsCharged: number;
  toolCalls: number;
}

function validBoundedNumber(value: number | undefined, maximum: number): boolean {
  return value === undefined
    || (Number.isFinite(value) && value >= 0 && value <= maximum);
}

async function sessionCorrelation(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionId),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

/**
 * Bounded metadata-only telemetry buffer.
 *
 * Its record API intentionally has no fields for prompts, narration,
 * transcripts, tool names/arguments/results, credentials, URLs, or images.
 */
export class HostedAgentK3TelemetryBuffer {
  private readonly events: HostedAgentK3TelemetryRecord[] = [];
  private readonly maximumEvents: number;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly sink?: (record: HostedAgentK3TelemetryRecord) => void;

  constructor(options: {
    maximumEvents?: number;
    now?: () => number;
    retentionMs?: number;
    sink?: (record: HostedAgentK3TelemetryRecord) => void;
  } = {}) {
    const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    const maximumEvents = options.maximumEvents ?? DEFAULT_MAX_EVENTS;
    if (
      !Number.isInteger(retentionMs)
      || retentionMs < 1_000
      || retentionMs > MAX_RETENTION_MS
      || !Number.isInteger(maximumEvents)
      || maximumEvents <= 0
      || maximumEvents > MAX_EVENTS
    ) {
      throw new Error('Hosted-agent K3 telemetry retention is invalid.');
    }
    this.maximumEvents = maximumEvents;
    this.now = options.now ?? Date.now;
    this.retentionMs = retentionMs;
    this.sink = options.sink;
  }

  async record(input: {
    byteLength?: number;
    creditsCharged?: number;
    executionRoute: HostedAgentK3ExecutionRoute;
    failureCode?: HostedAgentK3FailureCode;
    kind: HostedAgentK3TelemetryKind;
    latencyMs?: number;
    providerRoute: HostedAgentK3ProviderRoute;
    reconnectCount?: number;
    roundIndex?: number;
    sessionId: string;
    toolCallCount?: number;
  }): Promise<HostedAgentK3TelemetryRecord> {
    if (
      !/^[A-Za-z0-9:_-]{1,240}$/.test(input.sessionId)
      || !validBoundedNumber(input.byteLength, 32 * 1024 * 1024)
      || !validBoundedNumber(input.creditsCharged, 100_000)
      || !validBoundedNumber(input.latencyMs, 24 * 60 * 60_000)
      || !validBoundedNumber(input.reconnectCount, 10_000)
      || !validBoundedNumber(input.roundIndex, 10_000)
      || !validBoundedNumber(input.toolCallCount, 10_000)
    ) {
      throw new Error('Hosted-agent K3 telemetry metadata is invalid or unbounded.');
    }
    this.purge();
    const record: HostedAgentK3TelemetryRecord = {
      at: new Date(this.now()).toISOString(),
      byteLength: input.byteLength,
      creditsCharged: input.creditsCharged,
      executionRoute: input.executionRoute,
      failureCode: input.failureCode ?? 'none',
      kind: input.kind,
      latencyMs: input.latencyMs,
      providerRoute: input.providerRoute,
      reconnectCount: input.reconnectCount,
      roundIndex: input.roundIndex,
      sessionCorrelation: await sessionCorrelation(input.sessionId),
      toolCallCount: input.toolCallCount,
    };
    this.events.push(record);
    if (this.events.length > this.maximumEvents) {
      this.events.splice(0, this.events.length - this.maximumEvents);
    }
    this.sink?.(structuredClone(record));
    return structuredClone(record);
  }

  purge(): number {
    const cutoff = this.now() - this.retentionMs;
    const firstRetained = this.events.findIndex((event) => (
      Date.parse(event.at) >= cutoff
    ));
    if (firstRetained === -1) {
      const removed = this.events.length;
      this.events.length = 0;
      return removed;
    }
    if (firstRetained === 0) {
      return 0;
    }
    this.events.splice(0, firstRetained);
    return firstRetained;
  }

  snapshot(): HostedAgentK3TelemetryRecord[] {
    this.purge();
    return structuredClone(this.events);
  }

  dashboard(): HostedAgentK3TelemetryDashboard {
    const events = this.snapshot();
    const terminal = events.filter((event) => event.kind === 'turn-terminal');
    return {
      completedTurns: terminal.filter((event) => event.failureCode === 'none').length,
      eventCount: events.length,
      failedTurns: terminal.filter((event) => event.failureCode !== 'none').length,
      hostedRouteDecisions: events.filter((event) => (
        event.kind === 'canary-route' && event.executionRoute === 'hosted-agent'
      )).length,
      latencyP50Ms: percentile(
        events.flatMap((event) => event.latencyMs === undefined ? [] : [event.latencyMs]),
        0.5,
      ),
      latencyP95Ms: percentile(
        events.flatMap((event) => event.latencyMs === undefined ? [] : [event.latencyMs]),
        0.95,
      ),
      reconnects: events.reduce(
        (total, event) => total + (event.reconnectCount ?? 0),
        0,
      ),
      totalCreditsCharged: events.reduce(
        (total, event) => total + (event.creditsCharged ?? 0),
        0,
      ),
      toolCalls: events.reduce(
        (total, event) => total + (event.toolCallCount ?? 0),
        0,
      ),
    };
  }
}

export {
  DEFAULT_MAX_EVENTS as HOSTED_AGENT_K3_DEFAULT_MAX_TELEMETRY_EVENTS,
  DEFAULT_RETENTION_MS as HOSTED_AGENT_K3_DEFAULT_TELEMETRY_RETENTION_MS,
  MAX_RETENTION_MS as HOSTED_AGENT_K3_MAX_TELEMETRY_RETENTION_MS,
};
