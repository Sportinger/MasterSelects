import { describe, expect, it } from 'vitest';

import {
  HostedAgentK3TelemetryBuffer,
} from '../../functions/lib/hostedAgent/k3Telemetry';

describe('hosted-agent K3 bounded redacted telemetry', () => {
  it('stores only bounded metadata and hashes the session correlation', async () => {
    const persisted: unknown[] = [];
    const marker = 'RAW_PROMPT_TRANSCRIPT_TOOL_RESULT_SECRET_DATA_URL';
    const telemetry = new HostedAgentK3TelemetryBuffer({
      maximumEvents: 4,
      sink: (record) => persisted.push(record),
    });
    await telemetry.record({
      creditsCharged: 6,
      executionRoute: 'hosted-agent',
      kind: 'provider-round',
      latencyMs: 123,
      providerRoute: 'kie-managed-hosted',
      roundIndex: 0,
      sessionId: 'session-k3-sensitive',
      toolCallCount: 2,
      ...({ rawPrompt: marker } as object),
    });

    const serialized = JSON.stringify({
      persisted,
      snapshot: telemetry.snapshot(),
    });
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('session-k3-sensitive');
    expect(telemetry.snapshot()[0].sessionCorrelation).toMatch(/^[a-f0-9]{24}$/);
  });

  it('caps event count, expires retention, and produces an aggregate-only dashboard', async () => {
    let now = Date.parse('2026-07-30T12:00:00.000Z');
    const telemetry = new HostedAgentK3TelemetryBuffer({
      maximumEvents: 3,
      now: () => now,
      retentionMs: 1_000,
    });
    await telemetry.record({
      executionRoute: 'hosted-agent',
      kind: 'canary-route',
      providerRoute: 'kie-managed-hosted',
      sessionId: 'session-1',
    });
    await telemetry.record({
      executionRoute: 'hosted-agent',
      kind: 'reconnect',
      latencyMs: 20,
      providerRoute: 'kie-managed-hosted',
      reconnectCount: 2,
      sessionId: 'session-1',
    });
    await telemetry.record({
      creditsCharged: 12,
      executionRoute: 'hosted-agent',
      kind: 'batch-result',
      latencyMs: 40,
      providerRoute: 'kie-managed-hosted',
      sessionId: 'session-1',
      toolCallCount: 3,
    });
    await telemetry.record({
      executionRoute: 'hosted-agent',
      kind: 'turn-terminal',
      latencyMs: 100,
      providerRoute: 'kie-managed-hosted',
      sessionId: 'session-1',
    });

    expect(telemetry.snapshot()).toHaveLength(3);
    expect(telemetry.dashboard()).toEqual({
      completedTurns: 1,
      eventCount: 3,
      failedTurns: 0,
      hostedRouteDecisions: 0,
      latencyP50Ms: 40,
      latencyP95Ms: 100,
      reconnects: 2,
      totalCreditsCharged: 12,
      toolCalls: 3,
    });
    now += 1_001;
    expect(telemetry.purge()).toBe(3);
    expect(telemetry.snapshot()).toEqual([]);
  });

  it('rejects unbounded fields and unsafe retention settings', async () => {
    expect(() => new HostedAgentK3TelemetryBuffer({
      retentionMs: 24 * 60 * 60_000 + 1,
    })).toThrow(/retention/i);
    const telemetry = new HostedAgentK3TelemetryBuffer();
    await expect(telemetry.record({
      byteLength: 32 * 1024 * 1024 + 1,
      executionRoute: 'hosted-agent',
      kind: 'batch-result',
      providerRoute: 'kie-managed-hosted',
      sessionId: 'session-invalid',
    })).rejects.toThrow(/unbounded/i);
  });
});
