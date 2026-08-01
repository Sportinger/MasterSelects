import {
  getPublicOperationSpecV1,
  isPublicTimelineStateFingerprintV1,
  type PublicOperationIdV1,
} from './publicOperationContracts';
import {
  PublicOperationTransactionOwnershipLostError,
  type CandidateBoundaryResultV1,
  type PublicOperationExecutionDependenciesV1,
} from './candidateOneOperationExecutor';
import {
  executeCandidateTwoCompiledPlanV1,
  prepareCandidateTwoCompiledPlanV1,
  type PreparedCandidateTwoExecutionV1,
} from './candidateTwoCompiledPlanExecutor';
import { createWp1EditorOperationAuthorization } from './editorOperationDispatcher';
import {
  type AcceptedKernelOperationPlanV1,
  type KernelOperationPlanRequestV1,
  type KernelOperationPlanSettlementV1,
  type KernelOperationSessionAuthorityV1,
} from './operationSessionAuthority';

export interface KernelOperationPlanResultV1 {
  batchId: string;
  capabilitySetId: string;
  clientInstanceId: string;
  errorCode?:
    | 'confirmation-denied'
    | 'execution-rejected'
    | 'fingerprint-unavailable'
    | 'transaction-ownership-lost';
  kind: 'operation-plan-result';
  preparedStateFingerprint?: string;
  result: CandidateBoundaryResultV1;
  schemaVersion: 1;
  sequence: number;
  sessionId: string;
  stateRevisionAfter: number;
  stateRevisionBefore: number;
  status: 'committed' | 'failed' | 'prepared';
  turnId: string;
}

export interface KernelOperationSettlementReceiptV1 {
  batchId: string;
  capabilitySetId: string;
  clientInstanceId: string;
  kind: 'operation-plan-settlement-receipt';
  outcome: 'aborted' | 'committed' | 'ownership-lost';
  committedStateFingerprint?: string;
  preparedStateFingerprint: string;
  schemaVersion: 1;
  sequence: number;
  sessionId: string;
  simulatedStateFingerprint: string;
  stateRevisionAfterSettlement: number;
  turnId: string;
}

type MechanicalDependenciesV1 = Omit<PublicOperationExecutionDependenciesV1, 'authorize'>;

export interface KernelOperationConfirmationRequestV1 {
  readonly batchId: string;
  readonly kind: 'kernel-operation-confirmation-request';
  readonly planBinding: string;
  readonly requiredOperations: ReadonlyArray<Readonly<{
    operationId: PublicOperationIdV1;
    sequence: number;
  }>>;
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface KernelOperationConfirmationResponseV1 {
  decision: 'approved' | 'denied';
  planBinding: string;
}

export type KernelOperationConfirmationHandlerV1 = (
  request: Readonly<KernelOperationConfirmationRequestV1>,
) => Promise<KernelOperationConfirmationResponseV1>;

interface PendingExecutionV1 {
  accepted: AcceptedKernelOperationPlanV1;
  preparedStateFingerprint: string;
  prepared: PreparedCandidateTwoExecutionV1;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function resultEnvelope(
  accepted: AcceptedKernelOperationPlanV1,
  result: CandidateBoundaryResultV1,
  input: {
    errorCode?: KernelOperationPlanResultV1['errorCode'];
    preparedStateFingerprint?: string;
    stateRevisionAfter: number;
    stateRevisionBefore: number;
    status: KernelOperationPlanResultV1['status'];
  },
): KernelOperationPlanResultV1 {
  return {
    batchId: accepted.plan.batchId,
    capabilitySetId: accepted.capabilitySetId,
    clientInstanceId: accepted.clientInstanceId,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    kind: 'operation-plan-result',
    ...(input.preparedStateFingerprint === undefined
      ? {}
      : { preparedStateFingerprint: input.preparedStateFingerprint }),
    result,
    schemaVersion: 1,
    sequence: accepted.sequence,
    sessionId: accepted.sessionId,
    stateRevisionAfter: input.stateRevisionAfter,
    stateRevisionBefore: input.stateRevisionBefore,
    status: input.status,
    turnId: accepted.turnId,
  };
}

function settlementKey(sessionId: string, sequence: number): string {
  return `${sessionId}:${sequence}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Kernel operation execution was canceled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/**
 * Client-side two-phase operation ledger. Fast commits through the same
 * executor immediately. Verified keeps the real edit reversible while the
 * bounded result (including projected visual evidence) travels to the private
 * verifier, then applies exactly one bound commit/abort settlement.
 */
export class KernelOperationRoundTripV1 {
  private readonly authority: KernelOperationSessionAuthorityV1;
  private readonly completedResults = new Map<number, KernelOperationPlanResultV1>();
  private readonly completedRequestFingerprints = new Map<number, string>();
  private readonly deps: MechanicalDependenciesV1;
  private readonly pending = new Map<number, PendingExecutionV1>();
  private readonly requestConfirmation?: KernelOperationConfirmationHandlerV1;
  private readonly settlementReceipts = new Map<string, {
    receipt: KernelOperationSettlementReceiptV1;
    settlementFingerprint: string;
  }>();

  constructor(input: {
    authority: KernelOperationSessionAuthorityV1;
    requestConfirmation?: KernelOperationConfirmationHandlerV1;
    dependencies: MechanicalDependenciesV1;
  }) {
    this.authority = input.authority;
    this.deps = input.dependencies;
    this.requestConfirmation = input.requestConfirmation;
  }

  private async confirmRequiredOperations(
    accepted: AcceptedKernelOperationPlanV1,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const requiredOperations = accepted.plan.steps
      .filter((step) => getPublicOperationSpecV1(step.operationId)?.confirmation === 'required')
      .map((step) => ({ operationId: step.operationId, sequence: step.sequence }));
    if (requiredOperations.length === 0) return true;

    const planBinding = canonicalJson({
      clientInstanceId: accepted.clientInstanceId,
      plan: accepted.plan,
      sequence: accepted.sequence,
      sessionId: accepted.sessionId,
      turnId: accepted.turnId,
    });
    const confirmationRequest = Object.freeze({
      batchId: accepted.plan.batchId,
      kind: 'kernel-operation-confirmation-request' as const,
      planBinding,
      requiredOperations: Object.freeze(requiredOperations.map((operation) => Object.freeze(operation))),
      schemaVersion: 1 as const,
      sequence: accepted.sequence,
      sessionId: accepted.sessionId,
      turnId: accepted.turnId,
    });
    if (!this.requestConfirmation) return false;
    try {
      const response = await waitForAbortable(
        this.requestConfirmation(confirmationRequest),
        signal,
      );
      return response.decision === 'approved' && response.planBinding === planBinding;
    } catch {
      throwIfAborted(signal);
      return false;
    }
  }

  async execute(
    request: KernelOperationPlanRequestV1,
    nowEpochMs = Date.now(),
    signal?: AbortSignal,
  ): Promise<KernelOperationPlanResultV1> {
    throwIfAborted(signal);
    const cached = this.completedResults.get(request.sequence);
    if (cached) {
      if (this.completedRequestFingerprints.get(request.sequence) !== canonicalJson(request)) {
        throw new Error('kernel operation plan replay conflicts with its completed request');
      }
      return clone(cached);
    }

    const accepted = this.authority.accept(request, nowEpochMs);
    const confirmed = await this.confirmRequiredOperations(accepted, signal);
    throwIfAborted(signal);
    const stateRevisionBefore = this.deps.getTimelineRevision();
    const dependencies: PublicOperationExecutionDependenciesV1 = {
      ...this.deps,
      authorize: createWp1EditorOperationAuthorization(accepted),
    };
    let envelope: KernelOperationPlanResultV1;
    if (!confirmed) {
      envelope = resultEnvelope(accepted, {
        batchId: accepted.plan.batchId,
        results: [],
        success: false,
      }, {
        errorCode: 'confirmation-denied',
        stateRevisionAfter: stateRevisionBefore,
        stateRevisionBefore,
        status: 'failed',
      });
      this.completedResults.set(accepted.sequence, clone(envelope));
      this.completedRequestFingerprints.set(accepted.sequence, canonicalJson(request));
      return envelope;
    }
    try {
      if (accepted.settlement === 'fast-immediate') {
        const result = await executeCandidateTwoCompiledPlanV1(
          accepted.plan,
          dependencies,
          signal,
        );
        envelope = resultEnvelope(accepted, result, {
          stateRevisionAfter: this.deps.getTimelineRevision(),
          stateRevisionBefore,
          status: result.success ? 'committed' : 'failed',
        });
      } else {
        const preparation = await prepareCandidateTwoCompiledPlanV1(
          accepted.plan,
          dependencies,
          signal,
        );
        if (preparation.status === 'failed') {
          envelope = resultEnvelope(accepted, preparation.result, {
            stateRevisionAfter: this.deps.getTimelineRevision(),
            stateRevisionBefore,
            status: 'failed',
          });
        } else {
          let preparedStateFingerprint: string | undefined;
          try {
            const fingerprint = this.deps.getPreparedStateFingerprint?.();
            preparedStateFingerprint = fingerprint === undefined
              ? undefined
              : await waitForAbortable(fingerprint, signal);
          } catch {
            if (signal?.aborted) {
              preparation.abort();
              throw abortReason(signal);
            }
            preparedStateFingerprint = undefined;
          }
          if (!isPublicTimelineStateFingerprintV1(preparedStateFingerprint)) {
            preparation.abort();
            envelope = resultEnvelope(accepted, {
              batchId: accepted.plan.batchId,
              results: [],
              success: false,
            }, {
              errorCode: 'fingerprint-unavailable',
              stateRevisionAfter: this.deps.getTimelineRevision(),
              stateRevisionBefore,
              status: 'failed',
            });
          } else {
            this.pending.set(accepted.sequence, {
              accepted,
              prepared: preparation,
              preparedStateFingerprint,
            });
            envelope = resultEnvelope(accepted, preparation.result, {
              preparedStateFingerprint,
              stateRevisionAfter: this.deps.getTimelineRevision(),
              stateRevisionBefore,
              status: 'prepared',
            });
          }
        }
      }
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      envelope = resultEnvelope(accepted, {
        batchId: accepted.plan.batchId,
        results: [],
        success: false,
      }, {
        errorCode: error instanceof PublicOperationTransactionOwnershipLostError
          ? 'transaction-ownership-lost'
          : 'execution-rejected',
        stateRevisionAfter: this.deps.getTimelineRevision(),
        stateRevisionBefore,
        status: 'failed',
      });
    }
    this.completedResults.set(accepted.sequence, clone(envelope));
    this.completedRequestFingerprints.set(accepted.sequence, canonicalJson(request));
    return envelope;
  }

  async settle(settlement: KernelOperationPlanSettlementV1): Promise<KernelOperationSettlementReceiptV1> {
    if (
      !isRecord(settlement)
      || !hasOnlyKeys(settlement, [
        'batchId',
        'capabilitySetId',
        'clientInstanceId',
        'decision',
        'kind',
        'preparedStateFingerprint',
        'reasonCode',
        'schemaVersion',
        'sequence',
        'sessionId',
        'simulatedStateFingerprint',
        'turnId',
      ])
    ) {
      throw new Error('kernel operation settlement has an invalid envelope');
    }
    const key = settlementKey(settlement.sessionId, settlement.sequence);
    const prior = this.settlementReceipts.get(key);
    if (prior) {
      if (prior.settlementFingerprint !== canonicalJson(settlement)) {
        throw new Error('kernel operation settlement replay conflicts with its prior decision');
      }
      return clone(prior.receipt);
    }
    const pending = this.pending.get(settlement.sequence);
    if (
      !pending
      || settlement.schemaVersion !== 1
      || settlement.kind !== 'operation-plan-settlement'
      || settlement.batchId !== pending.accepted.plan.batchId
      || settlement.capabilitySetId !== pending.accepted.capabilitySetId
      || settlement.clientInstanceId !== pending.accepted.clientInstanceId
      || settlement.sessionId !== pending.accepted.sessionId
      || settlement.turnId !== pending.accepted.turnId
      || !['abort', 'commit'].includes(settlement.decision)
      || ![
        'canceled',
        'private-verification-failed',
        'private-verification-passed',
        'simulated-real-fingerprint-mismatch',
      ].includes(settlement.reasonCode)
    ) {
      throw new Error('kernel operation settlement does not match a prepared execution');
    }

    if (
      settlement.simulatedStateFingerprint !== pending.accepted.simulatedStateFingerprint
      || settlement.preparedStateFingerprint !== pending.preparedStateFingerprint
      || !isPublicTimelineStateFingerprintV1(settlement.simulatedStateFingerprint)
      || !isPublicTimelineStateFingerprintV1(settlement.preparedStateFingerprint)
    ) {
      try {
        pending.prepared.abort();
      } finally {
        this.pending.delete(settlement.sequence);
      }
      throw new Error('kernel operation settlement fingerprint binding mismatch aborted the prepared execution');
    }
    const fingerprintsMatch = settlement.simulatedStateFingerprint
      === settlement.preparedStateFingerprint;
    if (
      (settlement.decision === 'commit'
        && (settlement.reasonCode !== 'private-verification-passed' || !fingerprintsMatch))
      || (settlement.reasonCode === 'private-verification-passed'
        && settlement.decision !== 'commit')
      || (settlement.reasonCode === 'simulated-real-fingerprint-mismatch'
        && (settlement.decision !== 'abort' || fingerprintsMatch))
    ) {
      try {
        pending.prepared.abort();
      } finally {
        this.pending.delete(settlement.sequence);
      }
      throw new Error('kernel operation settlement fingerprint verdict aborted the prepared execution');
    }

    let outcome: KernelOperationSettlementReceiptV1['outcome'];
    let committedStateFingerprint: string | undefined;
    if (settlement.decision === 'abort') {
      try {
        pending.prepared.abort();
        outcome = 'aborted';
      } catch (error) {
        if (!(error instanceof PublicOperationTransactionOwnershipLostError)) throw error;
        outcome = 'ownership-lost';
      }
    } else {
      try {
        pending.prepared.commit();
        outcome = 'committed';
      } catch (error) {
        if (!(error instanceof PublicOperationTransactionOwnershipLostError)) throw error;
        outcome = 'ownership-lost';
      }
    }
    this.pending.delete(settlement.sequence);
    if (outcome === 'committed') {
      try {
        committedStateFingerprint = await this.deps.getCommittedStateFingerprint?.();
      } catch {
        committedStateFingerprint = undefined;
      }
      if (
        !isPublicTimelineStateFingerprintV1(committedStateFingerprint)
        || committedStateFingerprint !== pending.preparedStateFingerprint
      ) {
        throw new Error('kernel operation committed state fingerprint does not match its prepared state');
      }
    }
    const receipt: KernelOperationSettlementReceiptV1 = {
      batchId: pending.accepted.plan.batchId,
      capabilitySetId: pending.accepted.capabilitySetId,
      clientInstanceId: pending.accepted.clientInstanceId,
      ...(committedStateFingerprint === undefined ? {} : { committedStateFingerprint }),
      kind: 'operation-plan-settlement-receipt',
      outcome,
      preparedStateFingerprint: pending.preparedStateFingerprint,
      schemaVersion: 1,
      sequence: pending.accepted.sequence,
      sessionId: pending.accepted.sessionId,
      simulatedStateFingerprint: settlement.simulatedStateFingerprint,
      stateRevisionAfterSettlement: this.deps.getTimelineRevision(),
      turnId: pending.accepted.turnId,
    };
    this.settlementReceipts.set(key, {
      receipt: clone(receipt),
      settlementFingerprint: canonicalJson(settlement),
    });
    return receipt;
  }

  abortPending(): void {
    for (const pending of this.pending.values()) {
      try {
        pending.prepared.abort();
      } catch {
        // Page teardown cannot repair a transaction whose external owner was
        // already lost. The bound settlement path reports this explicitly.
      }
    }
    this.pending.clear();
  }
}
