import { json, methodNotAllowed } from '../db';
import type { AppContext, Env } from '../env';
import {
  HOSTED_CHAT_DEVELOPMENT_MAX_TURN_SPEND_CREDITS,
  HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
} from '../chatBilling';
import { getKieChatModelCapability } from '../providers/kieChat';
import {
  buildHostedAgentAssertionClaims,
  HostedAgentAssertionError,
  signHostedAgentServiceAssertion,
  verifyHostedAgentServiceAssertion,
} from './assertion';
import {
  assertHostedAgentClaimsMatchD1,
  authorizeHostedAgentK0Round,
  cancelHostedAgentK0Turn,
  completeHostedAgentK0Turn,
  createHostedAgentK0Turn,
  failHostedAgentTurn,
  getHostedAgentK0Turn,
  HostedAgentK0BillingError,
  settleHostedAgentK0Round,
  type HostedAgentK0TurnRow,
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
import { validHostedAgentInlineProviderContent } from '../../../src/services/kernelClient/hostedAgent/inlineProviderContent';

const MAX_START_BODY_BYTES = 1_500_000;
// Transport abuse guard only, not a product-level inline-result budget. K0 must
// measure real payloads before K1 freezes a semantic limit.
const MAX_TOOL_RESULT_BODY_BYTES = 32 * 1024 * 1024;
const MAX_SERVICE_BODY_BYTES = 32_000;
const MAX_TURN_ID_CHARACTERS = 160;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9._:-]+$/;
const EVENT_CURSOR_PATTERN = /^[A-Za-z0-9._:-]+$/;

interface HostedAgentRouteEnv extends Env {
  KERNEL_SERVICE_ASSERTION_SECRET?: string;
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

async function verifiedServiceClaims(context: AppContext, turnId: string) {
  validateServiceBearer(context.request, context.env);
  const assertion = context.request.headers.get(HOSTED_AGENT_HEADERS.serviceAssertion);
  if (!assertion || assertion.length > 8_192) {
    throw new HostedAgentRouteError(
      'service_assertion_required',
      'A signed hosted-agent service assertion is required.',
      401,
    );
  }
  const claims = await verifyHostedAgentServiceAssertion(
    assertion,
    assertionSecret(context.env),
  );
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
  return claims;
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

async function userTurn(context: AppContext, turnId: string): Promise<HostedAgentK0TurnRow> {
  const user = requireUser(context);
  const turn = await getHostedAgentK0Turn(context.env.DB, user.id, turnId);
  if (!turn) {
    throw new HostedAgentRouteError('turn_not_found', 'The hosted-agent turn was not found.', 404);
  }
  return turn;
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

async function handleServiceRound(
  context: AppContext,
  turnId: string,
  roundIndex: number,
  action: 'authorize' | 'settle',
): Promise<Response> {
  assertMethod(context, 'POST');
  const claims = await verifiedServiceClaims(context, turnId);
  const { parsed } = await readJsonBody(context.request, MAX_SERVICE_BODY_BYTES);
  const result = action === 'authorize'
    ? await authorizeHostedAgentK0Round(
        context.env.DB,
        claims,
        parseAuthorizationRequest(parsed, turnId, roundIndex),
      )
    : await settleHostedAgentK0Round(
        context.env.DB,
        claims,
        parseSettlementRequest(parsed, turnId, roundIndex),
      );
  return json(result, { headers: { 'Cache-Control': 'no-store' } });
}

async function handleServiceComplete(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const claims = await verifiedServiceClaims(context, turnId);
  return json(
    await completeHostedAgentK0Turn(context.env.DB, claims),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function handleServiceFail(context: AppContext, turnId: string): Promise<Response> {
  assertMethod(context, 'POST');
  const claims = await verifiedServiceClaims(context, turnId);
  return json(
    await failHostedAgentTurn(context.env.DB, claims),
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
  if (path === 'hosted-agent/turns') {
    try {
      return await handleStart(context);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const eventsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/events$/.exec(path);
  const resultsMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/tool-results$/.exec(path);
  const cancelMatch = /^hosted-agent\/turns\/([A-Za-z0-9:_-]+)\/cancel$/.exec(path);
  const serviceRoundMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9:_-]+)\/rounds\/(\d+)\/(authorize|settle)$/.exec(path);
  const serviceCompleteMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9:_-]+)\/complete$/.exec(path);
  const serviceFailMatch = /^hosted-agent\/service\/turns\/([A-Za-z0-9:_-]+)\/fail$/.exec(path);
  if (!eventsMatch && !resultsMatch && !cancelMatch && !serviceRoundMatch && !serviceCompleteMatch && !serviceFailMatch) {
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
    if (serviceCompleteMatch) {
      return await handleServiceComplete(context, serviceCompleteMatch[1]);
    }
    return await handleServiceFail(context, serviceFailMatch![1]);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Compatibility alias for the earlier controlled K0 evidence harness. */
export const tryHandleHostedAgentK0 = tryHandleHostedAgent;
