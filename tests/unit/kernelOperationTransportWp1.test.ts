import { describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import type {
  HostedAgentEvent,
  HostedAgentK2BatchPostResponse,
} from '../../src/services/kernelClient/hostedAgent/contracts';
import {
  HostedAgentK2ClientSession,
  type HostedAgentK2ClientTransport,
} from '../../src/services/kernelClient/hostedAgent/k2Client';
import { createHostedAgentK2FetchTransport } from '../../src/services/kernelClient/hostedAgent/k2FetchTransport';
import {
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';
import type { CandidateTwoCompiledPlanV1 } from '../../src/services/kernelClient/wp1Spike/candidateTwoCompiledPlanExecutor';
import { KernelOperationSessionAuthorityV1 } from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';
import { KernelOperationRoundTripV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const CLIENT_ID = 'transport-client';
const SESSION_ID = 'transport-session';
const TURN_ID = 'transport-turn';
const STATE_FINGERPRINT =
  'sha256:1111111111111111111111111111111111111111111111111111111111111111';

function plan(): CandidateTwoCompiledPlanV1 {
  return {
    allowedEffects: ['segmentation'],
    batchId: 'transport-batch',
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision: 7,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    steps: [
      {
        arguments: { clipId: 'clip-1', times: [3, 5], withLinked: true },
        operationId: 'timeline.segment.split.v1',
        sequence: 1,
        stepId: 'split',
      },
      {
        arguments: { times: [1.5, 7.5] },
        operationId: 'timeline.visual.capture-grid.v1',
        sequence: 2,
        stepId: 'visual',
      },
    ],
  };
}

function acceptedResponse(sequence: number): HostedAgentK2BatchPostResponse {
  return {
    accepted: true,
    cursor: String(sequence + 1),
    replayed: false,
    sequence,
    sessionId: SESSION_ID,
    status: 'active',
    turnId: TURN_ID,
  };
}

describe('WP1 operation round trip over the K2 client event transport', () => {
  it('reposts one cached prepared result after reconnect, then applies one verdict and receipt', async () => {
    const now = Date.now();
    const compiledPlan = plan();
    const descriptor = {
      allowedEffects: ['segmentation'] as const,
      allowedOperationIds: [
        'timeline.segment.split.v1',
        'timeline.visual.capture-grid.v1',
      ] as const,
      authoritySource: 'same-origin-authenticated-kernel-proxy-v1' as const,
      capabilitySetId: 'transport-capabilities',
      clientInstanceId: CLIENT_ID,
      contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
      contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
      expiresAtEpochMs: now + 60_000,
      initialPlanSequence: 0 as const,
      issuedAtEpochMs: now - 1_000,
      planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
      planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
      schemaVersion: 1 as const,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    };
    const request = {
      capabilitySetId: descriptor.capabilitySetId,
      clientInstanceId: CLIENT_ID,
      expiresAtEpochMs: now + 30_000,
      kind: 'operation-plan-request' as const,
      plan: compiledPlan,
      schemaVersion: 1 as const,
      sequence: 0,
      sessionId: SESSION_ID,
      simulatedStateFingerprint: STATE_FINGERPRINT,
      settlement: 'verified-deferred' as const,
      turnId: TURN_ID,
    };
    const events: HostedAgentEvent[] = [
      {
        descriptor: {
          ...descriptor,
          allowedEffects: [...descriptor.allowedEffects],
          allowedOperationIds: [...descriptor.allowedOperationIds],
        },
        eventId: '1',
        kind: 'operation-session-ready',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      },
      {
        eventId: '2',
        kind: 'operation-plan-request',
        request,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      },
      {
        eventId: '3',
        kind: 'operation-plan-settlement',
        sessionId: SESSION_ID,
        settlement: {
          batchId: compiledPlan.batchId,
          capabilitySetId: descriptor.capabilitySetId,
          clientInstanceId: CLIENT_ID,
          decision: 'commit',
          kind: 'operation-plan-settlement',
          preparedStateFingerprint: STATE_FINGERPRINT,
          reasonCode: 'private-verification-passed',
          schemaVersion: 1,
          sequence: 0,
          sessionId: SESSION_ID,
          simulatedStateFingerprint: STATE_FINGERPRINT,
          turnId: TURN_ID,
        },
        turnId: TURN_ID,
      },
      {
        creditsCharged: 1,
        eventId: '4',
        kind: 'turn-complete',
        message: 'done',
        rounds: 1,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      },
    ];
    const postedResults: unknown[] = [];
    const postedSettlements: unknown[] = [];
    let replayCalls = 0;
    let operationResultPosts = 0;
    const operationHttpTransport = createHostedAgentK2FetchTransport({
      apiBasePath: '/api/kernel',
      fetchImplementation: (async () => {
        operationResultPosts += 1;
        if (operationResultPosts === 1) {
          throw new TypeError('simulated browser network rejection');
        }
        return new Response(JSON.stringify(acceptedResponse(0)), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }) as typeof fetch,
    });
    const transport: HostedAgentK2ClientTransport = {
      cancel: async () => undefined,
      interrupt: async () => undefined,
      postOperationResult: async (input) => {
        postedResults.push(input.result);
        return operationHttpTransport.postOperationResult(input);
      },
      postOperationSettlement: async (input) => {
        postedSettlements.push(input.receipt);
        return acceptedResponse(input.receipt.sequence);
      },
      postToolResults: async () => acceptedResponse(0),
      replayEvents: async ({ afterEventId }) => {
        replayCalls += 1;
        if (replayCalls > 2) throw new Error('unexpected third replay');
        expect(afterEventId).toBe(replayCalls === 1 ? null : '1');
        return {
          cursor: '4',
          events: replayCalls === 1 ? events : events.slice(1),
          leaseExpiresAt: new Date(now + 55_000).toISOString(),
          sessionId: SESSION_ID,
          status: 'completed',
          turnId: TURN_ID,
        };
      },
    };
    const transaction = {
      abort: vi.fn(),
      begin: vi.fn(() => ({ id: 'transport-transaction' })),
      commit: vi.fn(),
      run: (_handle: unknown, action: () => unknown) => action(),
    };
    const dispatch = vi.fn(async (operationId: string): Promise<ToolResult> => (
      operationId === 'timeline.segment.split.v1'
        ? {
            success: true,
            data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
          }
        : {
            success: true,
            data: {
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              frameTimes: [1.5, 7.5],
            },
          }
    ));
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease: {
        expiresAt: new Date(now + 55_000).toISOString(),
        leaseToken: 'transport-lease',
        sessionId: SESSION_ID,
      },
      toolSchemaVersion: 'legacy-tools-v1',
      transport,
      turnId: TURN_ID,
    });

    const outcome = await client.runUntilTerminal({
      createOperationRoundTrip: (receivedDescriptor) => new KernelOperationRoundTripV1({
        authority: new KernelOperationSessionAuthorityV1({
          binding: {
            clientInstanceId: CLIENT_ID,
            sessionId: SESSION_ID,
            turnId: TURN_ID,
          },
          descriptor: receivedDescriptor,
          nowEpochMs: now,
        }),
        requestConfirmation: async (confirmation) => ({
          decision: 'approved',
          planBinding: confirmation.planBinding,
        }),
        dependencies: {
          dispatch,
          getCommittedStateFingerprint: async () => STATE_FINGERPRINT,
          getPreparedStateFingerprint: async () => STATE_FINGERPRINT,
          getTimelineRevision: () => 7,
          transaction,
        },
      }),
      execute: async () => {
        throw new Error('legacy tool execution must not be used');
      },
      reconnectDelayMs: 0,
    });

    expect(outcome).toEqual({ cursor: '4', status: 'completed' });
    expect(postedResults).toHaveLength(2);
    expect(postedResults[1]).toEqual(postedResults[0]);
    expect(postedResults[0]).toMatchObject({
      kind: 'operation-plan-result',
      status: 'prepared',
      result: {
        results: [{ operationId: 'timeline.segment.split.v1' }, {
          operationId: 'timeline.visual.capture-grid.v1',
          result: { data: { imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } },
        }],
      },
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.begin).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(postedSettlements).toEqual([expect.objectContaining({
      kind: 'operation-plan-settlement-receipt',
      outcome: 'committed',
    })]);
  });

  it('rejects an operation plan before local dispatch when no authority event preceded it', async () => {
    const compiledPlan = plan();
    const dispatch = vi.fn();
    const transport: HostedAgentK2ClientTransport = {
      cancel: async () => undefined,
      interrupt: async () => undefined,
      postOperationResult: async () => acceptedResponse(0),
      postOperationSettlement: async () => acceptedResponse(0),
      postToolResults: async () => acceptedResponse(0),
      replayEvents: async () => ({
        cursor: '1',
        events: [{
          eventId: '1',
          kind: 'operation-plan-request',
          request: {
            capabilitySetId: 'missing-authority',
            clientInstanceId: CLIENT_ID,
            expiresAtEpochMs: Date.now() + 30_000,
            kind: 'operation-plan-request',
            plan: compiledPlan,
            schemaVersion: 1,
            sequence: 0,
            sessionId: SESSION_ID,
            settlement: 'fast-immediate',
            turnId: TURN_ID,
          },
          sessionId: SESSION_ID,
          turnId: TURN_ID,
        }],
        leaseExpiresAt: new Date(Date.now() + 55_000).toISOString(),
        sessionId: SESSION_ID,
        status: 'active',
        turnId: TURN_ID,
      }),
    };
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease: {
        expiresAt: new Date(Date.now() + 55_000).toISOString(),
        leaseToken: 'transport-lease',
        sessionId: SESSION_ID,
      },
      toolSchemaVersion: 'legacy-tools-v1',
      transport,
      turnId: TURN_ID,
    });

    await expect(client.runUntilTerminal({
      execute: async () => {
        dispatch();
        throw new Error('unexpected legacy dispatch');
      },
      maximumReconnects: 0,
    })).rejects.toThrow('no authenticated session authority');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fails closed after a hard reload when the persisted cursor skipped operation authority', async () => {
    const now = Date.now();
    const request = {
      capabilitySetId: 'hard-crash-capabilities',
      clientInstanceId: CLIENT_ID,
      expiresAtEpochMs: now + 30_000,
      kind: 'operation-plan-request' as const,
      plan: plan(),
      schemaVersion: 1 as const,
      sequence: 0,
      sessionId: SESSION_ID,
      simulatedStateFingerprint: STATE_FINGERPRINT,
      settlement: 'verified-deferred' as const,
      turnId: TURN_ID,
    };
    const postOperationResult = vi.fn();
    const createOperationRoundTrip = vi.fn();
    const execute = vi.fn();
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      cursor: '1',
      lease: {
        expiresAt: new Date(now + 55_000).toISOString(),
        leaseToken: 'hard-crash-lease',
        sessionId: SESSION_ID,
      },
      toolSchemaVersion: 'legacy-tools-v1',
      transport: {
        cancel: async () => undefined,
        interrupt: async () => undefined,
        postOperationResult,
        postOperationSettlement: async () => acceptedResponse(0),
        postToolResults: async () => acceptedResponse(0),
        replayEvents: async () => ({
          cursor: '2',
          events: [{
            eventId: '2',
            kind: 'operation-plan-request',
            request,
            sessionId: SESSION_ID,
            turnId: TURN_ID,
          }],
          leaseExpiresAt: new Date(now + 55_000).toISOString(),
          sessionId: SESSION_ID,
          status: 'active',
          turnId: TURN_ID,
        }),
      },
      turnId: TURN_ID,
    });

    await expect(client.runUntilTerminal({
      createOperationRoundTrip,
      execute,
      reconnectDelayMs: 0,
    })).rejects.toThrow('no authenticated session authority');
    expect(createOperationRoundTrip).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(postOperationResult).not.toHaveBeenCalled();
  });

  it('aborts a prepared verified edit and persists an interrupted state on page detach', async () => {
    const now = Date.now();
    const compiledPlan = plan();
    const descriptor = {
      allowedEffects: ['segmentation'] as const,
      allowedOperationIds: [
        'timeline.segment.split.v1',
        'timeline.visual.capture-grid.v1',
      ] as const,
      authoritySource: 'same-origin-authenticated-kernel-proxy-v1' as const,
      capabilitySetId: 'detach-capabilities',
      clientInstanceId: CLIENT_ID,
      contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
      contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
      expiresAtEpochMs: now + 60_000,
      initialPlanSequence: 0 as const,
      issuedAtEpochMs: now - 1_000,
      planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
      planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
      schemaVersion: 1 as const,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    };
    const request = {
      capabilitySetId: descriptor.capabilitySetId,
      clientInstanceId: CLIENT_ID,
      expiresAtEpochMs: now + 30_000,
      kind: 'operation-plan-request' as const,
      plan: compiledPlan,
      schemaVersion: 1 as const,
      sequence: 0,
      sessionId: SESSION_ID,
      simulatedStateFingerprint: STATE_FINGERPRINT,
      settlement: 'verified-deferred' as const,
      turnId: TURN_ID,
    };
    let replayCalls = 0;
    let releaseSecondReplay: ((value: {
      cursor: string;
      events: HostedAgentEvent[];
      leaseExpiresAt: string;
      sessionId: string;
      status: 'active';
      turnId: string;
    }) => void) | undefined;
    let markResultPosted: (() => void) | undefined;
    const resultPosted = new Promise<void>((resolve) => {
      markResultPosted = resolve;
    });
    const postOperationSettlement = vi.fn(async () => acceptedResponse(0));
    const interrupt = vi.fn(async () => undefined);
    const transport: HostedAgentK2ClientTransport = {
      cancel: async () => undefined,
      interrupt,
      postOperationResult: async () => {
        markResultPosted?.();
        return acceptedResponse(0);
      },
      postOperationSettlement,
      postToolResults: async () => acceptedResponse(0),
      replayEvents: async () => {
        replayCalls += 1;
        if (replayCalls === 1) {
          return {
            cursor: '2',
            events: [{
              descriptor: {
                ...descriptor,
                allowedEffects: [...descriptor.allowedEffects],
                allowedOperationIds: [...descriptor.allowedOperationIds],
              },
              eventId: '1',
              kind: 'operation-session-ready',
              sessionId: SESSION_ID,
              turnId: TURN_ID,
            }, {
              eventId: '2',
              kind: 'operation-plan-request',
              request,
              sessionId: SESSION_ID,
              turnId: TURN_ID,
            }],
            leaseExpiresAt: new Date(now + 55_000).toISOString(),
            sessionId: SESSION_ID,
            status: 'active' as const,
            turnId: TURN_ID,
          };
        }
        return await new Promise((resolve) => {
          releaseSecondReplay = resolve;
        });
      },
    };
    const transaction = {
      abort: vi.fn(),
      begin: vi.fn(() => ({ id: 'detach-transaction' })),
      commit: vi.fn(),
      run: (_handle: unknown, action: () => unknown) => action(),
    };
    const persistedStates: Array<{ status: string }> = [];
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease: {
        expiresAt: new Date(now + 55_000).toISOString(),
        leaseToken: 'transport-lease',
        sessionId: SESSION_ID,
      },
      onStateChange: (state) => persistedStates.push(state),
      toolSchemaVersion: 'legacy-tools-v1',
      transport,
      turnId: TURN_ID,
    });
    const run = client.runUntilTerminal({
      createOperationRoundTrip: (receivedDescriptor) => new KernelOperationRoundTripV1({
        authority: new KernelOperationSessionAuthorityV1({
          binding: {
            clientInstanceId: CLIENT_ID,
            sessionId: SESSION_ID,
            turnId: TURN_ID,
          },
          descriptor: receivedDescriptor,
          nowEpochMs: now,
        }),
        requestConfirmation: async (confirmation) => ({
          decision: 'approved',
          planBinding: confirmation.planBinding,
        }),
        dependencies: {
          dispatch: async (operationId): Promise<ToolResult> => (
            operationId === 'timeline.segment.split.v1'
              ? {
                  data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
                  success: true,
                }
              : {
                  data: {
                    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                    frameTimes: [1.5, 7.5],
                  },
                  success: true,
                }
          ),
          getCommittedStateFingerprint: async () => STATE_FINGERPRINT,
          getPreparedStateFingerprint: async () => STATE_FINGERPRINT,
          getTimelineRevision: () => 7,
          transaction,
        },
      }),
      execute: async () => {
        throw new Error('legacy tool execution must not be used');
      },
      reconnectDelayMs: 0,
    });

    await resultPosted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(releaseSecondReplay).toBeTypeOf('function');
    client.detachForReload();
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(persistedStates.at(-1)?.status).toBe('interrupted');
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(postOperationSettlement).not.toHaveBeenCalled();
    releaseSecondReplay?.({
      cursor: '2',
      events: [],
      leaseExpiresAt: new Date(now + 55_000).toISOString(),
      sessionId: SESSION_ID,
      status: 'active',
      turnId: TURN_ID,
    });
    await expect(run).resolves.toEqual({ cursor: '2', status: 'interrupted' });
  });

  it('uses dedicated bound HTTP endpoints for operation results and settlement receipts', async () => {
    const requests: Array<{ body: unknown; headers: Headers; method: string; url: string }> = [];
    const fetchImplementation = (async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body ?? '{}')) as unknown,
        headers: new Headers(init?.headers),
        method: init?.method ?? 'GET',
        url: String(requestInfo),
      });
      return new Response(JSON.stringify(acceptedResponse(0)), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }) as typeof fetch;
    const transport = createHostedAgentK2FetchTransport({
      apiBasePath: '/api/kernel',
      fetchImplementation,
    });
    const binding = {
      clientInstanceId: CLIENT_ID,
      leaseToken: 'transport-lease',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    };
    const result = {
      batchId: 'transport-batch',
      capabilitySetId: 'transport-capabilities',
      clientInstanceId: CLIENT_ID,
      errorCode: 'execution-rejected' as const,
      kind: 'operation-plan-result' as const,
      result: { batchId: 'transport-batch', results: [], success: false },
      schemaVersion: 1 as const,
      sequence: 0,
      sessionId: SESSION_ID,
      stateRevisionAfter: 7,
      stateRevisionBefore: 7,
      status: 'failed' as const,
      turnId: TURN_ID,
    };
    const receipt = {
      batchId: 'transport-batch',
      capabilitySetId: 'transport-capabilities',
      clientInstanceId: CLIENT_ID,
      committedStateFingerprint: STATE_FINGERPRINT,
      kind: 'operation-plan-settlement-receipt' as const,
      outcome: 'committed' as const,
      preparedStateFingerprint: STATE_FINGERPRINT,
      schemaVersion: 1 as const,
      sequence: 0,
      sessionId: SESSION_ID,
      simulatedStateFingerprint: STATE_FINGERPRINT,
      stateRevisionAfterSettlement: 8,
      turnId: TURN_ID,
    };

    await transport.postOperationResult({ ...binding, result });
    await transport.postOperationSettlement({ ...binding, receipt });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.url)).toEqual([
      `/api/kernel/hosted-agent/turns/${TURN_ID}/operation-results`,
      `/api/kernel/hosted-agent/turns/${TURN_ID}/operation-settlements`,
    ]);
    expect(requests.map((request) => request.body)).toEqual([{ result }, { receipt }]);
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-masterselects-client-instance-id')).toBe(CLIENT_ID);
      expect(request.headers.get('x-masterselects-page-lease')).toBe('transport-lease');
      expect(request.headers.get('x-masterselects-session-id')).toBe(SESSION_ID);
    }
  });
});
