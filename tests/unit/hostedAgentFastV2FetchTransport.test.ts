import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  HOSTED_AGENT_HEADERS,
  createHostedAgentFastV2FetchTransport,
  parseHostedAgentFastV2Sse,
  type HostedAgentFastV2Binding,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent';
import type {
  KernelOperationPlanResultV1,
  KernelOperationSettlementReceiptV1,
} from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const TURN_ID = 'turn-fast-v2-transport';
const SESSION_ID = 'session-fast-v2-transport';
const CLIENT_ID = 'client-fast-v2-transport';
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
    editorBuildId: 'editor-build-2026-08-01',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    request: 'Remove the silent section.',
    runSource: 'ui',
    turnId: TURN_ID,
    visualReferences: [],
  };
}

function binding(): HostedAgentFastV2Binding {
  return {
    clientInstanceId: CLIENT_ID,
    leaseToken: 'opaque-fast-v2-page-lease',
    sessionId: SESSION_ID,
    turnId: TURN_ID,
  };
}

function accepted() {
  return {
    acceptedExecutionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    acceptedExecutionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    eventsPath: `/api/kernel/hosted-agent/v2/turns/${TURN_ID}/events`,
    maximumIterations: 4,
    maximumSpendCredits: 2_000,
    pageLease: {
      expiresAt: '2026-08-01T18:00:00.000Z',
      leaseToken: 'opaque-fast-v2-page-lease',
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
    batchId: 'batch-fast-v2-transport',
    capabilitySetId: 'capability-fast-v2-transport',
    clientInstanceId: CLIENT_ID,
    errorCode: 'execution-rejected',
    kind: 'operation-plan-result',
    result: {
      batchId: 'batch-fast-v2-transport',
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

describe('Fast V2 browser fetch transport', () => {
  it('starts only at the V2 route and accepts an exactly bound response', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    const fetchImplementation = vi.fn(async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(accepted(), { status: 201 });
    });
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.start({ request: startRequest() })).resolves.toEqual(accepted());
    expect(url).toBe('/api/kernel/hosted-agent/v2/turns');
    expect(body).toEqual(startRequest());
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('providerInput');
    expect(body).not.toHaveProperty('systemPrompt');
    expect(body).not.toHaveProperty('tools');
  });

  it('fetches a strictly bound protocol selection and rejects contradictory fallbacks', async () => {
    const responses = [
      {
        availableExecutionProfiles: ['fast', 'verified'],
        protocolVersion: 'fast-agent-v2',
        reason: 'canary_selected',
      },
      {
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'hosted-agent-k2-v1',
        reason: 'outside_canary',
      },
      {
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'fast-agent-v2',
        reason: 'outside_canary',
      },
      {
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'hosted-agent-k2-v1',
        reason: 'canary_selected',
      },
      {
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'fast-agent-v2',
        reason: 'canary_selected',
        route: 'injected',
      },
    ];
    const fetchImplementation = vi.fn(async () => jsonResponse(responses.shift()));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.getProtocol()).resolves.toEqual({
      availableExecutionProfiles: ['fast', 'verified'],
      protocolVersion: 'fast-agent-v2',
      reason: 'canary_selected',
    });
    await expect(transport.getProtocol()).resolves.toEqual({
      availableExecutionProfiles: ['fast'],
      protocolVersion: 'hosted-agent-k2-v1',
      reason: 'outside_canary',
    });
    await expect(transport.getProtocol()).rejects.toThrow(/contradictory/i);
    await expect(transport.getProtocol()).rejects.toThrow(/contradictory/i);
    await expect(transport.getProtocol()).rejects.toThrow(/unexpected shape/i);
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual(
      Array.from({ length: 5 }, () => '/api/kernel/hosted-agent/protocol'),
    );
  });

  it('rejects malformed, unordered, duplicate, unknown, and K2 Verified availability', async () => {
    const responses = [
      { availableExecutionProfiles: [], protocolVersion: 'fast-agent-v2', reason: 'canary_selected' },
      { availableExecutionProfiles: ['verified', 'fast'], protocolVersion: 'fast-agent-v2', reason: 'canary_selected' },
      { availableExecutionProfiles: ['fast', 'fast'], protocolVersion: 'fast-agent-v2', reason: 'canary_selected' },
      { availableExecutionProfiles: ['fast', 'quality'], protocolVersion: 'fast-agent-v2', reason: 'canary_selected' },
      { availableExecutionProfiles: ['fast', 'verified'], protocolVersion: 'hosted-agent-k2-v1', reason: 'outside_canary' },
      { availableExecutionProfiles: ['fast'], protocolVersion: 'fast-agent-v2', reason: 'canary_selected', verifiedEnabled: false },
    ];
    const transport = createHostedAgentFastV2FetchTransport({
      fetchImplementation: vi.fn(async () => jsonResponse(responses.shift())),
    });

    for (const _response of responses.slice()) {
      await expect(transport.getProtocol()).rejects.toThrow(/invalid|contradictory|unexpected shape/i);
    }
  });

  it('maps only the exact Verified-disabled start error to a safe actionable message', async () => {
    const responses = [
      jsonResponse({
        error: 'verified_profile_not_enabled',
        message: 'internal environment detail',
      }, { status: 409 }),
      jsonResponse({
        error: 'another_conflict',
        message: 'internal environment detail',
      }, { status: 409 }),
    ];
    const transport = createHostedAgentFastV2FetchTransport({
      fetchImplementation: vi.fn(async () => responses.shift() as Response),
    });
    const verifiedRequest = { ...startRequest(), executionProfile: 'verified' as const };

    await expect(transport.start({ request: verifiedRequest }))
      .rejects.toThrow('The Verified profile is not available for this account. Choose Fast and try again.');
    await expect(transport.start({ request: verifiedRequest }))
      .rejects.toThrow('The Fast V2 hosted-agent request failed safely (409: another_conflict).');
  });

  it('reconnects with the event cursor and strictly parses narration, billing, and completion', async () => {
    const events = [
      {
        eventId: '2',
        kind: 'narration-complete',
        phase: 'acting',
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        sessionId: SESSION_ID,
        text: 'Applying the private plan.',
        turnId: TURN_ID,
      },
      {
        creditBalance: 976,
        creditsCharged: 24,
        eventId: '3',
        kind: 'billing-settled',
        ledgerEntryId: 'ledger-fast-v2-round-0',
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        sessionId: SESSION_ID,
        totalCreditsCharged: 24,
        turnId: TURN_ID,
      },
      {
        creditsCharged: 24,
        eventId: '4',
        kind: 'turn-complete',
        message: 'Done.',
        protocolVersion: 'fast-agent-v2',
        rounds: 1,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      },
    ];
    const sse = events.map((event) => (
      `id: ${event.eventId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
    )).join('');
    let headers = new Headers();
    const transport = createHostedAgentFastV2FetchTransport({
      fetchImplementation: vi.fn(async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response(sse, {
          headers: {
            'Content-Type': 'text/event-stream',
            [HOSTED_AGENT_HEADERS.eventCursor]: '4',
            [HOSTED_AGENT_HEADERS.streamLeaseMs]: '50000',
          },
        });
      }),
    });

    const replay = await transport.replayEvents({ ...binding(), afterEventId: '1' });
    expect(replay.events.map((event) => event.kind)).toEqual([
      'narration-complete',
      'billing-settled',
      'turn-complete',
    ]);
    expect(replay.status).toBe('completed');
    expect(replay.cursor).toBe('4');
    expect(headers.get(HOSTED_AGENT_HEADERS.lastEventId)).toBe('1');
    expect(headers.get(HOSTED_AGENT_HEADERS.pageLease)).toBe(binding().leaseToken);
    expect(headers.get(HOSTED_AGENT_HEADERS.protocolVersion)).toBe('fast-agent-v2');
  });

  it('posts bound operation results and Verified settlement receipts', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    const fetchImplementation = vi.fn(async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as unknown;
      return jsonResponse({
        accepted: true,
        cursor: '7',
        replayed: false,
        sequence: 0,
        sessionId: SESSION_ID,
        status: 'active',
        turnId: TURN_ID,
      });
    });
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });
    const result = failedOperationResult();

    await expect(transport.postOperationResult({ ...binding(), result })).resolves.toMatchObject({
      accepted: true,
      sequence: 0,
    });
    expect(requestUrl).toBe(
      `/api/kernel/hosted-agent/v2/turns/${TURN_ID}/operation-results`,
    );
    expect(requestBody).toEqual({ result });

    const receipt: KernelOperationSettlementReceiptV1 = {
      batchId: result.batchId,
      capabilitySetId: result.capabilitySetId,
      clientInstanceId: CLIENT_ID,
      committedStateFingerprint: FINGERPRINT,
      kind: 'operation-plan-settlement-receipt',
      outcome: 'committed',
      preparedStateFingerprint: FINGERPRINT,
      schemaVersion: 1,
      sequence: 0,
      sessionId: SESSION_ID,
      simulatedStateFingerprint: FINGERPRINT,
      stateRevisionAfterSettlement: 18,
      turnId: TURN_ID,
    };
    await expect(transport.postOperationSettlement({ ...binding(), receipt }))
      .resolves.toMatchObject({ accepted: true, sequence: 0 });
    expect(requestUrl).toBe(
      `/api/kernel/hosted-agent/v2/turns/${TURN_ID}/operation-settlements`,
    );
    expect(requestBody).toEqual({ receipt });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('surfaces a bounded kernel error code without exposing its internal message', async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({
      error: 'state_revision_drift',
      message: 'internal timeline details must remain private',
    }, { status: 409 }));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.postOperationResult({
      ...binding(),
      result: failedOperationResult(),
    })).rejects.toThrow(
      'The Fast V2 hosted-agent request failed safely (409: state_revision_drift).',
    );
  });

  it('accepts the stable-revision result used to load a private editor category', async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({
      accepted: true,
      cursor: '2',
      replayed: false,
      sequence: 0,
      sessionId: SESSION_ID,
      status: 'active',
      turnId: TURN_ID,
    }));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });
    const result: KernelOperationPlanResultV1 = {
      batchId: 'category-browse-batch',
      capabilitySetId: 'progressive-editor-tools',
      clientInstanceId: CLIENT_ID,
      kind: 'operation-plan-result',
      result: {
        batchId: 'category-browse-batch',
        results: [{
          operationId: 'timeline.editor.catalog.v1',
          result: { success: true },
          sequence: 1,
        }],
        success: true,
      },
      schemaVersion: 1,
      sequence: 0,
      sessionId: SESSION_ID,
      stateRevisionAfter: 17,
      stateRevisionBefore: 17,
      status: 'committed',
      turnId: TURN_ID,
    };

    await expect(transport.postOperationResult({ ...binding(), result }))
      .resolves.toMatchObject({ accepted: true, sequence: 0 });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('cancels with the page binding and requires the exact terminal response', async () => {
    let headers = new Headers();
    const fetchImplementation = vi.fn(async (_input, init) => {
      headers = new Headers(init?.headers);
      return jsonResponse({
        terminalReason: 'explicit_cancel',
        turnId: TURN_ID,
        turnStatus: 'cancelled',
      });
    });
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });

    await expect(transport.cancel(binding())).resolves.toEqual({
      terminalReason: 'explicit_cancel',
      turnId: TURN_ID,
      turnStatus: 'cancelled',
    });
    expect(headers.get(HOSTED_AGENT_HEADERS.clientInstanceId)).toBe(CLIENT_ID);
    expect(headers.get(HOSTED_AGENT_HEADERS.pageLease)).toBe(binding().leaseToken);
    expect(headers.get(HOSTED_AGENT_HEADERS.sessionId)).toBe(SESSION_ID);
  });

  it('rejects unknown start fields, malformed responses, and unbound SSE before use', async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ ...accepted(), model: 'unsafe' }));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });
    const unsafeRequest = { ...startRequest(), systemPrompt: 'unsafe browser authority' };

    await expect(transport.start({ request: unsafeRequest as HostedAgentFastV2StartRequest }))
      .rejects.toThrow(/unknown|forbidden/i);
    expect(fetchImplementation).not.toHaveBeenCalled();

    await expect(transport.start({ request: startRequest() })).rejects.toThrow(/unexpected shape/i);
    expect(() => parseHostedAgentFastV2Sse(
      `id: 1\nevent: turn-complete\ndata: ${JSON.stringify({
        creditsCharged: 0,
        eventId: '1',
        kind: 'turn-complete',
        message: 'Injected.',
        protocolVersion: 'fast-agent-v2',
        rounds: 0,
        sessionId: 'different-session',
        turnId: TURN_ID,
      })}\n\n`,
      binding(),
    )).toThrow(/not bound/i);
    expect(() => parseHostedAgentFastV2Sse(
      `id: 1\nevent: turn-complete\ndata: ${JSON.stringify({
        creditsCharged: 0,
        eventId: '1',
        kind: 'turn-complete',
        message: 'Injected.',
        protocolVersion: 'fast-agent-v2',
        providerResult: {},
        rounds: 0,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      })}\n\n`,
      binding(),
    )).toThrow(/unexpected payload/i);
    expect(() => parseHostedAgentFastV2Sse(
      `id: 1\nevent: operation-plan-settlement\ndata: ${JSON.stringify({
        eventId: '1',
        kind: 'operation-plan-settlement',
        protocolVersion: 'fast-agent-v2',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      })}\n\n`,
      binding(),
    )).toThrow(/unexpected payload/i);
  });

  it('rejects an unbound operation payload and malformed operation acknowledgement', async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({
      accepted: true,
      cursor: '7',
      replayed: false,
      sequence: 1,
      sessionId: SESSION_ID,
      status: 'active',
      turnId: TURN_ID,
    }));
    const transport = createHostedAgentFastV2FetchTransport({ fetchImplementation });
    const unbound = { ...failedOperationResult(), sessionId: 'other-session' };

    await expect(transport.postOperationResult({
      ...binding(),
      result: unbound as KernelOperationPlanResultV1,
    })).rejects.toThrow(/unbound/i);
    expect(fetchImplementation).not.toHaveBeenCalled();

    await expect(transport.postOperationResult({
      ...binding(),
      result: failedOperationResult(),
    })).rejects.toThrow(/malformed or unbound/i);
  });
});
