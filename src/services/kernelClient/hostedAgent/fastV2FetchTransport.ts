import {
  HOSTED_AGENT_HEADERS,
  HOSTED_AGENT_K2_PROTOCOL_VERSION,
  type HostedAgentK2SessionStatus,
} from './contracts';
import {
  HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS,
  HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS,
  HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2ExecutionProfile,
  type HostedAgentFastV2StartRequest,
} from './fastV2StartContract';
import type {
  KernelOperationPlanRequestV1,
  KernelOperationPlanSettlementV1,
  KernelOperationSessionDescriptorV1,
} from '../wp1Spike/operationSessionAuthority';
import type {
  KernelOperationPlanResultV1,
  KernelOperationSettlementReceiptV1,
} from '../wp1Spike/operationRoundTrip';
import {
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  PUBLIC_OPERATION_EFFECTS_V1,
  getPublicOperationSpecV1,
} from '../wp1Spike/publicOperationContracts';
import {
  validateCandidateTwoCompiledPlanV1,
} from '../wp1Spike/candidateTwoCompiledPlanExecutor';
import { HostedAgentK2ReconnectableError } from './k2Client';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const EVENT_ID_PATTERN = /^[1-9]\d*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const JSON_CONTENT_TYPE_PATTERN = /(?:^|;)\s*application\/json(?:\s*;|$)/i;

export interface HostedAgentFastV2PageLease {
  expiresAt: string;
  leaseToken: string;
  sessionId: string;
}

export interface HostedAgentFastV2TurnAccepted {
  acceptedExecutionContractDigest: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST;
  acceptedExecutionContractVersion: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION;
  eventsPath: string;
  maximumIterations: number;
  maximumSpendCredits: number;
  pageLease: HostedAgentFastV2PageLease;
  protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
  replayed: boolean;
  route: 'fast-agent-v2';
  sessionId: string;
  turnId: string;
}

interface HostedAgentFastV2EventBase {
  eventId: string;
  protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
  sessionId: string;
  turnId: string;
}

export type HostedAgentFastV2Event =
  | (HostedAgentFastV2EventBase & {
      budgetPolicyVersion: typeof HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION;
      capabilityBundleVersion: typeof HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION;
      kind: 'session-ready';
      maximumIterations: number;
      maximumSpendCredits: number;
      modelPolicyVersion: typeof HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION;
      promptVersion: typeof HOSTED_AGENT_FAST_V2_PROMPT_VERSION;
      snapshotStateFingerprint: string;
      snapshotTimelineRevision: number;
    })
  | (HostedAgentFastV2EventBase & {
      kind: 'narration-delta' | 'narration-complete';
      phase: 'inspecting' | 'planning' | 'acting' | 'verifying';
      roundIndex: number;
      text: string;
    })
  | (HostedAgentFastV2EventBase & {
      descriptor: KernelOperationSessionDescriptorV1;
      kind: 'operation-session-ready';
    })
  | (HostedAgentFastV2EventBase & {
      kind: 'operation-plan-request';
      request: KernelOperationPlanRequestV1;
    })
  | (HostedAgentFastV2EventBase & {
      kind: 'operation-plan-settlement';
      settlement: KernelOperationPlanSettlementV1;
    })
  | (HostedAgentFastV2EventBase & {
      creditBalance: number;
      creditsCharged: number;
      kind: 'billing-settled';
      ledgerEntryId: string | null;
      roundIndex: number;
      totalCreditsCharged: number;
    })
  | (HostedAgentFastV2EventBase & {
      creditsCharged: number;
      kind: 'turn-complete';
      message: string;
      rounds: number;
    })
  | (HostedAgentFastV2EventBase & {
      kind: 'turn-canceled' | 'turn-failed' | 'turn-interrupted';
      message: string;
      recoverable: boolean;
    });

export interface HostedAgentFastV2Binding {
  clientInstanceId: string;
  leaseToken: string;
  sessionId: string;
  turnId: string;
}

export interface HostedAgentFastV2EventReplay {
  cursor: string | null;
  events: HostedAgentFastV2Event[];
  leaseExpiresAt: string;
  sessionId: string;
  status: HostedAgentK2SessionStatus;
  turnId: string;
}

export interface HostedAgentFastV2OperationPostResponse {
  accepted: true;
  cursor: string;
  replayed: boolean;
  sequence: number;
  sessionId: string;
  status: HostedAgentK2SessionStatus;
  turnId: string;
}

export interface HostedAgentFastV2CancelResponse {
  terminalReason: 'explicit_cancel';
  turnId: string;
  turnStatus: 'cancelled';
}

export type HostedAgentProtocolSelection =
  | {
      availableExecutionProfiles: readonly HostedAgentFastV2ExecutionProfile[];
      protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
      reason: 'canary_selected';
    }
  | {
      availableExecutionProfiles: readonly ['fast'];
      protocolVersion: typeof HOSTED_AGENT_K2_PROTOCOL_VERSION;
      reason:
        | 'emergency_rollback'
        | 'feature_disabled'
        | 'invalid_configuration'
        | 'outside_canary';
    };

export interface HostedAgentFastV2FetchTransport {
  cancel(input: HostedAgentFastV2Binding & {
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2CancelResponse>;
  getProtocol(input?: {
    signal?: AbortSignal;
  }): Promise<HostedAgentProtocolSelection>;
  postOperationResult(input: HostedAgentFastV2Binding & {
    result: KernelOperationPlanResultV1;
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2OperationPostResponse>;
  postOperationSettlement(input: HostedAgentFastV2Binding & {
    receipt: KernelOperationSettlementReceiptV1;
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2OperationPostResponse>;
  replayEvents(input: HostedAgentFastV2Binding & {
    afterEventId: string | null;
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2EventReplay>;
  start(input: {
    request: HostedAgentFastV2StartRequest;
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2TurnAccepted>;
}

export class HostedAgentFastV2ReconnectableError extends HostedAgentK2ReconnectableError {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAgentFastV2ReconnectableError';
  }
}

export class HostedAgentFastV2UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAgentFastV2UnsupportedOperationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function validIdentifier(value: unknown, maximumLength = 200): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && IDENTIFIER_PATTERN.test(value);
}

function validBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= maximum;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function validStatus(value: unknown): value is HostedAgentK2SessionStatus {
  return ['active', 'cancelled', 'completed', 'failed', 'interrupted'].includes(String(value));
}

function validBinding(
  value: Record<string, unknown>,
  binding?: Pick<HostedAgentFastV2Binding, 'sessionId' | 'turnId'>,
): boolean {
  return validIdentifier(value.eventId, 40)
    && EVENT_ID_PATTERN.test(value.eventId)
    && value.protocolVersion === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    && validIdentifier(value.sessionId)
    && validIdentifier(value.turnId, 160)
    && (binding === undefined
      || (value.sessionId === binding.sessionId && value.turnId === binding.turnId));
}

function validOperationDescriptor(value: unknown): value is KernelOperationSessionDescriptorV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
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
  ])) return false;
  return value.schemaVersion === 1
    && value.authoritySource === 'same-origin-authenticated-kernel-proxy-v1'
    && value.contractDigest === PUBLIC_OPERATION_CONTRACT_DIGEST_V1
    && value.contractVersion === PUBLIC_OPERATION_CONTRACT_V1.contractVersion
    && value.planDigest === PUBLIC_COMPILED_PLAN_DIGEST_V1
    && value.planVersion === PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion
    && value.initialPlanSequence === 0
    && validIdentifier(value.capabilitySetId)
    && validIdentifier(value.clientInstanceId)
    && validIdentifier(value.sessionId)
    && validIdentifier(value.turnId, 160)
    && validNonNegativeInteger(value.issuedAtEpochMs)
    && validNonNegativeInteger(value.expiresAtEpochMs)
    && value.expiresAtEpochMs > value.issuedAtEpochMs
    && Array.isArray(value.allowedEffects)
    && value.allowedEffects.length <= PUBLIC_OPERATION_EFFECTS_V1.length
    && new Set(value.allowedEffects).size === value.allowedEffects.length
    && value.allowedEffects.every((effect) => PUBLIC_OPERATION_EFFECTS_V1.includes(effect))
    && Array.isArray(value.allowedOperationIds)
    && value.allowedOperationIds.length > 0
    && value.allowedOperationIds.length <= PUBLIC_COMPILED_PLAN_EXTENSION_V1.maximumSteps
    && new Set(value.allowedOperationIds).size === value.allowedOperationIds.length
    && value.allowedOperationIds.every((operationId) => (
      typeof operationId === 'string' && getPublicOperationSpecV1(operationId) !== undefined
    ));
}

function validOperationPlanRequest(value: unknown): value is KernelOperationPlanRequestV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
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
  ])) return false;
  if (
    value.schemaVersion !== 1
    || value.kind !== 'operation-plan-request'
    || !validIdentifier(value.capabilitySetId)
    || !validIdentifier(value.clientInstanceId)
    || !validIdentifier(value.sessionId)
    || !validIdentifier(value.turnId, 160)
    || !validNonNegativeInteger(value.expiresAtEpochMs)
    || !validNonNegativeInteger(value.sequence)
    || !['fast-immediate', 'verified-deferred'].includes(String(value.settlement))
    || (value.settlement === 'fast-immediate'
      ? value.simulatedStateFingerprint !== undefined
      : !validFingerprint(value.simulatedStateFingerprint))
  ) return false;
  try {
    validateCandidateTwoCompiledPlanV1(value.plan as KernelOperationPlanRequestV1['plan']);
  } catch {
    return false;
  }
  return true;
}

function validOperationSettlement(value: unknown): value is KernelOperationPlanSettlementV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
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
  ])) return false;
  const fingerprintsMatch = value.preparedStateFingerprint === value.simulatedStateFingerprint;
  return value.schemaVersion === 1
    && value.kind === 'operation-plan-settlement'
    && validIdentifier(value.batchId, 160)
    && validIdentifier(value.capabilitySetId)
    && validIdentifier(value.clientInstanceId)
    && validIdentifier(value.sessionId)
    && validIdentifier(value.turnId, 160)
    && validNonNegativeInteger(value.sequence)
    && validFingerprint(value.preparedStateFingerprint)
    && validFingerprint(value.simulatedStateFingerprint)
    && ['abort', 'commit'].includes(String(value.decision))
    && [
      'canceled',
      'private-verification-failed',
      'private-verification-passed',
      'simulated-real-fingerprint-mismatch',
    ].includes(String(value.reasonCode))
    && (value.decision === 'commit'
      ? value.reasonCode === 'private-verification-passed' && fingerprintsMatch
      : value.reasonCode !== 'private-verification-passed')
    && (value.reasonCode === 'simulated-real-fingerprint-mismatch'
      ? !fingerprintsMatch
      : true);
}

function parseFastV2Event(
  value: unknown,
  binding?: Pick<HostedAgentFastV2Binding, 'sessionId' | 'turnId'>,
): HostedAgentFastV2Event {
  if (!isRecord(value) || typeof value.kind !== 'string' || !validBinding(value, binding)) {
    throw new Error('The Fast V2 event is malformed or is not bound to this turn.');
  }
  let valid = false;
  switch (value.kind) {
    case 'session-ready':
      valid = hasExactKeys(value, [
        'budgetPolicyVersion',
        'capabilityBundleVersion',
        'eventId',
        'kind',
        'maximumIterations',
        'maximumSpendCredits',
        'modelPolicyVersion',
        'promptVersion',
        'protocolVersion',
        'sessionId',
        'snapshotStateFingerprint',
        'snapshotTimelineRevision',
        'turnId',
      ])
        && value.budgetPolicyVersion === HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION
        && value.capabilityBundleVersion === HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION
        && value.modelPolicyVersion === HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION
        && value.promptVersion === HOSTED_AGENT_FAST_V2_PROMPT_VERSION
        && validPositiveInteger(value.maximumIterations, HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS)
        && validPositiveInteger(value.maximumSpendCredits, HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS)
        && validFingerprint(value.snapshotStateFingerprint)
        && validNonNegativeInteger(value.snapshotTimelineRevision);
      break;
    case 'narration-delta':
    case 'narration-complete':
      valid = hasExactKeys(value, [
        'eventId', 'kind', 'phase', 'protocolVersion', 'roundIndex', 'sessionId', 'text', 'turnId',
      ])
        && ['inspecting', 'planning', 'acting', 'verifying'].includes(String(value.phase))
        && validNonNegativeInteger(value.roundIndex)
        && validBoundedString(value.text, 200_000);
      break;
    case 'operation-session-ready':
      valid = hasExactKeys(value, [
        'descriptor', 'eventId', 'kind', 'protocolVersion', 'sessionId', 'turnId',
      ])
        && validOperationDescriptor(value.descriptor)
        && value.descriptor.sessionId === value.sessionId
        && value.descriptor.turnId === value.turnId;
      break;
    case 'operation-plan-request':
      valid = hasExactKeys(value, [
        'eventId', 'kind', 'protocolVersion', 'request', 'sessionId', 'turnId',
      ])
        && validOperationPlanRequest(value.request)
        && value.request.sessionId === value.sessionId
        && value.request.turnId === value.turnId;
      break;
    case 'operation-plan-settlement':
      valid = hasExactKeys(value, [
        'eventId', 'kind', 'protocolVersion', 'sessionId', 'settlement', 'turnId',
      ])
        && validOperationSettlement(value.settlement)
        && value.settlement.sessionId === value.sessionId
        && value.settlement.turnId === value.turnId;
      break;
    case 'billing-settled':
      valid = hasExactKeys(value, [
        'creditBalance',
        'creditsCharged',
        'eventId',
        'kind',
        'ledgerEntryId',
        'protocolVersion',
        'roundIndex',
        'sessionId',
        'totalCreditsCharged',
        'turnId',
      ])
        && typeof value.creditBalance === 'number'
        && Number.isFinite(value.creditBalance)
        && value.creditBalance >= 0
        && typeof value.creditsCharged === 'number'
        && Number.isFinite(value.creditsCharged)
        && value.creditsCharged >= 0
        && (value.ledgerEntryId === null
          || (validIdentifier(value.ledgerEntryId) && value.ledgerEntryId.length <= 200))
        && validNonNegativeInteger(value.roundIndex)
        && typeof value.totalCreditsCharged === 'number'
        && Number.isFinite(value.totalCreditsCharged)
        && value.totalCreditsCharged >= value.creditsCharged;
      break;
    case 'turn-complete':
      valid = hasExactKeys(value, [
        'creditsCharged', 'eventId', 'kind', 'message', 'protocolVersion', 'rounds', 'sessionId', 'turnId',
      ])
        && typeof value.creditsCharged === 'number'
        && Number.isFinite(value.creditsCharged)
        && value.creditsCharged >= 0
        && validBoundedString(value.message, 200_000)
        && validNonNegativeInteger(value.rounds);
      break;
    case 'turn-canceled':
    case 'turn-failed':
    case 'turn-interrupted':
      valid = hasExactKeys(value, [
        'eventId', 'kind', 'message', 'protocolVersion', 'recoverable', 'sessionId', 'turnId',
      ])
        && validBoundedString(value.message, 200_000)
        && typeof value.recoverable === 'boolean';
      break;
    default:
      valid = false;
  }
  if (!valid) {
    throw new Error('The Fast V2 event has an invalid or unexpected payload.');
  }
  return value as unknown as HostedAgentFastV2Event;
}

export function parseHostedAgentFastV2Sse(
  text: string,
  binding?: Pick<HostedAgentFastV2Binding, 'sessionId' | 'turnId'>,
): HostedAgentFastV2Event[] {
  const events: HostedAgentFastV2Event[] = [];
  let previousEventId = 0;
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    if (!block.trim()) continue;
    let eventName: string | undefined;
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('id:') && id === undefined) {
        id = line.slice(3).trim();
      } else if (line.startsWith('event:') && eventName === undefined) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      } else {
        throw new Error('The Fast V2 event stream contains an unexpected SSE field.');
      }
    }
    if (!id || !eventName || data.length === 0 || !EVENT_ID_PATTERN.test(id)) {
      throw new Error('The Fast V2 event stream contains an incomplete SSE envelope.');
    }
    const numericEventId = Number(id);
    if (!Number.isSafeInteger(numericEventId) || numericEventId <= previousEventId) {
      throw new Error('The Fast V2 event stream is out of order.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join('\n')) as unknown;
    } catch {
      throw new Error('The Fast V2 event stream contains invalid JSON.');
    }
    const event = parseFastV2Event(parsed, binding);
    if (event.eventId !== id || event.kind !== eventName) {
      throw new Error('The Fast V2 SSE envelope does not match its event payload.');
    }
    previousEventId = numericEventId;
    events.push(event);
  }
  return events;
}

function terminalStatus(events: HostedAgentFastV2Event[]): HostedAgentK2SessionStatus {
  const terminal = events.findLast((event) => (
    event.kind === 'turn-complete'
    || event.kind === 'turn-failed'
    || event.kind === 'turn-canceled'
    || event.kind === 'turn-interrupted'
  ));
  if (!terminal) return 'active';
  if (terminal.kind === 'turn-complete') return 'completed';
  if (terminal.kind === 'turn-canceled') return 'cancelled';
  if (terminal.kind === 'turn-interrupted') return 'interrupted';
  return 'failed';
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

async function fastV2Fetch(
  request: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await request(input, init);
  } catch (error) {
    if (isAbortFailure(error, init.signal ?? undefined)) throw error;
    if (error instanceof HostedAgentFastV2ReconnectableError) throw error;
    throw new HostedAgentFastV2ReconnectableError(
      'The Fast V2 hosted-agent connection is temporarily unavailable.',
    );
  }
}

async function safeResponseErrorCode(response: Response): Promise<string | undefined> {
  if (!JSON_CONTENT_TYPE_PATTERN.test(response.headers.get('Content-Type') ?? '')) return undefined;
  try {
    const value = await response.json() as unknown;
    if (
      isRecord(value)
      && typeof value.error === 'string'
      && /^[a-z][a-z0-9_]{0,63}$/.test(value.error)
    ) return value.error;
  } catch {
    // Unknown or malformed error bodies remain generic and fail closed.
  }
  return undefined;
}

async function responseError(response: Response): Promise<Error> {
  if ([502, 503, 504].includes(response.status)) {
    return new HostedAgentFastV2ReconnectableError(
      `The Fast V2 hosted-agent connection is temporarily unavailable (${response.status}).`,
    );
  }
  const code = await safeResponseErrorCode(response);
  const detail = code === undefined ? String(response.status) : `${response.status}: ${code}`;
  return new Error(`The Fast V2 hosted-agent request failed safely (${detail}).`);
}

async function startResponseError(response: Response): Promise<Error> {
  if (
    response.status === 409
    && JSON_CONTENT_TYPE_PATTERN.test(response.headers.get('Content-Type') ?? '')
  ) {
    try {
      const value = await response.clone().json() as unknown;
      if (
        isRecord(value)
        && hasExactKeys(value, ['error', 'message'])
        && value.error === 'verified_profile_not_enabled'
        && typeof value.message === 'string'
      ) {
        return new Error(
          'The Verified profile is not available for this account. Choose Fast and try again.',
        );
      }
    } catch {
      // Unknown or malformed error bodies remain generic and fail closed.
    }
  }
  return responseError(response);
}

async function readStrictJson(response: Response): Promise<unknown> {
  if (!JSON_CONTENT_TYPE_PATTERN.test(response.headers.get('Content-Type') ?? '')) {
    throw new Error('The Fast V2 hosted-agent response is not JSON.');
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error('The Fast V2 hosted-agent response contains invalid JSON.');
  }
}

function parseTurnAccepted(
  value: unknown,
  request: HostedAgentFastV2StartRequest,
  expectedEventsPath: string,
): HostedAgentFastV2TurnAccepted {
  if (!isRecord(value) || !hasExactKeys(value, [
    'acceptedExecutionContractDigest',
    'acceptedExecutionContractVersion',
    'eventsPath',
    'maximumIterations',
    'maximumSpendCredits',
    'pageLease',
    'protocolVersion',
    'replayed',
    'route',
    'sessionId',
    'turnId',
  ]) || !isRecord(value.pageLease) || !hasExactKeys(value.pageLease, [
    'expiresAt', 'leaseToken', 'sessionId',
  ])) {
    throw new Error('The Fast V2 start response has an unexpected shape.');
  }
  if (
    value.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || value.route !== 'fast-agent-v2'
    || value.acceptedExecutionContractDigest !== request.executionContractDigest
    || value.acceptedExecutionContractVersion !== request.executionContractVersion
    || value.turnId !== request.turnId
    || value.eventsPath !== expectedEventsPath
    || typeof value.replayed !== 'boolean'
    || !validIdentifier(value.sessionId)
    || !validPositiveInteger(value.maximumIterations, HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS)
    || !validPositiveInteger(value.maximumSpendCredits, HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS)
    || value.pageLease.sessionId !== value.sessionId
    || !validBoundedString(value.pageLease.expiresAt, 80)
    || !Number.isFinite(Date.parse(value.pageLease.expiresAt))
    || !validBoundedString(value.pageLease.leaseToken, 2_000)
    || value.pageLease.leaseToken.length === 0
  ) {
    throw new Error('The Fast V2 start response is not bound to the requested turn.');
  }
  return value as unknown as HostedAgentFastV2TurnAccepted;
}

function parseProtocolSelection(value: unknown): HostedAgentProtocolSelection {
  if (!isRecord(value) || !hasExactKeys(value, [
    'availableExecutionProfiles',
    'protocolVersion',
    'reason',
  ])) {
    throw new Error('The hosted-agent protocol selection has an unexpected shape.');
  }
  const profiles = value.availableExecutionProfiles;
  if (!Array.isArray(profiles)) {
    throw new Error('The hosted-agent protocol selection is invalid or contradictory.');
  }
  const fastOnly = profiles.length === 1 && profiles[0] === 'fast';
  const fastAndVerified = profiles.length === 2
    && profiles[0] === 'fast'
    && profiles[1] === 'verified';
  if (
    (value.protocolVersion === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
      && value.reason === 'canary_selected'
      && (fastOnly || fastAndVerified))
    || (
      value.protocolVersion === HOSTED_AGENT_K2_PROTOCOL_VERSION
      && [
        'emergency_rollback',
        'feature_disabled',
        'invalid_configuration',
        'outside_canary',
      ].includes(String(value.reason))
      && fastOnly
    )
  ) {
    return value as unknown as HostedAgentProtocolSelection;
  }
  throw new Error('The hosted-agent protocol selection is invalid or contradictory.');
}

function validProjectedOperationResult(value: unknown, operationId: string): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['data', 'error', 'success'])
    || typeof value.success !== 'boolean') return false;
  if (!value.success) {
    return value.data === undefined
      && typeof value.error === 'string'
      && value.error.length > 0
      && value.error.length <= 1_000;
  }
  if (value.error !== undefined) return false;
  if (
    operationId === 'timeline.editor.destructive.v1'
    || operationId === 'timeline.editor.inspect.v1'
    || operationId === 'timeline.editor.mutate.v1'
    || operationId === 'timeline.editor.program.commit.v1'
  ) {
    if (value.data === undefined) return true;
    try {
      const serialized = JSON.stringify(value.data);
      return typeof serialized === 'string'
        && serialized.length <= 500_000
        && !/(?:^|["'])data:/i.test(serialized);
    } catch {
      return false;
    }
  }
  if (
    operationId === 'timeline.editor.catalog.v1'
    || operationId === 'timeline.hook.commit.v1'
    || operationId === 'timeline.hook.preview.v1'
    || operationId === 'timeline.hook.refine.commit.v1'
    || operationId === 'timeline.intercut.commit.v1'
    || operationId === 'timeline.intercut.preview.v1'
    || operationId === 'timeline.segment.delete-many.v1'
    || operationId === 'timeline.editor.program.preview.v1'
  ) return value.data === undefined;
  if (!isRecord(value.data)) return false;
  if (operationId === 'timeline.segment.split.v1') {
    if (!hasExactKeys(value.data, ['segments']) || !isRecord(value.data.segments)) return false;
    const ids = value.data.segments.videoClipIds;
    return hasExactKeys(value.data.segments, ['videoClipIds'])
      && Array.isArray(ids)
      && ids.length >= 2
      && ids.length <= 201
      && new Set(ids).size === ids.length
      && ids.every((id) => validBoundedString(id, 500) && id.length > 0);
  }
  const frameTimes = value.data.frameTimes;
  const imageDataUrl = value.data.imageDataUrl;
  return operationId === 'timeline.visual.capture-grid.v1'
    && hasExactKeys(value.data, ['frameTimes', 'imageDataUrl'])
    && Array.isArray(frameTimes)
    && frameTimes.length > 0
    && frameTimes.length <= 8
    && new Set(frameTimes).size === frameTimes.length
    && frameTimes.every((time) => typeof time === 'number' && Number.isFinite(time))
    && typeof imageDataUrl === 'string'
    && imageDataUrl.length <= 8_000_000
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl);
}

function validOperationResult(
  result: unknown,
  binding: HostedAgentFastV2Binding,
): result is KernelOperationPlanResultV1 {
  if (!isRecord(result) || !hasOnlyKeys(result, [
    'batchId',
    'capabilitySetId',
    'clientInstanceId',
    'errorCode',
    'kind',
    'preparedStateFingerprint',
    'result',
    'schemaVersion',
    'sequence',
    'sessionId',
    'stateRevisionAfter',
    'stateRevisionBefore',
    'status',
    'turnId',
  ]) || !isRecord(result.result) || !hasExactKeys(result.result, [
    'batchId', 'results', 'success',
  ])) return false;
  const items = result.result.results;
  const validItems = Array.isArray(items)
    && items.length <= 32
    && items.every((item) => (
      isRecord(item)
      && hasExactKeys(item, ['operationId', 'result', 'sequence'])
      && typeof item.operationId === 'string'
      && getPublicOperationSpecV1(item.operationId) !== undefined
      && validPositiveInteger(item.sequence, 32)
      && validProjectedOperationResult(item.result, item.operationId)
    ));
  return result.schemaVersion === 1
    && result.kind === 'operation-plan-result'
    && validIdentifier(result.batchId, 160)
    && validIdentifier(result.capabilitySetId)
    && result.clientInstanceId === binding.clientInstanceId
    && result.sessionId === binding.sessionId
    && result.turnId === binding.turnId
    && validNonNegativeInteger(result.sequence)
    && validNonNegativeInteger(result.stateRevisionBefore)
    && validNonNegativeInteger(result.stateRevisionAfter)
    && ['committed', 'failed', 'prepared'].includes(String(result.status))
    && (result.errorCode === undefined || [
      'confirmation-denied',
      'execution-rejected',
      'fingerprint-unavailable',
      'transaction-ownership-lost',
    ].includes(String(result.errorCode)))
    && result.result.batchId === result.batchId
    && typeof result.result.success === 'boolean'
    && validItems
    && ((result.status === 'failed') !== (result.result.success === true))
    && (result.errorCode === undefined || items.length === 0)
    && ((result.status === 'prepared') === validFingerprint(result.preparedStateFingerprint));
}

function validOperationSettlementReceipt(
  receipt: unknown,
  binding: HostedAgentFastV2Binding,
): receipt is KernelOperationSettlementReceiptV1 {
  if (!isRecord(receipt) || !hasOnlyKeys(receipt, [
    'batchId',
    'capabilitySetId',
    'clientInstanceId',
    'committedStateFingerprint',
    'kind',
    'outcome',
    'preparedStateFingerprint',
    'schemaVersion',
    'sequence',
    'sessionId',
    'simulatedStateFingerprint',
    'stateRevisionAfterSettlement',
    'turnId',
  ])) return false;
  return receipt.schemaVersion === 1
    && receipt.kind === 'operation-plan-settlement-receipt'
    && validIdentifier(receipt.batchId, 160)
    && validIdentifier(receipt.capabilitySetId)
    && receipt.clientInstanceId === binding.clientInstanceId
    && receipt.sessionId === binding.sessionId
    && receipt.turnId === binding.turnId
    && validNonNegativeInteger(receipt.sequence)
    && validNonNegativeInteger(receipt.stateRevisionAfterSettlement)
    && validFingerprint(receipt.preparedStateFingerprint)
    && validFingerprint(receipt.simulatedStateFingerprint)
    && ['aborted', 'committed', 'ownership-lost'].includes(String(receipt.outcome))
    && (receipt.outcome === 'committed'
      ? validFingerprint(receipt.committedStateFingerprint)
        && receipt.committedStateFingerprint === receipt.preparedStateFingerprint
        && receipt.committedStateFingerprint === receipt.simulatedStateFingerprint
      : receipt.committedStateFingerprint === undefined);
}

function boundHeaders(binding: HostedAgentFastV2Binding): Headers {
  return new Headers({
    [HOSTED_AGENT_HEADERS.clientInstanceId]: binding.clientInstanceId,
    [HOSTED_AGENT_HEADERS.pageLease]: binding.leaseToken,
    [HOSTED_AGENT_HEADERS.protocolVersion]: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    [HOSTED_AGENT_HEADERS.sessionId]: binding.sessionId,
  });
}

function parseOperationPostResponse(
  value: unknown,
  binding: HostedAgentFastV2Binding,
  sequence: number,
): HostedAgentFastV2OperationPostResponse {
  if (!isRecord(value) || !hasExactKeys(value, [
    'accepted', 'cursor', 'replayed', 'sequence', 'sessionId', 'status', 'turnId',
  ])
    || value.accepted !== true
    || typeof value.replayed !== 'boolean'
    || value.sequence !== sequence
    || value.sessionId !== binding.sessionId
    || value.turnId !== binding.turnId
    || typeof value.cursor !== 'string'
    || !/^\d+$/.test(value.cursor)
    || !validStatus(value.status)) {
    throw new Error('The Fast V2 operation response is malformed or unbound.');
  }
  return value as unknown as HostedAgentFastV2OperationPostResponse;
}

export function createHostedAgentFastV2FetchTransport(input: {
  apiBasePath?: string;
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
} = {}): HostedAgentFastV2FetchTransport {
  const apiBasePath = (input.apiBasePath ?? '/api/kernel').replace(/\/+$/, '');
  const request = input.fetchImplementation ?? fetch;
  const turnsPath = `${apiBasePath}/hosted-agent/v2/turns`;
  const turnPath = (turnId: string) => `${turnsPath}/${encodeURIComponent(turnId)}`;

  async function postOperation(inputValue: HostedAgentFastV2Binding & {
    result: KernelOperationPlanResultV1;
    signal?: AbortSignal;
  }): Promise<HostedAgentFastV2OperationPostResponse> {
    const { signal, ...binding } = inputValue;
    const sequence = inputValue.result.sequence;
    if (!validOperationResult(inputValue.result, binding)) {
      throw new Error('The Fast V2 operation payload is malformed or unbound.');
    }
    const headers = boundHeaders(binding);
    headers.set('Content-Type', 'application/json');
    const response = await fastV2Fetch(request, `${turnPath(binding.turnId)}/operation-results`, {
      body: JSON.stringify({ result: inputValue.result }),
      headers,
      method: 'POST',
      signal: signal ?? input.signal,
    });
    if (!response.ok) throw await responseError(response);
    return parseOperationPostResponse(await readStrictJson(response), binding, sequence);
  }

  return {
    async cancel({ signal, ...binding }) {
      const response = await fastV2Fetch(request, `${turnPath(binding.turnId)}/cancel`, {
        headers: boundHeaders(binding),
        method: 'POST',
        signal: signal ?? input.signal,
      });
      if (!response.ok) throw await responseError(response);
      const parsed = await readStrictJson(response);
      if (!isRecord(parsed)
        || !hasExactKeys(parsed, ['terminalReason', 'turnId', 'turnStatus'])
        || parsed.terminalReason !== 'explicit_cancel'
        || parsed.turnStatus !== 'cancelled'
        || parsed.turnId !== binding.turnId) {
        throw new Error('The Fast V2 cancel response is malformed or unbound.');
      }
      return parsed as unknown as HostedAgentFastV2CancelResponse;
    },
    async getProtocol({ signal } = {}) {
      const response = await fastV2Fetch(request, `${apiBasePath}/hosted-agent/protocol`, {
        headers: { Accept: 'application/json' },
        method: 'GET',
        signal: signal ?? input.signal,
      });
      if (!response.ok) throw await responseError(response);
      return parseProtocolSelection(await readStrictJson(response));
    },
    async postOperationResult(inputValue) {
      return postOperation(inputValue);
    },
    async postOperationSettlement({ receipt, signal, ...binding }) {
      if (!validOperationSettlementReceipt(receipt, binding)) {
        throw new Error('The Fast V2 settlement payload is malformed or unbound.');
      }
      const headers = boundHeaders(binding);
      headers.set('Content-Type', 'application/json');
      const response = await fastV2Fetch(
        request,
        `${turnPath(binding.turnId)}/operation-settlements`,
        {
          body: JSON.stringify({ receipt }),
          headers,
          method: 'POST',
          signal: signal ?? input.signal,
        },
      );
      if (!response.ok) throw await responseError(response);
      return parseOperationPostResponse(await readStrictJson(response), binding, receipt.sequence);
    },
    async replayEvents({ afterEventId, signal, ...binding }) {
      if (afterEventId !== null && !/^\d+$/.test(afterEventId)) {
        throw new Error('The Fast V2 event cursor is invalid.');
      }
      const headers = boundHeaders(binding);
      headers.set('Accept', 'text/event-stream');
      if (afterEventId !== null) headers.set(HOSTED_AGENT_HEADERS.lastEventId, afterEventId);
      const response = await fastV2Fetch(request, `${turnPath(binding.turnId)}/events`, {
        headers,
        method: 'GET',
        signal: signal ?? input.signal,
      });
      if (!response.ok) throw await responseError(response);
      if (!(response.headers.get('Content-Type') ?? '').toLowerCase().includes('text/event-stream')) {
        throw new Error('The Fast V2 hosted-agent event response is not an SSE stream.');
      }
      const events = parseHostedAgentFastV2Sse(await response.text(), binding);
      const responseCursor = response.headers.get(HOSTED_AGENT_HEADERS.eventCursor);
      if (responseCursor !== null && !/^\d+$/.test(responseCursor)) {
        throw new Error('The Fast V2 event response contains an invalid cursor.');
      }
      const cursor = responseCursor ?? events.at(-1)?.eventId ?? afterEventId;
      const leaseMs = Number(response.headers.get(HOSTED_AGENT_HEADERS.streamLeaseMs));
      return {
        cursor,
        events,
        leaseExpiresAt: new Date(
          Date.now() + (Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : 55_000),
        ).toISOString(),
        sessionId: binding.sessionId,
        status: terminalStatus(events),
        turnId: binding.turnId,
      };
    },
    async start({ request: startRequest, signal }) {
      const parsedRequest = parseHostedAgentFastV2StartRequest(startRequest);
      const response = await fastV2Fetch(request, turnsPath, {
        body: JSON.stringify(parsedRequest),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: signal ?? input.signal,
      });
      if (!response.ok) throw await startResponseError(response);
      return parseTurnAccepted(
        await readStrictJson(response),
        parsedRequest,
        `${turnPath(parsedRequest.turnId)}/events`,
      );
    },
  };
}
