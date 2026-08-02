import { json, methodNotAllowed } from '../db';
import type { AppContext, Env } from '../env';
import {
  HOSTED_CHAT_DEVELOPMENT_MAX_TURN_SPEND_CREDITS,
  HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
} from '../chatBilling';
import { getKieChatModelCapability } from '../providers/kieChat';
import {
  buildHostedAgentAssertionClaims,
  buildHostedAgentFastV2AssertionClaims,
  buildHostedAgentFastV2AssertionClaimsFromBinding,
  HostedAgentAssertionError,
  signHostedAgentServiceAssertion,
  verifyHostedAgentFastV2ServiceAssertion,
  verifyHostedAgentServiceAssertion,
} from './assertion';
import {
  assertHostedAgentClaimsMatchD1,
  authorizeHostedAgentK0Round,
  bindHostedAgentFastV2Turn,
  cancelHostedAgentK0Turn,
  completeHostedAgentK0Turn,
  createHostedAgentK0Turn,
  createHostedAgentTurnFromServerPolicy,
  failHostedAgentTurn,
  getHostedAgentFastV2Binding,
  getHostedAgentK0Turn,
  getHostedAgentK0TurnForService,
  HostedAgentK0BillingError,
  resolveHostedAgentFastV2BillingClaims,
  settleHostedAgentK0Round,
  type HostedAgentK0TurnRow,
  type HostedAgentFastV2BindingRow,
  type HostedAgentServiceBillingClaims,
} from './billing';
import {
  forwardHostedAgentRequest,
  HostedAgentProxyError,
} from './proxy';
import {
  HOSTED_AGENT_HEADERS,
  HOSTED_AGENT_PROTOCOL_VERSION,
  hostedAgentRoundIdempotencyKey,
  type HostedAgentRoundAuthorizationRequest,
  type HostedAgentRoundSettlementRequest,
  type HostedAgentK1ToolBatchResult,
  type HostedAgentK1TurnRequest,
} from '../../../src/services/kernelClient/hostedAgent/contracts';
import {
  HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS,
  HOSTED_AGENT_FAST_V2_MAX_START_BYTES,
  HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS,
  HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  HOSTED_AGENT_FAST_V2_SERVICE_ENVELOPE_VERSION,
  HostedAgentFastV2ContractError,
  digestHostedAgentFastV2BrowserRequest,
  hostedAgentFastV2RoundIdempotencyKey,
  parseHostedAgentFastV2StartRequest,
  type HostedAgentFastV2EdgePins,
  type HostedAgentFastV2AssertionClaims,
  type HostedAgentFastV2StartRequest,
} from '../../../src/services/kernelClient/hostedAgent/fastV2StartContract';
import { validHostedAgentInlineProviderContent } from '../../../src/services/kernelClient/hostedAgent/inlineProviderContent';
import type {
  KernelOperationPlanResultV1,
  KernelOperationSettlementReceiptV1,
} from '../../../src/services/kernelClient/wp1Spike/operationRoundTrip';

const MAX_START_BODY_BYTES = 1_500_000;
// Transport abuse guard only, not a product-level inline-result budget. K0 must
// measure real payloads before K1 freezes a semantic limit.
const MAX_TOOL_RESULT_BODY_BYTES = 32 * 1024 * 1024;
const MAX_SERVICE_BODY_BYTES = 32_000;
const MAX_TURN_ID_CHARACTERS = 160;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9._:-]+$/;
const EVENT_CURSOR_PATTERN = /^[A-Za-z0-9._:-]+$/;
const FAST_V2_EDGE_BILLING_MODEL = {
  'very-fast': 'masterselects-fast-v2-very-fast',
  fast: 'masterselects-fast-v2-fast',
  slow: 'masterselects-fast-v2-slow',
} as const;
const FAST_V2_EDGE_PROVIDER_PROTOCOL = 'openai-responses' as const;
const FAST_V2_HISTORY_FORMAT_VERSION = 'fast-v2-history-2026-08-01';

interface HostedAgentRouteEnv extends Env {
  HOSTED_AGENT_FAST_V2_CANARY_PERCENT?: string;
  HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK?: string;
  HOSTED_AGENT_FAST_V2_ENABLED?: string;
  HOSTED_AGENT_VERIFIED_PILOT_ENABLED?: string;
  KERNEL_SERVICE_ASSERTION_SECRET?: string;
}

export type HostedAgentFastV2ProtocolSelectionReason =
  | 'canary_selected'
  | 'emergency_rollback'
  | 'feature_disabled'
  | 'invalid_configuration'
  | 'outside_canary';

export type HostedAgentFastV2ProtocolSelection =
  | {
      availableExecutionProfiles:
        | readonly ['fast']
        | readonly ['fast', 'verified'];
      protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
      reason: 'canary_selected';
    }
  | {
      availableExecutionProfiles: readonly ['fast'];
      protocolVersion: typeof HOSTED_AGENT_PROTOCOL_VERSION;
      reason: Exclude<HostedAgentFastV2ProtocolSelectionReason, 'canary_selected'>;
    };

function stableCanaryBucket(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

/**
 * Server-owned Fast V2 rollout decision. Browser input cannot enable V2,
 * enlarge its cohort, or suppress the emergency rollback flag.
 */
export function selectHostedAgentProtocol(
  env: Env,
  cohortKey: string,
): HostedAgentFastV2ProtocolSelection {
  const hostedEnv = env as HostedAgentRouteEnv;
  const fastOnlyProfiles = ['fast'] as const;
  if (hostedEnv.HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK !== 'false') {
    return {
      availableExecutionProfiles: fastOnlyProfiles,
      protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
      reason: 'emergency_rollback',
    };
  }
  if (hostedEnv.HOSTED_AGENT_FAST_V2_ENABLED !== 'true') {
    return {
      availableExecutionProfiles: fastOnlyProfiles,
      protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
      reason: 'feature_disabled',
    };
  }
  const canaryPercent = Number(hostedEnv.HOSTED_AGENT_FAST_V2_CANARY_PERCENT ?? '0');
  if (!Number.isInteger(canaryPercent) || canaryPercent < 0 || canaryPercent > 100) {
    return {
      availableExecutionProfiles: fastOnlyProfiles,
      protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
      reason: 'invalid_configuration',
    };
  }
  if (stableCanaryBucket(cohortKey) >= canaryPercent) {
    return {
      availableExecutionProfiles: fastOnlyProfiles,
      protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
      reason: 'outside_canary',
    };
  }
  return {
    availableExecutionProfiles: hostedEnv.HOSTED_AGENT_VERIFIED_PILOT_ENABLED === 'true'
      ? ['fast', 'verified']
      : fastOnlyProfiles,
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    reason: 'canary_selected',
  };
}

class HostedAgentRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.name = 'HostedAgentRouteError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validIdentifier(value: unknown, maximumLength = 200): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && IDENTIFIER_PATTERN.test(value);
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 120
    && VERSION_PATTERN.test(value);
}

function validString(value: unknown, maximumLength: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.trim().length > 0);
}

function validOptionalInteger(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function providerToolName(tool: unknown): string | null {
  if (!isRecord(tool)) return null;
  if (typeof tool.name === 'string') return tool.name;
  return isRecord(tool.function) && typeof tool.function.name === 'string'
    ? tool.function.name
    : null;
}

function validProviderInput(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length > 128) {
    return false;
  }
  if (value.protocol === 'openai-responses') {
    return value.store === false && Array.isArray(value.input) && value.input.length > 0;
  }
  return value.protocol === 'claude-messages'
    && Array.isArray(value.messages)
    && value.messages.length > 0;
}

export function maximumHostedAgentTurnSpendCredits(environment?: string): number {
  return environment === 'development'
    ? HOSTED_CHAT_DEVELOPMENT_MAX_TURN_SPEND_CREDITS
    : HOSTED_CHAT_MAX_TURN_SPEND_CREDITS;
}

function parseTurnRequest(
  value: unknown,
  maximumTurnSpendCredits: number,
): HostedAgentK1TurnRequest {
  if (!isRecord(value) || !isRecord(value.clientCapabilities)) {
    throw new HostedAgentRouteError('invalid_request', 'A hosted-agent turn request is required.');
  }
  const capabilities = value.clientCapabilities;
  const reasoningEfforts = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
  const runSources = new Set(['ui', 'bridge', 'mcp']);
  const toolNames = capabilities.toolNames;
  if (
    !validIdentifier(value.turnId, MAX_TURN_ID_CHARACTERS)
    || !validIdentifier(value.clientInstanceId)
    || !validString(value.request, 100_000)
    || !validString(value.model, 120)
    || (value.reasoningEffort !== undefined && !reasoningEfforts.has(String(value.reasoningEffort)))
    || (
      value.temperature !== undefined
      && (
        typeof value.temperature !== 'number'
        || !Number.isFinite(value.temperature)
        || value.temperature < 0
        || value.temperature > 2
      )
    )
    || !validVersion(value.promptVersion)
    || !validVersion(value.historyFormatVersion)
    || !validVersion(value.toolSchemaVersion)
    || !['normal', 'plan', 'read-only'].includes(String(value.toolExecutionMode))
    || !runSources.has(String(value.runSource))
    || typeof value.maxTurnSpendCredits !== 'number'
    || !Number.isInteger(value.maxTurnSpendCredits)
    || value.maxTurnSpendCredits <= 0
    || value.maxTurnSpendCredits > maximumTurnSpendCredits
    || !validString(value.modelPrompt, 400_000)
    || !validString(value.systemPrompt, 200_000)
    || !validString(value.playbookPrompt, 100_000)
    || (
      value.contextSummary !== undefined
      && !validString(value.contextSummary, 400_000, true)
    )
    || typeof capabilities.supportsNarrationDeltas !== 'boolean'
    || typeof capabilities.supportsImageResultRefs !== 'boolean'
    || typeof capabilities.maximumInlineResultCharacters !== 'number'
    || !Number.isInteger(capabilities.maximumInlineResultCharacters)
    || capabilities.maximumInlineResultCharacters <= 0
    || capabilities.maximumInlineResultCharacters > MAX_TOOL_RESULT_BODY_BYTES
    || !Array.isArray(toolNames)
    || toolNames.length > 256
    || toolNames.some((name) => !validIdentifier(name, 160))
    || typeof value.maximumOutputTokens !== 'number'
    || !Number.isInteger(value.maximumOutputTokens)
    || value.maximumOutputTokens <= 0
    || value.maximumOutputTokens > 32_000
    || !validProviderInput(value.providerInput)
    || !isRecord(value.providerInput)
    || !Array.isArray(value.providerInput.tools)
    || value.providerInput.tools.some((tool) => {
      const name = providerToolName(tool);
      return name === null || !toolNames.includes(name);
    })
    || value.providerInput.tools.length !== toolNames.length
    || !Array.isArray(value.visualReferences)
    || value.visualReferences.length > 32
    || (value.routePreference !== undefined
      && !['auto', 'fast-agent', 'story'].includes(String(value.routePreference)))
  ) {
    throw new HostedAgentRouteError('invalid_request', 'The hosted-agent turn request is invalid.');
  }
  return value as unknown as HostedAgentK1TurnRequest;
}

function containsDataUrl(value: unknown): boolean {
  if (typeof value === 'string') return /^\s*data:/i.test(value);
  if (Array.isArray(value)) return value.some(containsDataUrl);
  return isRecord(value) && Object.values(value).some(containsDataUrl);
}

function containsUnexpectedToolResultDataUrl(value: Record<string, unknown>): boolean {
  const results = Array.isArray(value.results)
    ? value.results.map((result) => {
        if (!isRecord(result)) return result;
        const { providerContent: _providerContent, ...rest } = result;
        return rest;
      })
    : value.results;
  return containsDataUrl({ ...value, results });
}

function parseToolResult(value: unknown, turn: HostedAgentK0TurnRow): HostedAgentK1ToolBatchResult {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new HostedAgentRouteError('invalid_tool_result', 'A tool-result batch is required.');
  }
  const resultsAreValid = value.results.length > 0
    && value.results.length <= 128
    && value.results.every((result) => {
      if (!isRecord(result)) {
        return false;
      }
      return validIdentifier(result.toolCallId)
        && typeof result.success === 'boolean'
        && validString(result.modelContent, MAX_TOOL_RESULT_BODY_BYTES, true)
        && (result.error === undefined || validString(result.error, 20_000, true))
        && (
          result.providerContent === undefined
          || validHostedAgentInlineProviderContent(result.providerContent, turn.provider_protocol)
        )
        && (
          result.imageResultRefs === undefined
          || (
            Array.isArray(result.imageResultRefs)
            && result.imageResultRefs.length <= 16
            && result.imageResultRefs.every((reference) => (
              validString(reference, 2_000)
              && !reference.toLowerCase().startsWith('data:')
            ))
          )
        );
    });
  if (
    value.sessionId !== turn.session_id
    || value.turnId !== turn.turn_id
    || value.clientInstanceId !== turn.client_instance_id
    || typeof value.sequence !== 'number'
    || !Number.isInteger(value.sequence)
    || value.sequence < 0
    || value.toolSchemaVersion !== turn.tool_schema_version
    || !isRecord(value.authority)
    || value.authority.policyChecked !== true
    || value.authority.validationPassed !== true
    || value.authority.executionMode !== turn.tool_execution_mode
    || !['approved', 'denied', 'not-required'].includes(String(value.authority.approval))
    || typeof value.authority.stateRevisionBefore !== 'string'
    || typeof value.authority.stateRevisionAfter !== 'string'
    || !resultsAreValid
    || containsUnexpectedToolResultDataUrl(value)
  ) {
    throw new HostedAgentRouteError(
      'invalid_tool_result',
      'The tool-result batch does not match the D1-bound hosted-agent session.',
    );
  }
  return value as unknown as HostedAgentK1ToolBatchResult;
}

function validStateFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

const WP1_OPERATION_IDS = new Set([
  'timeline.hook.commit.v1',
  'timeline.hook.preview.v1',
  'timeline.hook.refine.commit.v1',
  'timeline.intercut.commit.v1',
  'timeline.intercut.preview.v1',
  'timeline.segment.delete-many.v1',
  'timeline.segment.split.v1',
  'timeline.visual.capture-grid.v1',
]);

function validProjectedOperationResult(value: unknown, operationId: string): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['data', 'error', 'success'])
    || typeof value.success !== 'boolean') {
    return false;
  }
  if (!value.success) {
    return value.data === undefined && validString(value.error, 1_000);
  }
  if (value.error !== undefined) return false;
  if (
    operationId === 'timeline.hook.commit.v1'
    || operationId === 'timeline.hook.preview.v1'
    || operationId === 'timeline.hook.refine.commit.v1'
    || operationId === 'timeline.intercut.commit.v1'
    || operationId === 'timeline.intercut.preview.v1'
    || operationId === 'timeline.segment.delete-many.v1'
  ) return value.data === undefined;
  if (!isRecord(value.data)) return false;
  if (operationId === 'timeline.segment.split.v1') {
    if (!hasOnlyKeys(value.data, ['segments']) || !isRecord(value.data.segments)) return false;
    const segments = value.data.segments;
    const ids = segments.videoClipIds;
    return hasOnlyKeys(segments, ['videoClipIds'])
      && Array.isArray(ids)
      && ids.length >= 2
      && ids.length <= 201
      && new Set(ids).size === ids.length
      && ids.every((id) => validString(id, 500));
  }
  const frameTimes = value.data.frameTimes;
  const imageDataUrl = value.data.imageDataUrl;
  return hasOnlyKeys(value.data, ['frameTimes', 'imageDataUrl'])
    && Array.isArray(frameTimes)
    && frameTimes.length > 0
    && frameTimes.length <= 8
    && new Set(frameTimes).size === frameTimes.length
    && frameTimes.every((time) => typeof time === 'number' && Number.isFinite(time))
    && typeof imageDataUrl === 'string'
    && imageDataUrl.length <= 8_000_000
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl);
}

function parseOperationResult(
  value: unknown,
  turn: HostedAgentK0TurnRow,
): { result: KernelOperationPlanResultV1 } {
  if (!isRecord(value) || !hasOnlyKeys(value, ['result']) || !isRecord(value.result)) {
    throw new HostedAgentRouteError('invalid_operation_result', 'An operation result is required.');
  }
  const result = value.result;
  const boundary = result.result;
  const resultItems = isRecord(boundary) ? boundary.results : undefined;
  const validItems = Array.isArray(resultItems)
    && resultItems.length <= 32
    && resultItems.every((item) => {
      if (!isRecord(item)
        || !hasOnlyKeys(item, ['operationId', 'result', 'sequence'])
        || typeof item.operationId !== 'string'
        || !WP1_OPERATION_IDS.has(item.operationId)
        || !Number.isInteger(item.sequence)
        || Number(item.sequence) <= 0) {
        return false;
      }
      return validProjectedOperationResult(item.result, item.operationId);
    });
  if (
    !hasOnlyKeys(result, [
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
    ])
    || result.schemaVersion !== 1
    || result.kind !== 'operation-plan-result'
    || !validIdentifier(result.batchId, 160)
    || !validIdentifier(result.capabilitySetId)
    || result.clientInstanceId !== turn.client_instance_id
    || result.sessionId !== turn.session_id
    || result.turnId !== turn.turn_id
    || !Number.isSafeInteger(result.sequence)
    || Number(result.sequence) < 0
    || !Number.isInteger(result.stateRevisionBefore)
    || Number(result.stateRevisionBefore) < 0
    || !Number.isInteger(result.stateRevisionAfter)
    || Number(result.stateRevisionAfter) < 0
    || !['committed', 'failed', 'prepared'].includes(String(result.status))
    || (result.errorCode !== undefined
      && ![
        'confirmation-denied',
        'execution-rejected',
        'fingerprint-unavailable',
        'transaction-ownership-lost',
      ].includes(String(result.errorCode)))
    || !isRecord(boundary)
    || !hasOnlyKeys(boundary, ['batchId', 'results', 'success'])
    || boundary.batchId !== result.batchId
    || typeof boundary.success !== 'boolean'
    || !validItems
    || (result.status === 'failed') === (boundary.success === true)
    || (result.errorCode !== undefined && resultItems?.length !== 0)
    || (result.status === 'prepared') !== validStateFingerprint(result.preparedStateFingerprint)
  ) {
    throw new HostedAgentRouteError(
      'invalid_operation_result',
      'The operation result does not match the D1-bound hosted-agent session.',
    );
  }
  return value as unknown as { result: KernelOperationPlanResultV1 };
}

function parseOperationSettlementReceipt(
  value: unknown,
  turn: HostedAgentK0TurnRow,
): { receipt: KernelOperationSettlementReceiptV1 } {
  if (!isRecord(value) || !hasOnlyKeys(value, ['receipt']) || !isRecord(value.receipt)) {
    throw new HostedAgentRouteError(
      'invalid_operation_settlement',
      'An operation settlement receipt is required.',
    );
  }
  const receipt = value.receipt;
  if (
    !hasOnlyKeys(receipt, [
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
    ])
    || receipt.schemaVersion !== 1
    || receipt.kind !== 'operation-plan-settlement-receipt'
    || !validIdentifier(receipt.batchId, 160)
    || !validIdentifier(receipt.capabilitySetId)
    || receipt.clientInstanceId !== turn.client_instance_id
    || receipt.sessionId !== turn.session_id
    || receipt.turnId !== turn.turn_id
    || !Number.isSafeInteger(receipt.sequence)
    || Number(receipt.sequence) < 0
    || !Number.isInteger(receipt.stateRevisionAfterSettlement)
    || Number(receipt.stateRevisionAfterSettlement) < 0
    || !['aborted', 'committed', 'ownership-lost'].includes(String(receipt.outcome))
    || !validStateFingerprint(receipt.preparedStateFingerprint)
    || !validStateFingerprint(receipt.simulatedStateFingerprint)
    || (receipt.outcome === 'committed'
      ? !validStateFingerprint(receipt.committedStateFingerprint)
        || receipt.committedStateFingerprint !== receipt.preparedStateFingerprint
        || receipt.committedStateFingerprint !== receipt.simulatedStateFingerprint
      : receipt.committedStateFingerprint !== undefined)
  ) {
    throw new HostedAgentRouteError(
      'invalid_operation_settlement',
      'The settlement receipt does not match the D1-bound hosted-agent session.',
    );
  }
  return value as unknown as { receipt: KernelOperationSettlementReceiptV1 };
}

async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<{ parsed: unknown; text: string }> {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
    throw new HostedAgentRouteError('invalid_content_type', 'JSON content is required.', 415);
  }
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HostedAgentRouteError('payload_too_large', 'The hosted-agent payload is too large.', 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new HostedAgentRouteError('payload_too_large', 'The hosted-agent payload is too large.', 413);
  }
  try {
    return { parsed: JSON.parse(text) as unknown, text };
  } catch {
    throw new HostedAgentRouteError('invalid_json', 'The JSON request body is invalid.');
  }
}

function assertionSecret(env: Env): string {
  const secret = (env as HostedAgentRouteEnv).KERNEL_SERVICE_ASSERTION_SECRET?.trim();
  if (!secret) {
    throw new HostedAgentAssertionError(
      'assertion_secret_unavailable',
      'The hosted-agent assertion secret is not configured.',
    );
  }
  return secret;
}

async function mintAssertion(env: Env, turn: HostedAgentK0TurnRow): Promise<string> {
  return signHostedAgentServiceAssertion(
    buildHostedAgentAssertionClaims({
      clientInstanceId: turn.client_instance_id,
      maximumIterations: turn.maximum_iterations,
      maxTurnSpendCredits: turn.accepted_max_spend_credits,
      model: turn.model,
      nonce: turn.assertion_nonce,
      providerProtocol: turn.provider_protocol,
      sessionId: turn.session_id,
      toolExecutionMode: turn.tool_execution_mode,
      turnId: turn.turn_id,
      userId: turn.user_id,
    }),
    assertionSecret(env),
  );
}

async function mintFastV2Assertion(input: {
  browserRequest: HostedAgentFastV2StartRequest;
  browserRequestDigest: string;
  edge: HostedAgentFastV2EdgePins;
  env: Env;
  turn: HostedAgentK0TurnRow;
}): Promise<string> {
  return signHostedAgentServiceAssertion(
    buildHostedAgentFastV2AssertionClaims({
      browserRequest: input.browserRequest,
      browserRequestDigest: input.browserRequestDigest,
      edge: input.edge,
      nonce: input.turn.assertion_nonce,
      userId: input.turn.user_id,
    }),
    assertionSecret(input.env),
  );
}

function requireUser(context: AppContext): NonNullable<AppContext['data']['user']> {
  if (!context.data.user) {
    throw new HostedAgentRouteError(
      'authentication_required',
      'Sign in to use the hosted-agent kernel route.',
      401,
    );
  }
  return context.data.user;
}

function requireClientBinding(request: Request, turn: HostedAgentK0TurnRow): void {
  if (
    request.headers.get(HOSTED_AGENT_HEADERS.clientInstanceId) !== turn.client_instance_id
    || request.headers.get(HOSTED_AGENT_HEADERS.sessionId) !== turn.session_id
  ) {
    throw new HostedAgentRouteError(
      'session_binding_mismatch',
      'The request does not match the open-page hosted-agent session.',
      409,
    );
  }
}

function validateServiceBearer(request: Request, env: Env): void {
  const expected = env.KERNEL_AUTH_TOKEN?.trim();
  if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) {
    throw new HostedAgentRouteError(
      'service_authentication_required',
      'A valid kernel service credential is required.',
      401,
    );
  }
}

async function verifiedServiceClaims(context: AppContext, turnId: string): Promise<{
  billingClaims: HostedAgentServiceBillingClaims;
  fastV2Claims?: HostedAgentFastV2AssertionClaims;
}> {
  validateServiceBearer(context.request, context.env);
  const assertion = context.request.headers.get(HOSTED_AGENT_HEADERS.serviceAssertion);
  if (!assertion || assertion.length > 8_192) {
    throw new HostedAgentRouteError(
      'service_assertion_required',
      'A signed hosted-agent service assertion is required.',
      401,
    );
  }
  const turn = await getHostedAgentK0TurnForService(context.env.DB, turnId);
  const secret = assertionSecret(context.env);
  if (turn?.protocol_version === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION) {
    const claims = await verifyHostedAgentFastV2ServiceAssertion(assertion, secret);
    if (claims.turnId !== turnId) {
      throw new HostedAgentRouteError(
        'service_assertion_mismatch',
        'The assertion does not bind this Fast V2 turn.',
        401,
      );
    }
    return {
      billingClaims: await resolveHostedAgentFastV2BillingClaims(context.env.DB, claims),
      fastV2Claims: claims,
    };
  }
  const claims = await verifyHostedAgentServiceAssertion(assertion, secret);
  if (claims.turnId !== turnId) {
    throw new HostedAgentRouteError(
      'service_assertion_mismatch',
      'The assertion does not bind this hosted-agent turn.',
      401,
    );
  }
  await assertHostedAgentClaimsMatchD1(
    context.env.DB,
    claims,
    { allowTerminal: true },
  );
  return { billingClaims: claims };
}

function assertMethod(context: AppContext, method: 'GET' | 'POST'): void {
  if (context.request.method !== method) {
    throw new HostedAgentRouteError(
      'method_not_allowed',
      `This hosted-agent route requires ${method}.`,
      405,
    );
  }
}

function handleProtocolSelection(context: AppContext): Response {
  assertMethod(context, 'GET');
  const user = requireUser(context);
  return json(selectHostedAgentProtocol(context.env, user.id), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function handleStart(context: AppContext): Promise<Response> {
  assertMethod(context, 'POST');
  const user = requireUser(context);
  const { parsed } = await readJsonBody(context.request, MAX_START_BODY_BYTES);
  const maximumTurnSpendCredits = maximumHostedAgentTurnSpendCredits(
    context.env.ENVIRONMENT,
  );
  const request = parseTurnRequest(parsed, maximumTurnSpendCredits);
  const capability = getKieChatModelCapability(request.model);
  if (!capability) {
    throw new HostedAgentRouteError('unsupported_model', 'The hosted Kie.ai model is unsupported.');
  }

  const { replayed, turn } = await createHostedAgentK0Turn(context.env.DB, {
    maximumTurnSpendCredits,
    providerProtocol: capability.protocol,
    request,
    userId: user.id,
  });
  const assertion = await mintAssertion(context.env, turn);
  const upstreamBody = JSON.stringify({
    ...request,
    acceptedHistoryFormatVersion: turn.history_format_version,
    acceptedPromptVersion: turn.prompt_version,
    acceptedToolSchemaVersion: turn.tool_schema_version,
    maximumIterations: turn.maximum_iterations,
    maximumSpendCredits: turn.accepted_max_spend_credits,
    maxTurnSpendCredits: turn.accepted_max_spend_credits,
    protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
    replayed,
    sessionId: turn.session_id,
  });
  try {
    const upstream = await forwardHostedAgentRequest({
      accept: 'application/json',
      assertion,
      body: upstreamBody,
      clientInstanceId: turn.client_instance_id,
      env: context.env,
      method: 'POST',
      requestSignal: context.request.signal,
      sessionId: turn.session_id,
      turnId: turn.turn_id,
      upstreamPath: '/kernel/hosted-agent/turns',
    });
    if (!upstream.ok) {
      await cancelHostedAgentK0Turn(context.env.DB, turn);
    }
    return upstream;
  } catch (error) {
    await cancelHostedAgentK0Turn(context.env.DB, turn);
    throw error;
  }
}

async function handleFastV2Start(context: AppContext): Promise<Response> {
  assertMethod(context, 'POST');
  const user = requireUser(context);
  const selection = selectHostedAgentProtocol(context.env, user.id);
  if (selection.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION) {
    throw new HostedAgentRouteError(
      'fast_v2_not_enabled',
      'Fast V2 is not enabled for this authenticated account.',
      409,
    );
  }
  const { parsed } = await readJsonBody(
    context.request,
    HOSTED_AGENT_FAST_V2_MAX_START_BYTES,
  );
  let browserRequest: HostedAgentFastV2StartRequest;
  try {
    browserRequest = parseHostedAgentFastV2StartRequest(parsed);
  } catch (error) {
    if (error instanceof HostedAgentFastV2ContractError) {
      throw new HostedAgentRouteError(error.code, error.message);
    }
    throw error;
  }

  const browserRequestDigest = await digestHostedAgentFastV2BrowserRequest(browserRequest);
  const executionProfile = browserRequest.executionProfile ?? 'fast';
  if (
    executionProfile === 'verified'
    && (context.env as HostedAgentRouteEnv).HOSTED_AGENT_VERIFIED_PILOT_ENABLED !== 'true'
  ) {
    throw new HostedAgentRouteError(
      'verified_profile_not_enabled',
      'The Verified profile pilot is not enabled for this environment.',
      409,
    );
  }
  const requestedModelClass = browserRequest.requestedModelClass ?? 'fast';
  const maximumTurnSpendCredits = Math.min(
    maximumHostedAgentTurnSpendCredits(context.env.ENVIRONMENT),
    HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS,
  );
  const { turn } = await createHostedAgentTurnFromServerPolicy(context.env.DB, {
    identity: {
      clientInstanceId: browserRequest.clientInstanceId,
      historyFormatVersion: `${FAST_V2_HISTORY_FORMAT_VERSION}:${browserRequestDigest}`,
      maximumIterations: HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS,
      model: FAST_V2_EDGE_BILLING_MODEL[requestedModelClass],
      promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
      protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
      providerProtocol: FAST_V2_EDGE_PROVIDER_PROTOCOL,
      requestedMaxSpendCredits: maximumTurnSpendCredits,
      toolExecutionMode: browserRequest.requestedExecutionMode ?? 'normal',
      toolSchemaVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
      turnId: browserRequest.turnId,
    },
    maximumTurnSpendCredits,
    userId: user.id,
  });
  if (turn.status === 'cancelled') {
    throw new HostedAgentRouteError(
      'turn_terminal',
      'The Fast V2 turn is cancelled and cannot be resumed by a start replay.',
      409,
    );
  }
  const edge: HostedAgentFastV2EdgePins = {
    budgetPolicyVersion: HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
    capabilityBundleVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
    executionProfile,
    maximumIterations: turn.maximum_iterations,
    maxTurnSpendCredits: turn.accepted_max_spend_credits,
    modelPolicyVersion: HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
    promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
    schemaVersion: HOSTED_AGENT_FAST_V2_SERVICE_ENVELOPE_VERSION,
    sessionId: turn.session_id,
  };
  try {
    await bindHostedAgentFastV2Turn(context.env.DB, {
      browserRequest,
      browserRequestDigest,
      edge,
    });
    const assertion = await mintFastV2Assertion({
      browserRequest,
      browserRequestDigest,
      edge,
      env: context.env,
      turn,
    });
    const upstreamBody = JSON.stringify({ browserRequest, edge });
    const upstream = await forwardHostedAgentRequest({
      accept: 'application/json',
      assertion,
      body: upstreamBody,
      clientInstanceId: turn.client_instance_id,
      env: context.env,
      method: 'POST',
      protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
      requestSignal: context.request.signal,
      sessionId: turn.session_id,
      turnId: turn.turn_id,
      upstreamPath: '/kernel/hosted-agent/v2/turns',
    });
    if (!upstream.ok) {
      await cancelHostedAgentK0Turn(context.env.DB, turn);
    }
    return upstream;
  } catch (error) {
    await cancelHostedAgentK0Turn(context.env.DB, turn);
    throw error;
  }
}

async function userTurn(context: AppContext, turnId: string): Promise<HostedAgentK0TurnRow> {
  const user = requireUser(context);
  const turn = await getHostedAgentK0Turn(context.env.DB, user.id, turnId);
  if (!turn) {
    throw new HostedAgentRouteError('turn_not_found', 'The hosted-agent turn was not found.', 404);
  }
  return turn;
}

function persistedFastV2EdgePins(
  turn: HostedAgentK0TurnRow,
  binding: HostedAgentFastV2BindingRow,
): HostedAgentFastV2EdgePins {
  if (
    turn.protocol_version !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || binding.prompt_version !== HOSTED_AGENT_FAST_V2_PROMPT_VERSION
    || binding.capability_bundle_version !== HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION
    || binding.model_policy_version !== HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION
    || binding.budget_policy_version !== HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION
    || binding.execution_contract_version !== HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION
    || binding.execution_contract_digest !== HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST
  ) {
    throw new HostedAgentRouteError(
      'fast_v2_binding_mismatch',
      'The Fast V2 server-policy binding is incompatible.',
      409,
    );
  }
  return {
    budgetPolicyVersion: HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
    capabilityBundleVersion: HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
    executionProfile: binding.execution_profile,
    maximumIterations: turn.maximum_iterations,
    maxTurnSpendCredits: turn.accepted_max_spend_credits,
    modelPolicyVersion: HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
    promptVersion: HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
    schemaVersion: HOSTED_AGENT_FAST_V2_SERVICE_ENVELOPE_VERSION,
    sessionId: turn.session_id,
  };
}

async function fastV2UserTurn(context: AppContext, turnId: string): Promise<{
  binding: HostedAgentFastV2BindingRow;
  edge: HostedAgentFastV2EdgePins;
  turn: HostedAgentK0TurnRow;
}> {
  const turn = await userTurn(context, turnId);
  const binding = await getHostedAgentFastV2Binding(context.env.DB, turn.turn_id);
  if (!binding || turn.protocol_version !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION) {
    throw new HostedAgentRouteError('turn_not_found', 'The Fast V2 turn was not found.', 404);
  }
  return { binding, edge: persistedFastV2EdgePins(turn, binding), turn };
}

async function mintPersistedFastV2Assertion(input: {
  binding: HostedAgentFastV2BindingRow;
  edge: HostedAgentFastV2EdgePins;
  env: Env;
  turn: HostedAgentK0TurnRow;
}): Promise<string> {
  return signHostedAgentServiceAssertion(
    buildHostedAgentFastV2AssertionClaimsFromBinding({
      browserRequestDigest: input.binding.browser_request_digest,
      clientInstanceId: input.turn.client_instance_id,
      edge: input.edge,
      editorBuildId: input.binding.editor_build_id,
      executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
      executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
      nonce: input.turn.assertion_nonce,
      snapshotStateFingerprint: input.binding.snapshot_state_fingerprint,
      snapshotTimelineRevision: input.binding.snapshot_timeline_revision,
      turnId: input.turn.turn_id,
      userId: input.turn.user_id,
    }),
    assertionSecret(input.env),
  );
}

async function handleEvents(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'GET');
  const turn = await userTurn(context, turnId);
  requireClientBinding(context.request, turn);
  const lastEventId = context.request.headers.get(HOSTED_AGENT_HEADERS.lastEventId)?.trim();
  if (
    lastEventId
    && (lastEventId.length > 200 || !EVENT_CURSOR_PATTERN.test(lastEventId))
  ) {
    throw new HostedAgentRouteError('invalid_event_cursor', 'The event cursor is invalid.');
  }
  return forwardHostedAgentRequest({
    accept: 'text/event-stream',
    assertion: await mintAssertion(context.env, turn),
    clientInstanceId: turn.client_instance_id,
    env: context.env,
    expectedEventStream: true,
    lastEventId,
    method: 'GET',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    requestSignal: context.request.signal,
    sessionId: turn.session_id,
    turnId: turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/turns/${encodeURIComponent(turn.turn_id)}/events`,
  });
}

async function handleToolResults(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const turn = await userTurn(context, turnId);
  if (turn.status !== 'active') {
    throw new HostedAgentRouteError('turn_terminal', 'The hosted-agent turn is terminal.', 409);
  }
  requireClientBinding(context.request, turn);
  const body = await readJsonBody(context.request, MAX_TOOL_RESULT_BODY_BYTES);
  parseToolResult(body.parsed, turn);
  return forwardHostedAgentRequest({
    accept: 'application/json',
    assertion: await mintAssertion(context.env, turn),
    body: body.text,
    clientInstanceId: turn.client_instance_id,
    contentType: context.request.headers.get('Content-Type') ?? 'application/json',
    env: context.env,
    method: 'POST',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    requestSignal: context.request.signal,
    sessionId: turn.session_id,
    turnId: turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/turns/${encodeURIComponent(turn.turn_id)}/tool-results`,
  });
}

async function handleOperationResults(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const turn = await userTurn(context, turnId);
  if (turn.status !== 'active') {
    throw new HostedAgentRouteError('turn_terminal', 'The hosted-agent turn is terminal.', 409);
  }
  requireClientBinding(context.request, turn);
  const body = await readJsonBody(context.request, MAX_TOOL_RESULT_BODY_BYTES);
  parseOperationResult(body.parsed, turn);
  return forwardHostedAgentRequest({
    accept: 'application/json',
    assertion: await mintAssertion(context.env, turn),
    body: body.text,
    clientInstanceId: turn.client_instance_id,
    contentType: context.request.headers.get('Content-Type') ?? 'application/json',
    env: context.env,
    method: 'POST',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    requestSignal: context.request.signal,
    sessionId: turn.session_id,
    turnId: turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/turns/${encodeURIComponent(turn.turn_id)}/operation-results`,
  });
}

async function handleOperationSettlements(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const turn = await userTurn(context, turnId);
  if (turn.status !== 'active') {
    throw new HostedAgentRouteError('turn_terminal', 'The hosted-agent turn is terminal.', 409);
  }
  requireClientBinding(context.request, turn);
  const body = await readJsonBody(context.request, MAX_SERVICE_BODY_BYTES);
  parseOperationSettlementReceipt(body.parsed, turn);
  return forwardHostedAgentRequest({
    accept: 'application/json',
    assertion: await mintAssertion(context.env, turn),
    body: body.text,
    clientInstanceId: turn.client_instance_id,
    contentType: context.request.headers.get('Content-Type') ?? 'application/json',
    env: context.env,
    method: 'POST',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    requestSignal: context.request.signal,
    sessionId: turn.session_id,
    turnId: turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/turns/${encodeURIComponent(turn.turn_id)}/operation-settlements`,
  });
}

async function handleCancel(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const turn = await userTurn(context, turnId);
  requireClientBinding(context.request, turn);
  await cancelHostedAgentK0Turn(context.env.DB, turn);
  // D1 cancellation is authoritative and happens first. The origin notification
  // is best effort so a lost network response cannot reopen billing; when it
  // arrives, it aborts provider/tool waits immediately instead of waiting for
  // the next rejected authorization.
  try {
    const upstream = await forwardHostedAgentRequest({
      accept: 'application/json',
      assertion: await mintAssertion(context.env, turn),
      clientInstanceId: turn.client_instance_id,
      env: context.env,
      method: 'POST',
      pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
      requestSignal: context.request.signal,
      sessionId: turn.session_id,
      turnId: turn.turn_id,
      upstreamPath: `/kernel/hosted-agent/turns/${encodeURIComponent(turn.turn_id)}/cancel`,
    });
    await upstream.body?.cancel();
  } catch {
    // The D1 terminal marker already prevents every future authorization.
  }
  return json({
    terminalReason: 'explicit_cancel',
    turnId: turn.turn_id,
    turnStatus: 'cancelled',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleFastV2Events(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'GET');
  const session = await fastV2UserTurn(context, turnId);
  requireClientBinding(context.request, session.turn);
  if (session.turn.status === 'cancelled') {
    try {
      const cancellation = await forwardHostedAgentRequest({
        accept: 'application/json',
        assertion: await mintPersistedFastV2Assertion({ ...session, env: context.env }),
        clientInstanceId: session.turn.client_instance_id,
        env: context.env,
        method: 'POST',
        pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
        protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
        requestSignal: context.request.signal,
        sessionId: session.turn.session_id,
        turnId: session.turn.turn_id,
        upstreamPath: `/kernel/hosted-agent/v2/turns/${encodeURIComponent(session.turn.turn_id)}/cancel`,
      });
      const acknowledgement = await cancellation.json() as unknown;
      if (
        !cancellation.ok
        || !isRecord(acknowledgement)
        || acknowledgement.turnId !== session.turn.turn_id
        || acknowledgement.turnStatus !== 'cancelled'
      ) throw new Error('origin cancellation was not acknowledged');
    } catch {
      throw new HostedAgentRouteError(
        'turn_terminal',
        'The Fast V2 turn is cancelled; its private origin was not resumed.',
        409,
      );
    }
  }
  const lastEventId = context.request.headers.get(HOSTED_AGENT_HEADERS.lastEventId)?.trim();
  if (lastEventId && (lastEventId.length > 200 || !EVENT_CURSOR_PATTERN.test(lastEventId))) {
    throw new HostedAgentRouteError('invalid_event_cursor', 'The event cursor is invalid.');
  }
  return forwardHostedAgentRequest({
    accept: 'text/event-stream',
    assertion: await mintPersistedFastV2Assertion({ ...session, env: context.env }),
    clientInstanceId: session.turn.client_instance_id,
    env: context.env,
    expectedEventStream: true,
    lastEventId,
    method: 'GET',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    requestSignal: context.request.signal,
    sessionId: session.turn.session_id,
    turnId: session.turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/v2/turns/${encodeURIComponent(session.turn.turn_id)}/events`,
  });
}

async function handleFastV2OperationResults(
  context: AppContext,
  turnId: string,
): Promise<Response> {
  assertMethod(context, 'POST');
  const session = await fastV2UserTurn(context, turnId);
  if (session.turn.status !== 'active') {
    throw new HostedAgentRouteError('turn_terminal', 'The Fast V2 turn is terminal.', 409);
  }
  requireClientBinding(context.request, session.turn);
  const body = await readJsonBody(context.request, MAX_TOOL_RESULT_BODY_BYTES);
  const parsed = parseOperationResult(body.parsed, session.turn);
  if (
    (session.binding.execution_profile === 'fast' && parsed.result.status === 'prepared')
    || (session.binding.execution_profile === 'verified' && parsed.result.status === 'committed')
  ) {
    throw new HostedAgentRouteError(
      'invalid_operation_result',
      'The operation result contradicts the D1-bound execution profile.',
    );
  }
  return forwardHostedAgentRequest({
    accept: 'application/json',
    assertion: await mintPersistedFastV2Assertion({ ...session, env: context.env }),
    body: body.text,
    clientInstanceId: session.turn.client_instance_id,
    contentType: context.request.headers.get('Content-Type') ?? 'application/json',
    env: context.env,
    method: 'POST',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    requestSignal: context.request.signal,
    sessionId: session.turn.session_id,
    turnId: session.turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/v2/turns/${encodeURIComponent(session.turn.turn_id)}/operation-results`,
  });
}

async function handleFastV2OperationSettlements(
  context: AppContext,
  turnId: string,
): Promise<Response> {
  assertMethod(context, 'POST');
  const session = await fastV2UserTurn(context, turnId);
  if (session.binding.execution_profile !== 'verified') {
    throw new HostedAgentRouteError(
      'invalid_operation_settlement',
      'Fast turns cannot submit an operation settlement receipt.',
      409,
    );
  }
  requireClientBinding(context.request, session.turn);
  const body = await readJsonBody(context.request, MAX_SERVICE_BODY_BYTES);
  parseOperationSettlementReceipt(body.parsed, session.turn);
  if (session.turn.status !== 'active' && session.turn.status !== 'completed') {
    throw new HostedAgentRouteError('turn_terminal', 'The Fast V2 turn is terminal.', 409);
  }
  return forwardHostedAgentRequest({
    accept: 'application/json',
    assertion: await mintPersistedFastV2Assertion({ ...session, env: context.env }),
    body: body.text,
    clientInstanceId: session.turn.client_instance_id,
    contentType: context.request.headers.get('Content-Type') ?? 'application/json',
    env: context.env,
    method: 'POST',
    pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    requestSignal: context.request.signal,
    sessionId: session.turn.session_id,
    turnId: session.turn.turn_id,
    upstreamPath: `/kernel/hosted-agent/v2/turns/${encodeURIComponent(session.turn.turn_id)}/operation-settlements`,
  });
}

async function handleFastV2Cancel(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const session = await fastV2UserTurn(context, turnId);
  requireClientBinding(context.request, session.turn);
  await cancelHostedAgentK0Turn(context.env.DB, session.turn);
  try {
    const upstream = await forwardHostedAgentRequest({
      accept: 'application/json',
      assertion: await mintPersistedFastV2Assertion({ ...session, env: context.env }),
      clientInstanceId: session.turn.client_instance_id,
      env: context.env,
      method: 'POST',
      pageLease: context.request.headers.get(HOSTED_AGENT_HEADERS.pageLease)?.trim(),
      protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
      requestSignal: context.request.signal,
      sessionId: session.turn.session_id,
      turnId: session.turn.turn_id,
      upstreamPath: `/kernel/hosted-agent/v2/turns/${encodeURIComponent(session.turn.turn_id)}/cancel`,
    });
    await upstream.body?.cancel();
  } catch {
    // The authoritative D1 terminal marker already prevents future billing.
  }
  return json({
    terminalReason: 'explicit_cancel',
    turnId: session.turn.turn_id,
    turnStatus: 'cancelled',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function parseAuthorizationRequest(
  value: unknown,
  turnId: string,
  roundIndex: number,
): HostedAgentRoundAuthorizationRequest {
  if (
    !isRecord(value)
    || value.roundIndex !== roundIndex
    || value.idempotencyKey !== hostedAgentRoundIdempotencyKey(turnId, roundIndex)
  ) {
    throw new HostedAgentRouteError(
      'invalid_round_authorization',
      'The provider-round authorization request is invalid.',
    );
  }
  return value as unknown as HostedAgentRoundAuthorizationRequest;
}

function parseSettlementRequest(
  value: unknown,
  turnId: string,
  roundIndex: number,
): HostedAgentRoundSettlementRequest {
  if (
    !isRecord(value)
    || value.roundIndex !== roundIndex
    || value.idempotencyKey !== hostedAgentRoundIdempotencyKey(turnId, roundIndex)
    || typeof value.providerResultDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.providerResultDigest)
    || (
      value.providerCredits !== undefined
      && (
        typeof value.providerCredits !== 'number'
        || !Number.isFinite(value.providerCredits)
        || value.providerCredits < 0
      )
    )
    || !validOptionalInteger(value.inputTokens)
    || !validOptionalInteger(value.cachedInputTokens)
    || !validOptionalInteger(value.outputTokens)
    || !validOptionalInteger(value.reasoningTokens)
    || !validOptionalInteger(value.toolCallCount)
  ) {
    throw new HostedAgentRouteError(
      'invalid_round_settlement',
      'The provider-round settlement metadata is invalid.',
    );
  }
  return value as unknown as HostedAgentRoundSettlementRequest;
}

function parseFastV2AuthorizationRequest(
  value: unknown,
  turnId: string,
  roundIndex: number,
  claims: HostedAgentFastV2AssertionClaims,
): HostedAgentRoundAuthorizationRequest {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'budgetPolicyVersion',
      'idempotencyKey',
      'modelPolicyVersion',
      'protocolVersion',
      'roundIndex',
      'snapshotStateFingerprint',
      'snapshotTimelineRevision',
    ])
    || value.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || value.budgetPolicyVersion !== claims.budgetPolicyVersion
    || value.modelPolicyVersion !== claims.modelPolicyVersion
    || value.snapshotTimelineRevision !== claims.snapshotTimelineRevision
    || value.snapshotStateFingerprint !== claims.snapshotStateFingerprint
    || value.roundIndex !== roundIndex
    || value.idempotencyKey !== hostedAgentFastV2RoundIdempotencyKey(turnId, roundIndex)
  ) {
    throw new HostedAgentRouteError(
      'invalid_round_authorization',
      'The Fast V2 provider-round authorization request is invalid.',
    );
  }
  return {
    idempotencyKey: value.idempotencyKey,
    roundIndex,
  };
}

function parseFastV2AuthorizationReplayRequest(
  value: unknown,
  turnId: string,
  roundIndex: number,
  binding: HostedAgentFastV2BindingRow,
): HostedAgentRoundAuthorizationRequest {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'budgetPolicyVersion',
      'idempotencyKey',
      'modelPolicyVersion',
      'protocolVersion',
      'roundIndex',
      'snapshotStateFingerprint',
      'snapshotTimelineRevision',
    ])
    || value.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || value.budgetPolicyVersion !== binding.budget_policy_version
    || value.modelPolicyVersion !== binding.model_policy_version
    || value.snapshotTimelineRevision !== binding.snapshot_timeline_revision
    || value.snapshotStateFingerprint !== binding.snapshot_state_fingerprint
    || value.roundIndex !== roundIndex
    || value.idempotencyKey !== hostedAgentFastV2RoundIdempotencyKey(turnId, roundIndex)
  ) {
    throw new HostedAgentRouteError(
      'invalid_round_authorization',
      'The Fast V2 provider-round replay request is invalid.',
    );
  }
  return {
    idempotencyKey: value.idempotencyKey,
    roundIndex,
  };
}

function parseFastV2SettlementRequest(
  value: unknown,
  turnId: string,
  roundIndex: number,
): HostedAgentRoundSettlementRequest {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'cachedInputTokens',
      'idempotencyKey',
      'inputTokens',
      'outputTokens',
      'providerCredits',
      'providerResultDigest',
      'protocolVersion',
      'reasoningTokens',
      'roundIndex',
      'toolCallCount',
    ])
    || value.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || value.roundIndex !== roundIndex
    || value.idempotencyKey !== hostedAgentFastV2RoundIdempotencyKey(turnId, roundIndex)
    || typeof value.providerResultDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(value.providerResultDigest)
    || (
      value.providerCredits !== undefined
      && (
        typeof value.providerCredits !== 'number'
        || !Number.isFinite(value.providerCredits)
        || value.providerCredits < 0
      )
    )
    || !validOptionalInteger(value.inputTokens)
    || !validOptionalInteger(value.cachedInputTokens)
    || !validOptionalInteger(value.outputTokens)
    || !validOptionalInteger(value.reasoningTokens)
    || !validOptionalInteger(value.toolCallCount)
  ) {
    throw new HostedAgentRouteError(
      'invalid_round_settlement',
      'The Fast V2 provider-round settlement metadata is invalid.',
    );
  }
  const { protocolVersion: _protocolVersion, ...settlement } = value;
  return settlement as unknown as HostedAgentRoundSettlementRequest;
}

async function handleServiceRound(
  context: AppContext,
  turnId: string,
  roundIndex: number,
  action: 'authorize' | 'settle',
): Promise<Response> {
  assertMethod(context, 'POST');
  const verified = await verifiedServiceClaims(context, turnId);
  const { parsed } = await readJsonBody(context.request, MAX_SERVICE_BODY_BYTES);
  const result = action === 'authorize'
    ? await authorizeHostedAgentK0Round(
        context.env.DB,
        verified.billingClaims,
        verified.fastV2Claims
          ? parseFastV2AuthorizationRequest(parsed, turnId, roundIndex, verified.fastV2Claims)
          : parseAuthorizationRequest(parsed, turnId, roundIndex),
      )
    : await settleHostedAgentK0Round(
        context.env.DB,
        verified.billingClaims,
        verified.fastV2Claims
          ? parseFastV2SettlementRequest(parsed, turnId, roundIndex)
          : parseSettlementRequest(parsed, turnId, roundIndex),
      );
  return json(result, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleServiceComplete(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const { billingClaims } = await verifiedServiceClaims(context, turnId);
  return json(
    await completeHostedAgentK0Turn(context.env.DB, billingClaims),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleServiceRoundReplay(
  context: AppContext,
  turnId: string,
  roundIndex: number,
  action: 'authorize' | 'settle',
): Promise<Response> {
  assertMethod(context, 'POST');
  const billingClaims = await durableFailureClaims(context, turnId);
  const turn = await getHostedAgentK0TurnForService(context.env.DB, turnId);
  if (!turn) {
    throw new HostedAgentRouteError('turn_not_found', 'The hosted-agent turn was not found.', 404);
  }
  const { parsed } = await readJsonBody(context.request, MAX_SERVICE_BODY_BYTES);
  let request: HostedAgentRoundAuthorizationRequest | HostedAgentRoundSettlementRequest;
  if (turn.protocol_version === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION) {
    if (action === 'authorize') {
      const binding = await getHostedAgentFastV2Binding(context.env.DB, turnId);
      if (!binding) {
        throw new HostedAgentRouteError(
          'turn_not_found',
          'The Fast V2 turn binding was not found.',
          404,
        );
      }
      request = parseFastV2AuthorizationReplayRequest(parsed, turnId, roundIndex, binding);
    } else {
      request = parseFastV2SettlementRequest(parsed, turnId, roundIndex);
    }
  } else {
    request = action === 'authorize'
      ? parseAuthorizationRequest(parsed, turnId, roundIndex)
      : parseSettlementRequest(parsed, turnId, roundIndex);
  }
  const result = action === 'authorize'
    ? await authorizeHostedAgentK0Round(
        context.env.DB,
        billingClaims,
        request as HostedAgentRoundAuthorizationRequest,
        { replayOnly: true },
      )
    : await settleHostedAgentK0Round(
        context.env.DB,
        billingClaims,
        request as HostedAgentRoundSettlementRequest,
        { replayOnly: true },
      );
  return json(result, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleServiceCompleteReplay(
  context: AppContext,
  turnId: string,
): Promise<Response> {
  assertMethod(context, 'POST');
  return json(
    await completeHostedAgentK0Turn(
      context.env.DB,
      await durableFailureClaims(context, turnId),
      { replayOnly: true },
    ),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function durableFailureClaims(
  context: AppContext,
  turnId: string,
): Promise<HostedAgentServiceBillingClaims> {
  validateServiceBearer(context.request, context.env);
  const turn = await getHostedAgentK0TurnForService(context.env.DB, turnId);
  if (!turn) {
    throw new HostedAgentRouteError('turn_not_found', 'The hosted-agent turn was not found.', 404);
  }
  // Terminal cleanup and replay-only reconciliation can outlive the short
  // browser-bound assertion. The long-lived service credential can release a
  // reservation or read an already committed idempotent result, but cannot
  // authorize, settle, or complete new work; identity is rebuilt from D1.
  return {
    clientInstanceId: turn.client_instance_id,
    maximumIterations: turn.maximum_iterations,
    maxTurnSpendCredits: turn.accepted_max_spend_credits,
    model: turn.model,
    nonce: turn.assertion_nonce,
    protocolVersion: turn.protocol_version,
    providerProtocol: turn.provider_protocol,
    sessionId: turn.session_id,
    sub: turn.user_id,
    toolExecutionMode: turn.tool_execution_mode,
    turnId: turn.turn_id,
  };
}

async function handleServiceFail(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  return json(
    await failHostedAgentTurn(context.env.DB, await durableFailureClaims(context, turnId)),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof HostedAgentRouteError) {
    if (error.code === 'method_not_allowed') {
      return methodNotAllowed(['GET', 'POST']);
    }
    return json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof HostedAgentAssertionError) {
    return json(
      { error: error.code, message: error.message },
      { status: error.code === 'assertion_secret_unavailable' ? 503 : 401 },
    );
  }
  if (error instanceof HostedAgentK0BillingError) {
    return json(
      { error: error.code, message: error.message },
      {
        status: error.code === 'insufficient_credits'
          ? 402
          : error.code === 'invalid_claims' ? 401 : 409,
      },
    );
  }
  if (error instanceof HostedAgentProxyError) {
    return json(
      { error: error.code, message: error.message },
      { status: error.code === 'upstream_timeout' ? 504 : 502 },
    );
  }
  console.error('[hosted-agent] unexpected K2 route failure', {
    message: error instanceof Error ? error.message : 'non-error rejection',
    name: error instanceof Error ? error.name : typeof error,
  });
  return json(
    { error: 'hosted_agent_unavailable', message: 'The hosted-agent K2 route failed safely.' },
    { status: 500 },
  );
}

export async function tryHandleHostedAgent(
  context: AppContext,
  path: string,
): Promise<Response | null> {
  if (path === 'hosted-agent/protocol') {
    try {
      return handleProtocolSelection(context);
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (path === 'hosted-agent/v2/turns') {
    try {
      return await handleFastV2Start(context);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const fastV2EventsMatch = /^hosted-agent\/v2\/turns\/([A-Za-z0-9._:-]+)\/events$/.exec(path);
  const fastV2OperationResultsMatch = /^hosted-agent\/v2\/turns\/([A-Za-z0-9._:-]+)\/operation-results$/.exec(path);
  const fastV2OperationSettlementsMatch = /^hosted-agent\/v2\/turns\/([A-Za-z0-9._:-]+)\/operation-settlements$/.exec(path);
  const fastV2CancelMatch = /^hosted-agent\/v2\/turns\/([A-Za-z0-9._:-]+)\/cancel$/.exec(path);
  if (
    fastV2EventsMatch
    || fastV2OperationResultsMatch
    || fastV2OperationSettlementsMatch
    || fastV2CancelMatch
  ) {
    try {
      if (fastV2EventsMatch) {
        return await handleFastV2Events(context, fastV2EventsMatch[1]);
      }
      if (fastV2OperationResultsMatch) {
        return await handleFastV2OperationResults(context, fastV2OperationResultsMatch[1]);
      }
      if (fastV2OperationSettlementsMatch) {
        return await handleFastV2OperationSettlements(
          context,
          fastV2OperationSettlementsMatch[1],
        );
      }
      return await handleFastV2Cancel(context, fastV2CancelMatch![1]);
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (path === 'hosted-agent/turns') {
    try {
      return await handleStart(context);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const eventsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/events$/.exec(path);
  const resultsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/tool-results$/.exec(path);
  const operationResultsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/operation-results$/.exec(path);
  const operationSettlementsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/operation-settlements$/.exec(path);
  const cancelMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/cancel$/.exec(path);
  const serviceRoundMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9._:-]+)\/rounds\/(\d+)\/(authorize|settle)$/.exec(path);
  const serviceRoundReplayMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9._:-]+)\/rounds\/(\d+)\/(authorize|settle)-replay$/.exec(path);
  const serviceCompleteMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9._:-]+)\/complete$/.exec(path);
  const serviceCompleteReplayMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9._:-]+)\/complete-replay$/.exec(path);
  const serviceFailMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9._:-]+)\/fail$/.exec(path);
  if (!eventsMatch && !resultsMatch && !operationResultsMatch && !operationSettlementsMatch
    && !cancelMatch && !serviceRoundMatch && !serviceRoundReplayMatch
    && !serviceCompleteMatch && !serviceCompleteReplayMatch && !serviceFailMatch) {
    return path.startsWith('hosted-agent/') ? json(
      { error: 'unknown_hosted_agent_route' },
      { status: 404 },
    ) : null;
  }

  try {
    if (eventsMatch) {
      return await handleEvents(context, eventsMatch[1]);
    }
    if (resultsMatch) {
      return await handleToolResults(context, resultsMatch[1]);
    }
    if (operationResultsMatch) {
      return await handleOperationResults(context, operationResultsMatch[1]);
    }
    if (operationSettlementsMatch) {
      return await handleOperationSettlements(context, operationSettlementsMatch[1]);
    }
    if (cancelMatch) {
      return await handleCancel(context, cancelMatch[1]);
    }
    if (serviceRoundMatch) {
      return await handleServiceRound(
        context,
        serviceRoundMatch[1],
        Number(serviceRoundMatch[2]),
        serviceRoundMatch[3] as 'authorize' | 'settle',
      );
    }
    if (serviceRoundReplayMatch) {
      return await handleServiceRoundReplay(
        context,
        serviceRoundReplayMatch[1],
        Number(serviceRoundReplayMatch[2]),
        serviceRoundReplayMatch[3] as 'authorize' | 'settle',
      );
    }
    if (serviceCompleteMatch) {
      return await handleServiceComplete(context, serviceCompleteMatch[1]);
    }
    if (serviceCompleteReplayMatch) {
      return await handleServiceCompleteReplay(context, serviceCompleteReplayMatch[1]);
    }
    return await handleServiceFail(context, serviceFailMatch![1]);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Compatibility alias for the earlier controlled K0 evidence harness. */
export const tryHandleHostedAgentK0 = tryHandleHostedAgent;
