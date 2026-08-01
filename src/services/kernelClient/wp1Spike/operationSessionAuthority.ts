import {
  type CandidateTwoCompiledPlanV1,
  validateCandidateTwoCompiledPlanV1,
} from './candidateTwoCompiledPlanExecutor';
import {
  getPublicOperationSpecV1,
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  PUBLIC_OPERATION_EFFECTS_V1,
  type PublicOperationEffectV1,
  type PublicOperationIdV1,
} from './publicOperationContracts';

const MAXIMUM_SESSION_LIFETIME_MS = 5 * 60 * 1_000;
const MAXIMUM_CLOCK_SKEW_MS = 5_000;
const BOUND_IDENTIFIER = /^[A-Za-z0-9:_-]+$/;
const ACCEPTED_PLAN_CONSTRUCTOR_TOKEN = Symbol('accepted-kernel-operation-plan');

export interface KernelOperationSessionDescriptorV1 {
  allowedEffects: PublicOperationEffectV1[];
  allowedOperationIds: PublicOperationIdV1[];
  authoritySource: 'same-origin-authenticated-kernel-proxy-v1';
  capabilitySetId: string;
  clientInstanceId: string;
  contractDigest: string;
  contractVersion: string;
  expiresAtEpochMs: number;
  initialPlanSequence: 0;
  issuedAtEpochMs: number;
  planDigest: string;
  planVersion: string;
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
}

export interface KernelOperationPlanRequestV1 {
  capabilitySetId: string;
  clientInstanceId: string;
  expiresAtEpochMs: number;
  kind: 'operation-plan-request';
  plan: CandidateTwoCompiledPlanV1;
  schemaVersion: 1;
  sequence: number;
  sessionId: string;
  simulatedStateFingerprint?: string;
  settlement: 'fast-immediate' | 'verified-deferred';
  turnId: string;
}

export interface KernelOperationPlanSettlementV1 {
  batchId: string;
  capabilitySetId: string;
  clientInstanceId: string;
  decision: 'abort' | 'commit';
  kind: 'operation-plan-settlement';
  preparedStateFingerprint: string;
  reasonCode:
    | 'canceled'
    | 'private-verification-failed'
    | 'private-verification-passed'
    | 'simulated-real-fingerprint-mismatch';
  schemaVersion: 1;
  sequence: number;
  sessionId: string;
  simulatedStateFingerprint: string;
  turnId: string;
}

export interface KernelOperationSessionBindingV1 {
  clientInstanceId: string;
  sessionId: string;
  turnId: string;
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validBoundIdentifier(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && BOUND_IDENTIFIER.test(value);
}

function fail(message: string): never {
  throw new Error(`kernel operation session rejected: ${message}`);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertDescriptor(
  descriptor: KernelOperationSessionDescriptorV1,
  binding: KernelOperationSessionBindingV1,
  nowEpochMs: number,
): void {
  if (
    !descriptor
    || typeof descriptor !== 'object'
    || !hasOnlyKeys(descriptor, [
      'allowedEffects',
      'allowedOperationIds',
      'authoritySource',
      'capabilitySetId',
      'clientInstanceId',
      'contractDigest',
      'contractVersion',
      'expiresAtEpochMs',
      'initialPlanSequence',
      'issuedAtEpochMs',
      'planDigest',
      'planVersion',
      'schemaVersion',
      'sessionId',
      'turnId',
    ])
    || descriptor.schemaVersion !== 1
    || descriptor.authoritySource !== 'same-origin-authenticated-kernel-proxy-v1'
    || descriptor.contractVersion !== PUBLIC_OPERATION_CONTRACT_V1.contractVersion
    || descriptor.contractDigest !== PUBLIC_OPERATION_CONTRACT_DIGEST_V1
    || descriptor.planVersion !== PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion
    || descriptor.planDigest !== PUBLIC_COMPILED_PLAN_DIGEST_V1
    || descriptor.initialPlanSequence !== 0
  ) {
    fail('contract mismatch');
  }
  if (
    descriptor.clientInstanceId !== binding.clientInstanceId
    || descriptor.sessionId !== binding.sessionId
    || descriptor.turnId !== binding.turnId
    || !validBoundIdentifier(descriptor.clientInstanceId, 200)
    || !validBoundIdentifier(descriptor.sessionId, 200)
    || !validBoundIdentifier(descriptor.turnId, 160)
    || !validBoundIdentifier(descriptor.capabilitySetId, 200)
  ) {
    fail('binding mismatch');
  }
  if (
    !Number.isFinite(nowEpochMs)
    || !Number.isInteger(descriptor.issuedAtEpochMs)
    || !Number.isInteger(descriptor.expiresAtEpochMs)
    || descriptor.issuedAtEpochMs > nowEpochMs + MAXIMUM_CLOCK_SKEW_MS
    || descriptor.expiresAtEpochMs <= nowEpochMs
    || descriptor.expiresAtEpochMs <= descriptor.issuedAtEpochMs
    || descriptor.expiresAtEpochMs - descriptor.issuedAtEpochMs > MAXIMUM_SESSION_LIFETIME_MS
  ) {
    fail('invalid or expired lifetime');
  }
  if (
    !Array.isArray(descriptor.allowedEffects)
    || new Set(descriptor.allowedEffects).size !== descriptor.allowedEffects.length
    || descriptor.allowedEffects.some((effect) => !PUBLIC_OPERATION_EFFECTS_V1.includes(effect))
    || !Array.isArray(descriptor.allowedOperationIds)
    || descriptor.allowedOperationIds.length === 0
    || descriptor.allowedOperationIds.length > PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumSteps
    || new Set(descriptor.allowedOperationIds).size !== descriptor.allowedOperationIds.length
  ) {
    fail('invalid capability set');
  }
  const effectBudget = new Set(descriptor.allowedEffects);
  for (const operationId of descriptor.allowedOperationIds) {
    const spec = getPublicOperationSpecV1(operationId);
    if (!spec || spec.effects.some((effect) => !effectBudget.has(effect))) {
      fail('operation exceeds the session effect budget');
    }
  }
}

export class AcceptedKernelOperationPlanV1 {
  readonly capabilitySetId: string;
  readonly clientInstanceId: string;
  readonly plan: CandidateTwoCompiledPlanV1;
  readonly sequence: number;
  readonly sessionId: string;
  readonly simulatedStateFingerprint?: string;
  readonly settlement: KernelOperationPlanRequestV1['settlement'];
  readonly turnId: string;
  private readonly operationIds: ReadonlySet<PublicOperationIdV1>;

  constructor(input: {
    request: KernelOperationPlanRequestV1;
  }, token: typeof ACCEPTED_PLAN_CONSTRUCTOR_TOKEN) {
    if (token !== ACCEPTED_PLAN_CONSTRUCTOR_TOKEN) {
      fail('accepted plan cannot be constructed outside its session authority');
    }
    this.capabilitySetId = input.request.capabilitySetId;
    this.clientInstanceId = input.request.clientInstanceId;
    this.plan = deepFreeze(structuredClone(input.request.plan));
    this.sequence = input.request.sequence;
    this.sessionId = input.request.sessionId;
    this.simulatedStateFingerprint = input.request.simulatedStateFingerprint;
    this.settlement = input.request.settlement;
    this.turnId = input.request.turnId;
    this.operationIds = new Set(this.plan.steps.map((step) => step.operationId));
  }

  permits(operationId: PublicOperationIdV1): boolean {
    return this.operationIds.has(operationId);
  }
}

/**
 * Runtime authority created only after the hosted transport has authenticated
 * the same-origin kernel response and supplied its exact page binding. The
 * capability-set id binds later ordered plan events to that response; it is
 * not presented as tamper resistance against a modified MIT client.
 */
export class KernelOperationSessionAuthorityV1 {
  private nextSequence: number;
  private readonly descriptor: KernelOperationSessionDescriptorV1;
  private readonly operationIds: ReadonlySet<PublicOperationIdV1>;

  constructor(input: {
    binding: KernelOperationSessionBindingV1;
    descriptor: KernelOperationSessionDescriptorV1;
    nowEpochMs?: number;
    restoredNextSequence?: number;
  }) {
    const nowEpochMs = input.nowEpochMs ?? Date.now();
    assertDescriptor(input.descriptor, input.binding, nowEpochMs);
    const restored = input.restoredNextSequence ?? input.descriptor.initialPlanSequence;
    if (!Number.isSafeInteger(restored) || restored < input.descriptor.initialPlanSequence) {
      fail('invalid restored sequence');
    }
    this.descriptor = structuredClone(input.descriptor);
    this.operationIds = new Set(input.descriptor.allowedOperationIds);
    this.nextSequence = restored;
  }

  get expectedSequence(): number {
    return this.nextSequence;
  }

  accept(
    request: KernelOperationPlanRequestV1,
    nowEpochMs = Date.now(),
  ): AcceptedKernelOperationPlanV1 {
    assertDescriptor(this.descriptor, {
      clientInstanceId: this.descriptor.clientInstanceId,
      sessionId: this.descriptor.sessionId,
      turnId: this.descriptor.turnId,
    }, nowEpochMs);
    if (
      !request
      || typeof request !== 'object'
      || !hasOnlyKeys(request, [
        'capabilitySetId',
        'clientInstanceId',
        'expiresAtEpochMs',
        'kind',
        'plan',
        'schemaVersion',
        'sequence',
        'sessionId',
        'simulatedStateFingerprint',
        'settlement',
        'turnId',
      ])
      || request.schemaVersion !== 1
      || request.kind !== 'operation-plan-request'
      || !['fast-immediate', 'verified-deferred'].includes(request.settlement)
      || (request.settlement === 'verified-deferred'
        && !/^sha256:[a-f0-9]{64}$/.test(request.simulatedStateFingerprint ?? ''))
      || (request.simulatedStateFingerprint !== undefined
        && !/^sha256:[a-f0-9]{64}$/.test(request.simulatedStateFingerprint))
      || request.capabilitySetId !== this.descriptor.capabilitySetId
      || request.clientInstanceId !== this.descriptor.clientInstanceId
      || request.sessionId !== this.descriptor.sessionId
      || request.turnId !== this.descriptor.turnId
      || !Number.isSafeInteger(request.sequence)
      || request.sequence !== this.nextSequence
      || !Number.isInteger(request.expiresAtEpochMs)
      || request.expiresAtEpochMs <= nowEpochMs
      || request.expiresAtEpochMs > this.descriptor.expiresAtEpochMs
    ) {
      fail('plan event binding, sequence, or expiry mismatch');
    }

    validateCandidateTwoCompiledPlanV1(request.plan);
    const effectBudget = new Set(this.descriptor.allowedEffects);
    if (
      request.plan.allowedEffects.some((effect) => !effectBudget.has(effect))
      || request.plan.steps.some((step) => !this.operationIds.has(step.operationId))
    ) {
      fail('plan exceeds the authenticated capability set');
    }

    const accepted = new AcceptedKernelOperationPlanV1({ request }, ACCEPTED_PLAN_CONSTRUCTOR_TOKEN);
    this.nextSequence += 1;
    return accepted;
  }
}
