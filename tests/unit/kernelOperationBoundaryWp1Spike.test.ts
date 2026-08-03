import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { checkToolAccess } from '../../src/services/aiTools/policy';
import {
  executeCandidateOneEnvelopeV1,
  PublicOperationBoundaryError,
  PublicOperationTransactionOwnershipLostError,
  type BoundaryTransactionV1,
  type CandidateOneEnvelopeV1,
  type PublicOperationExecutionDependenciesV1,
} from '../../src/services/kernelClient/wp1Spike/candidateOneOperationExecutor';
import {
  executeCandidateTwoCompiledPlanV1,
  type CandidateTwoCompiledPlanV1,
} from '../../src/services/kernelClient/wp1Spike/candidateTwoCompiledPlanExecutor';
import {
  createWp1EditorOperationAuthorization,
  createWp1EditorOperationDispatcher,
} from '../../src/services/kernelClient/wp1Spike/editorOperationDispatcher';
import {
  KernelOperationSessionAuthorityV1,
  type KernelOperationPlanSettlementV1,
  type KernelOperationPlanRequestV1,
  type KernelOperationSessionDescriptorV1,
} from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';
import { KernelOperationRoundTripV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';
import type { KernelOperationConfirmationHandlerV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';
import {
  canonicalPublicCompiledPlanExtensionV1,
  canonicalPublicOperationContractV1,
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const MATCHING_STATE_FINGERPRINT = sha256('wp1-matching-state');
const DIFFERENT_STATE_FINGERPRINT = sha256('wp1-different-state');

function transactionSpies(): BoundaryTransactionV1 & {
  abort: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
} {
  return {
    abort: vi.fn(),
    begin: vi.fn(() => ({ id: 'transaction-1' })),
    commit: vi.fn(),
    run: (_handle, action) => action(),
  };
}

const approveConfirmation: KernelOperationConfirmationHandlerV1 = async (request) => ({
  decision: 'approved',
  planBinding: request.planBinding,
});

const matchingFingerprintCallbacks = {
  getCommittedStateFingerprint: async () => MATCHING_STATE_FINGERPRINT,
  getPreparedStateFingerprint: async () => MATCHING_STATE_FINGERPRINT,
};

function candidateOneEnvelope(): CandidateOneEnvelopeV1 {
  return {
    allowedEffects: ['segmentation'],
    batchId: 'batch-direct-1',
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision: 7,
    operation: {
      arguments: { clipId: 'clip-1', times: [3, 5], withLinked: true },
      operationId: 'timeline.segment.split.v1',
      sequence: 1,
    },
    schemaVersion: 1,
  };
}

function candidateOneVisualEnvelope(): CandidateOneEnvelopeV1 {
  return {
    allowedEffects: [],
    batchId: 'batch-visual-1',
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision: 7,
    operation: {
      arguments: { times: [1.5, 7.5, 13.5] },
      operationId: 'timeline.visual.capture-grid.v1',
      sequence: 1,
    },
    schemaVersion: 1,
  };
}

function candidateTwoPlan(): CandidateTwoCompiledPlanV1 {
  return {
    allowedEffects: ['segmentation', 'sourceCoverage', 'mediaDuration'],
    batchId: 'batch-plan-1',
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
        arguments: {
          clipIds: [{
            $result: {
              path: ['data', 'segments', 'videoClipIds', 1],
              stepId: 'split',
            },
          }],
          withLinked: true,
        },
        operationId: 'timeline.segment.delete-many.v1',
        sequence: 2,
        stepId: 'delete',
      },
    ],
  };
}

const SESSION_NOW = 1_785_588_000_000;

function operationSessionDescriptor(
  plan: CandidateTwoCompiledPlanV1,
  operationIds = [...new Set(plan.steps.map((step) => step.operationId))],
): KernelOperationSessionDescriptorV1 {
  return {
    allowedEffects: [...plan.allowedEffects],
    allowedOperationIds: operationIds,
    authoritySource: 'same-origin-authenticated-kernel-proxy-v1',
    capabilitySetId: 'capability-set-1',
    clientInstanceId: 'client-1',
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expiresAtEpochMs: SESSION_NOW + 60_000,
    initialPlanSequence: 0,
    issuedAtEpochMs: SESSION_NOW - 1_000,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
  };
}

function operationPlanRequest(
  plan: CandidateTwoCompiledPlanV1,
  overrides: Partial<KernelOperationPlanRequestV1> = {},
): KernelOperationPlanRequestV1 {
  const request: KernelOperationPlanRequestV1 = {
    capabilitySetId: 'capability-set-1',
    clientInstanceId: 'client-1',
    expiresAtEpochMs: SESSION_NOW + 30_000,
    kind: 'operation-plan-request',
    plan,
    schemaVersion: 1,
    sequence: 0,
    sessionId: 'session-1',
    settlement: 'fast-immediate',
    turnId: 'turn-1',
    ...overrides,
  };
  if (request.settlement === 'verified-deferred' && request.simulatedStateFingerprint === undefined) {
    request.simulatedStateFingerprint = MATCHING_STATE_FINGERPRINT;
  }
  return request;
}

function acceptPlan(
  plan: CandidateTwoCompiledPlanV1,
  operationIds?: KernelOperationSessionDescriptorV1['allowedOperationIds'],
) {
  const authority = createOperationSessionAuthority(plan, operationIds);
  return authority.accept(operationPlanRequest(plan), SESSION_NOW);
}

function createOperationSessionAuthority(
  plan: CandidateTwoCompiledPlanV1,
  operationIds?: KernelOperationSessionDescriptorV1['allowedOperationIds'],
) {
  return new KernelOperationSessionAuthorityV1({
    binding: {
      clientInstanceId: 'client-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    },
    descriptor: operationSessionDescriptor(plan, operationIds),
    nowEpochMs: SESSION_NOW,
  });
}

function candidateTwoVisualPlan(): CandidateTwoCompiledPlanV1 {
  const plan = candidateTwoPlan();
  return {
    ...plan,
    steps: [
      ...plan.steps,
      {
        arguments: { times: [1.5, 7.5] },
        operationId: 'timeline.visual.capture-grid.v1',
        sequence: 3,
        stepId: 'visual',
      },
    ],
  };
}

function settlement(
  plan: CandidateTwoCompiledPlanV1,
  overrides: Partial<KernelOperationPlanSettlementV1> = {},
): KernelOperationPlanSettlementV1 {
  return {
    batchId: plan.batchId,
    capabilitySetId: 'capability-set-1',
    clientInstanceId: 'client-1',
    decision: 'commit',
    kind: 'operation-plan-settlement',
    preparedStateFingerprint: MATCHING_STATE_FINGERPRINT,
    reasonCode: 'private-verification-passed',
    schemaVersion: 1,
    sequence: 0,
    sessionId: 'session-1',
    simulatedStateFingerprint: MATCHING_STATE_FINGERPRINT,
    turnId: 'turn-1',
    ...overrides,
  };
}

describe('WP1 public operation boundary spike', () => {
  it('pins deterministic structural digests and exposes no model intelligence fields', () => {
    expect(sha256(canonicalPublicOperationContractV1())).toBe(PUBLIC_OPERATION_CONTRACT_DIGEST_V1);
    expect(sha256(canonicalPublicCompiledPlanExtensionV1())).toBe(PUBLIC_COMPILED_PLAN_DIGEST_V1);

    const publicShape = `${canonicalPublicOperationContractV1()}${canonicalPublicCompiledPlanExtensionV1()}`;
    expect(publicShape).toContain('withLinked');
    expect(publicShape).toContain('snapToAudioZeroCrossing');
    expect(publicShape).toContain('deClickFadeSeconds');
    expect(publicShape).toContain('"data","segments","videoClipIds"');
    expect(publicShape).toContain('declared-array-element-only-v1');
    for (const forbidden of [
      'description',
      'instructions',
      'intentTags',
      'preconditions',
      'provider',
      'recovery',
      'systemPrompt',
      'verification',
    ]) {
      expect(publicShape).not.toContain(forbidden);
    }
  });

  it('executes candidate one through one validated local transaction', async () => {
    const transaction = transactionSpies();
    const dispatch = vi.fn(async () => ({
      success: true,
      data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
    }));
    const result = await executeCandidateOneEnvelopeV1(candidateOneEnvelope(), {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      {
        operationId: 'timeline.segment.split.v1',
        result: {
          success: true,
          data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
        },
        sequence: 1,
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith(
      'timeline.segment.split.v1',
      { clipId: 'clip-1', times: [3, 5], withLinked: true },
    );
    expect(transaction.begin).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.abort).not.toHaveBeenCalled();
  });

  it('fails candidate one closed before mutation on contract, effect, revision, or policy mismatch', async () => {
    const cases: Array<{
      deps?: Partial<PublicOperationExecutionDependenciesV1>;
      mutate(envelope: CandidateOneEnvelopeV1): void;
    }> = [
      { mutate: (envelope) => { envelope.contractDigest = 'sha256:wrong'; } },
      { mutate: (envelope) => { envelope.allowedEffects = []; } },
      { mutate: () => {}, deps: { getTimelineRevision: () => 8 } },
      { mutate: () => {}, deps: { authorize: () => false } },
    ];

    for (const testCase of cases) {
      const envelope = candidateOneEnvelope();
      testCase.mutate(envelope);
      const transaction = transactionSpies();
      const dispatch = vi.fn(async () => ({ success: true }));
      await expect(executeCandidateOneEnvelopeV1(envelope, {
        authorize: testCase.deps?.authorize ?? (() => true),
        dispatch,
        getTimelineRevision: testCase.deps?.getTimelineRevision ?? (() => 7),
        transaction,
      })).rejects.toBeInstanceOf(PublicOperationBoundaryError);
      expect(transaction.begin).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it('projects bounded visual evidence without opening a mutation transaction', async () => {
    const transaction = transactionSpies();
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await executeCandidateOneEnvelopeV1(candidateOneVisualEnvelope(), {
      authorize: () => true,
      dispatch: vi.fn(async () => ({
        success: true,
        data: {
          dataUrl,
          frameTimes: [1.5, 7.5, 13.5],
          renderDiagnostics: { privateNoise: true },
        },
      })),
      getTimelineRevision: () => 7,
      transaction,
    });

    expect(result).toMatchObject({
      success: true,
      results: [{
        result: {
          success: true,
          data: { frameTimes: [1.5, 7.5, 13.5], imageDataUrl: dataUrl },
        },
      }],
    });
    expect(JSON.stringify(result)).not.toContain('privateNoise');
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it('rejects visual evidence that does not correspond to the requested timestamps', async () => {
    const transaction = transactionSpies();
    const result = await executeCandidateOneEnvelopeV1(candidateOneVisualEnvelope(), {
      authorize: () => true,
      dispatch: vi.fn(async () => ({
        success: true,
        data: {
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          frameTimes: [1.5, 7.5, 12.5],
        },
      })),
      getTimelineRevision: () => 7,
      transaction,
    });

    expect(result).toMatchObject({
      success: false,
      results: [{
        result: {
          error: 'editor operation returned invalid visual evidence',
          success: false,
        },
      }],
    });
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it('executes candidate two bindings sequentially inside one transaction', async () => {
    const transaction = transactionSpies();
    const dispatch = vi.fn(async (operationId: string, args: Record<string, unknown>) => {
      if (operationId === 'timeline.segment.split.v1') {
        return {
          success: true,
          data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
        };
      }
      expect(args).toEqual({ clipIds: ['segment-1'], withLinked: true });
      return { success: true, data: { deletedEntityIds: ['segment-1'] } };
    });

    const result = await executeCandidateTwoCompiledPlanV1(candidateTwoPlan(), {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      {
        operationId: 'timeline.segment.split.v1',
        result: {
          success: true,
          data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
        },
        sequence: 1,
      },
      {
        operationId: 'timeline.segment.delete-many.v1',
        result: { success: true },
        sequence: 2,
      },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(transaction.begin).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.abort).not.toHaveBeenCalled();
  });

  it('binds operation authority to one authenticated session, turn, expiry, and sequence', () => {
    const plan = candidateTwoPlan();
    const authority = new KernelOperationSessionAuthorityV1({
      binding: {
        clientInstanceId: 'client-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      },
      descriptor: operationSessionDescriptor(plan),
      nowEpochMs: SESSION_NOW,
    });
    const accepted = authority.accept(operationPlanRequest(plan), SESSION_NOW);
    expect(accepted.plan).toEqual(plan);
    expect(accepted.plan).not.toBe(plan);
    expect(() => {
      accepted.plan.batchId = 'mutated-after-accept';
    }).toThrow();
    expect(accepted.plan.batchId).toBe('batch-plan-1');
    expect(accepted.settlement).toBe('fast-immediate');
    expect(authority.expectedSequence).toBe(1);
    expect(() => authority.accept(operationPlanRequest(plan), SESSION_NOW))
      .toThrow('sequence');

    for (const override of [
      { capabilitySetId: 'other-capability-set' },
      { clientInstanceId: 'other-client' },
      { sessionId: 'other-session' },
      { turnId: 'other-turn' },
      { expiresAtEpochMs: SESSION_NOW - 1 },
    ] satisfies Array<Partial<KernelOperationPlanRequestV1>>) {
      const fresh = new KernelOperationSessionAuthorityV1({
        binding: {
          clientInstanceId: 'client-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
        },
        descriptor: operationSessionDescriptor(plan),
        nowEpochMs: SESSION_NOW,
      });
      expect(() => fresh.accept(operationPlanRequest(plan, override), SESSION_NOW))
        .toThrow('binding, sequence, or expiry');
    }
  });

  it('rejects a valid plan whose operation is outside the authenticated capability set', () => {
    const plan = candidateTwoPlan();
    const authority = new KernelOperationSessionAuthorityV1({
      binding: {
        clientInstanceId: 'client-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      },
      descriptor: operationSessionDescriptor(plan, ['timeline.segment.split.v1']),
      nowEpochMs: SESSION_NOW,
    });
    expect(() => authority.accept(operationPlanRequest(plan), SESSION_NOW))
      .toThrow('authenticated capability set');
    expect(authority.expectedSequence).toBe(0);
  });

  it('keeps visual evidence reversible until one bound private settlement commits it', async () => {
    const plan = candidateTwoVisualPlan();
    const transaction = transactionSpies();
    const dispatch = vi.fn(async (operationId: string) => {
      if (operationId === 'timeline.segment.split.v1') {
        return {
          success: true,
          data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
        };
      }
      if (operationId === 'timeline.visual.capture-grid.v1') {
        return {
          success: true,
          data: {
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            frameTimes: [1.5, 7.5],
          },
        };
      }
      return { success: true };
    });
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        ...matchingFingerprintCallbacks,
        dispatch,
        getTimelineRevision: () => 7,
        transaction,
      },
    });

    const request = operationPlanRequest(plan, {
      settlement: 'verified-deferred',
    });
    const prepared = await roundTrip.execute(request, SESSION_NOW);
    expect(prepared.status).toBe('prepared');
    expect(prepared.result.results.at(-1)).toMatchObject({
      operationId: 'timeline.visual.capture-grid.v1',
      result: {
        success: true,
        data: {
          frameTimes: [1.5, 7.5],
          imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      },
    });
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(await roundTrip.execute(structuredClone(request), SESSION_NOW)).toEqual(prepared);
    expect(dispatch).toHaveBeenCalledTimes(3);
    const conflictingReplay = structuredClone(request);
    conflictingReplay.plan.batchId = 'conflicting-replay';
    await expect(roundTrip.execute(conflictingReplay, SESSION_NOW))
      .rejects.toThrow('conflicts with its completed request');

    const committed = await roundTrip.settle(settlement(plan));
    expect(committed.outcome).toBe('committed');
    expect(committed).toMatchObject({
      committedStateFingerprint: MATCHING_STATE_FINGERPRINT,
      preparedStateFingerprint: MATCHING_STATE_FINGERPRINT,
      simulatedStateFingerprint: MATCHING_STATE_FINGERPRINT,
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    await expect(roundTrip.settle(settlement(plan))).resolves.toEqual(committed);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    await expect(roundTrip.settle(settlement(plan, {
      decision: 'abort',
      reasonCode: 'private-verification-failed',
    }))).rejects.toThrow('conflicts');
  });

  it('aborts before commit when the prepared real-state fingerprint differs from simulation', async () => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        dispatch: async (operationId) => operationId === 'timeline.segment.split.v1'
          ? {
              success: true,
              data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
            }
          : { success: true },
        getCommittedStateFingerprint: async () => DIFFERENT_STATE_FINGERPRINT,
        getPreparedStateFingerprint: async () => DIFFERENT_STATE_FINGERPRINT,
        getTimelineRevision: () => 7,
        transaction,
      },
    });
    const prepared = await roundTrip.execute(operationPlanRequest(plan, {
      settlement: 'verified-deferred',
    }), SESSION_NOW);
    expect(prepared).toMatchObject({
      preparedStateFingerprint: DIFFERENT_STATE_FINGERPRINT,
      status: 'prepared',
    });

    const receipt = await roundTrip.settle(settlement(plan, {
      decision: 'abort',
      preparedStateFingerprint: DIFFERENT_STATE_FINGERPRINT,
      reasonCode: 'simulated-real-fingerprint-mismatch',
    }));
    expect(receipt).toMatchObject({
      outcome: 'aborted',
      preparedStateFingerprint: DIFFERENT_STATE_FINGERPRINT,
      simulatedStateFingerprint: MATCHING_STATE_FINGERPRINT,
    });
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('fails closed when a commit verdict conflicts with the prepared fingerprint binding', async () => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        ...matchingFingerprintCallbacks,
        dispatch: async (operationId) => operationId === 'timeline.segment.split.v1'
          ? {
              success: true,
              data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
            }
          : { success: true },
        getTimelineRevision: () => 7,
        transaction,
      },
    });
    await roundTrip.execute(operationPlanRequest(plan, {
      settlement: 'verified-deferred',
    }), SESSION_NOW);

    await expect(roundTrip.settle(settlement(plan, {
      preparedStateFingerprint: DIFFERENT_STATE_FINGERPRINT,
    }))).rejects.toThrow('fingerprint binding mismatch aborted');
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['missing approval handler', undefined],
    ['mismatched approval binding', async () => ({
      decision: 'approved' as const,
      planBinding: 'different-plan',
    })],
  ])('blocks a required destructive operation for %s', async (_label, requestConfirmation) => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    const dispatch = vi.fn(async () => ({ success: true }));
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      ...(requestConfirmation ? { requestConfirmation } : {}),
      dependencies: {
        dispatch,
        getTimelineRevision: () => 7,
        transaction,
      },
    });

    await expect(roundTrip.execute(operationPlanRequest(plan), SESSION_NOW)).resolves.toMatchObject({
      errorCode: 'confirmation-denied',
      result: { results: [], success: false },
      status: 'failed',
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it('aborts a prepared edit on a bound failed-verification verdict', async () => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        ...matchingFingerprintCallbacks,
        dispatch: async (operationId) => operationId === 'timeline.segment.split.v1'
          ? {
              success: true,
              data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
            }
          : { success: true },
        getTimelineRevision: () => 7,
        transaction,
      },
    });
    await roundTrip.execute(operationPlanRequest(plan, {
      settlement: 'verified-deferred',
    }), SESSION_NOW);

    await expect(roundTrip.settle(settlement(plan, { turnId: 'other-turn' })))
      .rejects.toThrow('does not match');
    expect(transaction.abort).not.toHaveBeenCalled();
    const aborted = await roundTrip.settle(settlement(plan, {
      decision: 'abort',
      reasonCode: 'private-verification-failed',
    }));
    expect(aborted.outcome).toBe('aborted');
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('reports transaction ownership loss instead of claiming commit or rollback', async () => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    transaction.commit.mockImplementation(() => {
      throw new PublicOperationTransactionOwnershipLostError();
    });
    transaction.abort.mockImplementation(() => {
      throw new PublicOperationTransactionOwnershipLostError();
    });
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        ...matchingFingerprintCallbacks,
        dispatch: async (operationId) => operationId === 'timeline.segment.split.v1'
          ? {
              success: true,
              data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
            }
          : { success: true },
        getTimelineRevision: () => 7,
        transaction,
      },
    });
    await roundTrip.execute(operationPlanRequest(plan, {
      settlement: 'verified-deferred',
    }), SESSION_NOW);

    const receipt = await roundTrip.settle(settlement(plan));
    expect(receipt.outcome).toBe('ownership-lost');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.abort).toHaveBeenCalledTimes(1);
  });

  it('uses the same round-trip executor for immediate Fast settlement', async () => {
    const plan = candidateTwoPlan();
    const transaction = transactionSpies();
    const roundTrip = new KernelOperationRoundTripV1({
      authority: createOperationSessionAuthority(plan),
      requestConfirmation: approveConfirmation,
      dependencies: {
        ...matchingFingerprintCallbacks,
        dispatch: async (operationId) => operationId === 'timeline.segment.split.v1'
          ? {
              success: true,
              data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
            }
          : { success: true },
        getTimelineRevision: () => 7,
        transaction,
      },
    });

    const result = await roundTrip.execute(operationPlanRequest(plan), SESSION_NOW);
    expect(result.status).toBe('committed');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.abort).not.toHaveBeenCalled();
    await expect(roundTrip.settle(settlement(plan))).rejects.toThrow('does not match');
  });

  it('rolls back candidate two when a later operation fails or local policy denies it', async () => {
    for (const denyDelete of [false, true]) {
      const transaction = transactionSpies();
      const dispatch = vi.fn(async (operationId: string) => operationId === 'timeline.segment.split.v1'
        ? {
            success: true,
            data: { segments: { videoClipIds: ['segment-0', 'segment-1', 'segment-2'] } },
          }
        : { success: false, error: 'delete failed' });
      const execution = executeCandidateTwoCompiledPlanV1(candidateTwoPlan(), {
        authorize: (operationId) => !denyDelete || operationId !== 'timeline.segment.delete-many.v1',
        dispatch,
        getTimelineRevision: () => 7,
        transaction,
      });

      if (denyDelete) {
        await expect(execution).rejects.toThrow('local policy denied operation');
      } else {
        await expect(execution).resolves.toMatchObject({ success: false });
      }
      expect(transaction.abort).toHaveBeenCalledTimes(1);
      expect(transaction.commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed and rolls back when a handler returns an undeclared result shape', async () => {
    const transaction = transactionSpies();
    const dispatch = vi.fn(async () => ({
      success: true,
      data: { segments: { videoClipIds: ['only-one-segment'] } },
    }));

    await expect(executeCandidateTwoCompiledPlanV1(candidateTwoPlan(), {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    })).resolves.toMatchObject({ success: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(transaction.abort).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects undeclared ripple semantics before opening a transaction', async () => {
    const plan = candidateTwoPlan();
    const deleteStep = plan.steps.find(
      (step) => step.operationId === 'timeline.segment.delete-many.v1',
    );
    if (!deleteStep) throw new Error('test plan has no delete step');
    (deleteStep.arguments as Record<string, unknown>).ripple = true;
    const transaction = transactionSpies();
    const dispatch = vi.fn(async () => ({ success: true }));

    await expect(executeCandidateTwoCompiledPlanV1(plan, {
      authorize: () => true,
      dispatch,
      getTimelineRevision: () => 7,
      transaction,
    })).rejects.toBeInstanceOf(PublicOperationBoundaryError);
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects forward, undeclared, and prototype binding paths before opening a transaction', async () => {
    for (const path of [
      ['data', 'segments', 'videoClipIds', 1],
      ['data', 'splitTimes', 0],
      ['data', '__proto__'],
    ] as Array<Array<number | string>>) {
      const plan = candidateTwoPlan();
      const binding = plan.steps[0]?.arguments as Record<string, unknown>;
      binding.clipId = {
        $result: {
          path,
          stepId: path.includes('__proto__') || path.includes('splitTimes') ? 'split' : 'delete',
        },
      };
      const transaction = transactionSpies();
      await expect(executeCandidateTwoCompiledPlanV1(plan, {
        authorize: () => true,
        dispatch: vi.fn(async () => ({ success: true })),
        getTimelineRevision: () => 7,
        transaction,
      })).rejects.toBeInstanceOf(PublicOperationBoundaryError);
      expect(transaction.begin).not.toHaveBeenCalled();
      expect(transaction.abort).not.toHaveBeenCalled();
    }
  });

  it('maps structural operation ids onto the existing local tool executor only', async () => {
    const executeToolCalls = vi.fn(async (calls: Array<{ id?: string; tool: string }>) => (
      calls.map((call) => ({
        ...call,
        result: call.tool === 'getFramesAtTimes'
          ? {
              success: true,
              data: {
                dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                frameTimes: [1.5, 7.5],
              },
            }
          : { success: true, data: { resultingParts: 3 } },
      }))
    ));
    const dispatch = createWp1EditorOperationDispatcher(executeToolCalls);

    await expect(dispatch('timeline.segment.split.v1', {
      clipId: 'clip-1',
      times: [3, 5],
    })).resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenCalledWith(
      [{
        id: 'wp1:timeline.segment.split.v1',
        tool: 'splitClipAtTimes',
        args: { clipId: 'clip-1', times: [3, 5] },
      }],
      'kernel',
      { guidedReplay: false, suppressHistory: true },
    );
    await expect(dispatch('timeline.visual.capture-grid.v1', {
      times: [1.5, 7.5],
    })).resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenLastCalledWith(
      [{
        id: 'wp1:timeline.visual.capture-grid.v1',
        tool: 'getFramesAtTimes',
        args: { times: [1.5, 7.5] },
      }],
      'kernel',
      { guidedReplay: false, suppressHistory: true },
    );
    await expect(dispatch('timeline.intercut.preview.v1', {}))
      .resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenLastCalledWith(
      [{ id: 'wp1:timeline.intercut.preview.v1', tool: 'getTimelineState', args: {} }],
      'kernel',
      { guidedReplay: false, suppressHistory: true },
    );
    await expect(dispatch('timeline.editor.program.preview.v1', {}))
      .resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenLastCalledWith(
      [{
        id: 'wp1:timeline.editor.program.preview.v1',
        tool: 'getTimelineState',
        args: {},
      }],
      'kernel',
      { guidedReplay: false, suppressHistory: true },
    );
    const assemblyBatch = {
      requests: [
        { args: { duration: 2, name: 'Remix' }, toolName: 'createComposition' },
        {
          args: {
            inPoint: 1,
            mediaFileId: 'media-a',
            outPoint: 1.2,
            startTime: 0,
            trackId: null,
          },
          toolName: 'addClipSegment',
        },
      ],
    };
    await expect(dispatch('timeline.editor.program.commit.v1', {
      requestJson: JSON.stringify(assemblyBatch),
    })).resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenLastCalledWith(
      [
        {
          args: { duration: 2, name: 'Remix' },
          id: 'wp1:timeline.editor.program.commit.v1:1:createComposition',
          tool: 'createComposition',
        },
        {
          args: {
            inPoint: 1,
            mediaFileId: 'media-a',
            outPoint: 1.2,
            startTime: 0,
            trackId: null,
          },
          id: 'wp1:timeline.editor.program.commit.v1:2:addClipSegment',
          tool: 'addClipSegment',
        },
      ],
      'kernel',
      { guidedReplay: false, suppressHistory: false },
    );
    await expect(dispatch('timeline.intercut.commit.v1', {
      clipIds: ['shot-a', 'shot-b'],
      startTime: 0,
      withLinked: true,
    })).resolves.toMatchObject({ success: true });
    expect(executeToolCalls).toHaveBeenLastCalledWith(
      [{
        id: 'wp1:timeline.intercut.commit.v1',
        tool: 'reorderClips',
        args: { clipIds: ['shot-a', 'shot-b'], startTime: 0, withLinked: true },
      }],
      'kernel',
      { guidedReplay: false, suppressHistory: true },
    );
    const plan = candidateTwoPlan();
    const authorize = createWp1EditorOperationAuthorization(acceptPlan(
      plan,
      ['timeline.segment.split.v1', 'timeline.segment.delete-many.v1'],
    ));
    expect(authorize('timeline.segment.split.v1')).toBe(true);
    expect(authorize('timeline.segment.delete-many.v1')).toBe(true);
    expect(authorize('timeline.visual.capture-grid.v1')).toBe(false);
    const visualPlan: CandidateTwoCompiledPlanV1 = {
      ...plan,
      allowedEffects: [],
      batchId: 'visual-plan',
      steps: [{
        arguments: { times: [1.5, 7.5] },
        operationId: 'timeline.visual.capture-grid.v1',
        sequence: 1,
        stepId: 'visual',
      }],
    };
    const authorizeVisual = createWp1EditorOperationAuthorization(acceptPlan(visualPlan));
    expect(authorizeVisual('timeline.visual.capture-grid.v1')).toBe(true);
    expect(checkToolAccess('splitClipAtTimes', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('deleteClips', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('getFramesAtTimes', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('getTimelineState', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('reorderClips', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('deleteClip', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('executeBatch', 'kernel').allowed).toBe(false);
    expect(checkToolAccess('createEditableTitleStack', 'kernel').allowed).toBe(false);
  });
});
