import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  HOSTED_AGENT_HEADERS,
  createHostedAgentFastV2FetchTransport,
  type HostedAgentFastV2Binding,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent';
import type { KernelOperationPlanResultV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const TURN_ID = 'turn-normal-path-transport';
const SESSION_ID = 'session-normal-path-transport';
const CLIENT_ID = 'client-normal-path-transport';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(value), { ...init, headers });
}

function startRequest(): HostedAgentFastV2StartRequest {
  return {
    clientInstanceId: CLIENT_ID,
    compactSnapshot: {
      payload: { timeline: { clips: [] } },
      schemaVersion: 1,
      stateFingerprint: FINGERPRINT,
      timelineRevision: 17,
    },
    editorBuildId: 'editor-build-normal-path',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    executionProfile: 'fast',
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    request: 'Inspect the current timeline.',
    requestedExecutionMode: 'normal',
    runSource: 'ui',
    turnId: TURN_ID,
    visualReferences: [],
  };
}

function binding(): HostedAgentFastV2Binding {
  return {
    clientInstanceId: CLIENT_ID,
    leaseToken: 'opaque-normal-path-page-lease',
    sessionId: SESSION_ID,
    turnId: TURN_ID,
  };
}

function accepted() {
  return {
    acceptedExecutionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    acceptedExecutionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    eventsPath: `/api/kernel/normal/turns/${TURN_ID}/events`,
    maximumIterations: 4,
    maximumSpendCredits: 2_000,
    pageLease: {
      expiresAt: '2026-08-06T18:00:00.000Z',
      leaseToken: 'opaque-normal-path-page-lease',
      sessionId: SESSION_ID,
    },
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    replayed: false,
    route: 'fast-agent-v2',
    sessionId: SESSION_ID,
    turnId: TURN_ID,
  };
}

function failedOperationResult(): KernelOperationPlanResultV1 {
  return {
    batchId: 'batch-normal-path-transport',
    capabilitySetId: 'capability-normal-path-transport',
    clientInstanceId: CLIENT_ID,
    errorCode: 'execution-rejected',
    kind: 'operation-plan-result',
    result: {
      batchId: 'batch-normal-path-transport',
      results: [],
      success: false,
    },
    schemaVersion: 1,
    sequence: 0,
    sessionId: SESSION_ID,
    stateRevisionAfter: 17,
    stateRevisionBefore: 17,
    status: 'failed',
    turnId: TURN_ID,
  };
}

describe('Normal Path browser fetch transport', () => {
  it('accepts only the single server-owned capability shape', async () => {
    const normalCapabilities = {
      availableAgentModes: ['standard', 'logic'],
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'fast-agent-v2',
      reason: 'normal_path',
    };
    const responses = [
      normalCapabilities,
      {
        availableAgentModes: ['standard'],
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'legacy-agent-v1',
        reason: 'legacy_route',
      },
    ];
    const fetchImplementation = vi.fn(async () => jsonResponse(responses.shift()));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.getProtocol()).resolves.toEqual(normalCapabilities);
    await expect(transport.getProtocol()).rejects.toThrow(/invalid or contradictory/i);
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/kernel/normal/capabilities',
      '/api/kernel/normal/capabilities',
    ]);
  });

  it('starts a turn without exposing provider prompts, models, or tools', async () => {
    let body: Record<string, unknown> = {};
    const fetchImplementation = vi.fn(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(accepted(), { status: 202 });
    });
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.start({ request: startRequest() })).resolves.toEqual(accepted());
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe('/api/kernel/normal/turns');
    expect(body).toEqual(startRequest());
    expect(body).not.toHaveProperty('providerInput');
    expect(body).not.toHaveProperty('systemPrompt');
    expect(body).not.toHaveProperty('tools');
  });

  it('replays events, posts operation results, and cancels on the bound turn routes', async () => {
    const urls: string[] = [];
    const fetchImplementation = vi.fn(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/events')) {
        const event = {
          creditsCharged: 2,
          eventId: '1',
          kind: 'turn-complete',
          inputRequest: {
            allowFreeform: false,
            allowMultiple: false,
            id: 'input-pacing',
            options: [
              { description: 'Tighter cuts.', id: 'fast', title: 'Fast' },
              { description: 'Longer breaths.', id: 'calm', title: 'Calm' },
            ],
            question: 'Which pacing should I use?',
          },
          message: 'Done.',
          protocolVersion: 'fast-agent-v2',
          rounds: 1,
          sessionId: SESSION_ID,
          turnId: TURN_ID,
        };
        return new Response(`id: 1\nevent: turn-complete\ndata: ${JSON.stringify(event)}\n\n`, {
          headers: {
            'Content-Type': 'text/event-stream',
            [HOSTED_AGENT_HEADERS.eventCursor]: '1',
          },
        });
      }
      if (url.endsWith('/operation-results')) {
        const posted = JSON.parse(String(init?.body)) as { result: KernelOperationPlanResultV1 };
        expect(posted.result).toEqual(failedOperationResult());
        return jsonResponse({
          accepted: true,
          cursor: '2',
          replayed: false,
          sequence: 0,
          sessionId: SESSION_ID,
          status: 'active',
          turnId: TURN_ID,
        });
      }
      return jsonResponse({
        terminalReason: 'explicit_cancel',
        turnId: TURN_ID,
        turnStatus: 'cancelled',
      });
    });
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.replayEvents({ ...binding(), afterEventId: null }))
      .resolves.toMatchObject({
        cursor: '1',
        events: [expect.objectContaining({
          inputRequest: expect.objectContaining({ id: 'input-pacing' }),
        })],
        status: 'completed',
      });
    await expect(transport.postOperationResult({
      ...binding(),
      result: failedOperationResult(),
    })).resolves.toMatchObject({ accepted: true, sequence: 0 });
    await expect(transport.cancel(binding())).resolves.toMatchObject({
      terminalReason: 'explicit_cancel',
    });
    expect(urls).toEqual([
      `/api/kernel/normal/turns/${TURN_ID}/events`,
      `/api/kernel/normal/turns/${TURN_ID}/operation-results`,
      `/api/kernel/normal/turns/${TURN_ID}/cancel`,
    ]);
  });
});
