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
import {
  executeCandidateTwoCompiledPlanV1,
  type CandidateTwoCompiledPlanV1,
} from '../../src/services/kernelClient/wp1Spike/candidateTwoCompiledPlanExecutor';
import {
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';
import { KernelOperationSessionAuthorityV1 } from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';
import { KernelOperationRoundTripV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const CLIENT_ID = 'cancel-client';
const SESSION_ID = 'cancel-session';
const TURN_ID = 'cancel-turn';
const STATE_FINGERPRINT =
  'sha256:2222222222222222222222222222222222222222222222222222222222222222';

function splitPlan(): CandidateTwoCompiledPlanV1 {
  return {
    allowedEffects: ['segmentation'],
    batchId: 'cancel-batch',
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision: 7,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    steps: [{
      arguments: {
        clipId: 'clip-1',
        times: [1.5],
        withLinked: true,
      },
      operationId: 'timeline.segment.split.v1',
      sequence: 1,
      stepId: 'split',
    }],
  };
}

describe('WP1 operation cancellation', () => {
  it('aborts the local transaction and never commits when cancellation wins an async dispatch', async () => {
    const controller = new AbortController();
    let resolveDispatch: ((result: ToolResult) => void) | undefined;
    const dispatch = vi.fn(() => new Promise<ToolResult>((resolve) => {
      resolveDispatch = resolve;
    }));
    const transaction = {
      abort: vi.fn(),
      begin: vi.fn(() => ({ id: 'cancel-transaction' })),
      commit: vi.fn(),
      run: vi.fn((_handle: unknown, action: () => Promise<ToolResult>) => action()),
    };
    const execution = executeCandidateTwoCompiledPlanV1(splitPlan(), {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    }, controller.signal);

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const cancellation = new DOMException('user canceled the hosted turn', 'AbortError');
    controller.abort(cancellation);

    await expect(execution).rejects.toBe(cancellation);
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();

    resolveDispatch?.({
      data: { segments: { videoClipIds: ['clip-1-a', 'clip-1-b'] } },
      success: true,
    });
  });

  it('rejects an already-canceled plan before opening a transaction or dispatching', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('turn already canceled', 'AbortError'));
    const dispatch = vi.fn(async (): Promise<ToolResult> => ({ success: true }));
    const transaction = {
      abort: vi.fn(),
      begin: vi.fn(() => ({ id: 'must-not-open' })),
      commit: vi.fn(),
      run: vi.fn((_handle: unknown, action: () => Promise<ToolResult>) => action()),
    };

    await expect(executeCandidateTwoCompiledPlanV1(splitPlan(), {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('propagates K2 turn cancellation into an in-flight Fast operation before commit or result post', async () => {
    const now = Date.now();
    const compiledPlan = splitPlan();
    const descriptor = {
      allowedEffects: ['segmentation'] as const,
      allowedOperationIds: ['timeline.segment.split.v1'] as const,
      authoritySource: 'same-origin-authenticated-kernel-proxy-v1' as const,
      capabilitySetId: 'cancel-capabilities',
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
      settlement: 'fast-immediate' as const,
      turnId: TURN_ID,
    };
    const events: HostedAgentEvent[] = [{
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
    }];
    const accepted = (sequence: number): HostedAgentK2BatchPostResponse => ({
      accepted: true,
      cursor: String(sequence + 1),
      replayed: false,
      sequence,
      sessionId: SESSION_ID,
      status: 'active',
      turnId: TURN_ID,
    });
    let replayCalls = 0;
    const postOperationResult = vi.fn(async () => accepted(0));
    const cancel = vi.fn(async () => undefined);
    const transport: HostedAgentK2ClientTransport = {
      cancel,
      interrupt: async () => undefined,
      postOperationResult,
      postOperationSettlement: async () => accepted(0),
      postToolResults: async () => accepted(0),
      replayEvents: async () => {
        replayCalls += 1;
        return replayCalls === 1
          ? {
              cursor: '2',
              events,
              leaseExpiresAt: new Date(now + 55_000).toISOString(),
              sessionId: SESSION_ID,
              status: 'active' as const,
              turnId: TURN_ID,
            }
          : {
              cursor: '1',
              events: [],
              leaseExpiresAt: new Date(now + 55_000).toISOString(),
              sessionId: SESSION_ID,
              status: 'active' as const,
              turnId: TURN_ID,
            };
      },
    };
    let resolveDispatch: ((result: ToolResult) => void) | undefined;
    const dispatch = vi.fn(() => new Promise<ToolResult>((resolve) => {
      resolveDispatch = resolve;
    }));
    const transaction = {
      abort: vi.fn(),
      begin: vi.fn(() => ({ id: 'k2-cancel-transaction' })),
      commit: vi.fn(),
      run: vi.fn((_handle: unknown, action: () => Promise<ToolResult>) => action()),
    };
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease: {
        expiresAt: new Date(now + 55_000).toISOString(),
        leaseToken: 'cancel-lease',
        sessionId: SESSION_ID,
      },
      toolSchemaVersion: 'legacy-tools-v1',
      transport,
      turnId: TURN_ID,
    });
    const controller = new AbortController();
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
        dependencies: {
          dispatch,
          getTimelineRevision: () => 7,
          transaction,
        },
        requestConfirmation: async (confirmation) => ({
          decision: 'approved',
          planBinding: confirmation.planBinding,
        }),
      }),
      execute: async () => {
        throw new Error('legacy tool execution must not be used');
      },
      reconnectDelayMs: 0,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const cancellation = new DOMException('user canceled the K2 turn', 'AbortError');
    controller.abort(cancellation);

    await expect(run).rejects.toBe(cancellation);
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(postOperationResult).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);

    resolveDispatch?.({
      data: { segments: { videoClipIds: ['clip-1-a', 'clip-1-b'] } },
      success: true,
    });
  });
});
