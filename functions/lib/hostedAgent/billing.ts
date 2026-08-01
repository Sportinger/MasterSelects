import {
  authorizeHostedChatRound,
  getHostedChatRoundByIdempotencyKey,
  getHostedChatTurn,
  HostedChatBillingError,
  HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
  replayHostedChatRound,
  settleHostedChatRound,
  type HostedChatTurnRow,
} from '../chatBilling';
import { getCreditBalance } from '../credits';
import type { AppD1Database } from '../env';
import { getModelCreditCost } from '../modelPricing';
import {
  HOSTED_AGENT_MAXIMUM_ITERATIONS,
  HOSTED_AGENT_PROTOCOL_VERSION,
  hostedAgentRoundIdempotencyKey,
  type HostedAgentProviderProtocol,
  type HostedAgentRoundAuthorizationResponse,
  type HostedAgentRoundSettlementRequest,
  type HostedAgentRoundSettlementResponse,
  type HostedAgentTurnCompletionResponse,
  type HostedAgentTurnRequest,
} from '../../../src/services/kernelClient/hostedAgent/contracts';
import type {
  HostedAgentFastV2AssertionClaims,
  HostedAgentFastV2EdgePins,
  HostedAgentFastV2StartRequest,
} from '../../../src/services/kernelClient/hostedAgent/fastV2StartContract';
import {
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  hostedAgentFastV2RoundIdempotencyKey,
} from '../../../src/services/kernelClient/hostedAgent/fastV2StartContract';

const BILLING_TURN_PREFIX = 'hosted-agent:';

export interface HostedAgentK0TurnRow {
  accepted_max_spend_credits: number;
  assertion_nonce: string;
  billing_turn_id: string;
  client_instance_id: string;
  completed_at: string | null;
  created_at: string;
  history_format_version: string;
  maximum_iterations: number;
  model: string;
  prompt_version: string;
  protocol_version: string;
  provider_protocol: HostedAgentProviderProtocol;
  requested_max_spend_credits: number;
  session_id: string;
  status: 'active' | 'completed' | 'cancelled' | 'provider_failed';
  tool_schema_version: string;
  tool_execution_mode: HostedAgentTurnRequest['toolExecutionMode'];
  turn_id: string;
  updated_at: string;
  user_id: string;
}

export interface HostedAgentTurnBillingIdentity {
  clientInstanceId: string;
  historyFormatVersion: string;
  maximumIterations: number;
  model: string;
  promptVersion: string;
  protocolVersion: string;
  providerProtocol: HostedAgentProviderProtocol;
  requestedMaxSpendCredits: number;
  toolExecutionMode: HostedAgentTurnRequest['toolExecutionMode'];
  toolSchemaVersion: string;
  turnId: string;
}

export interface HostedAgentFastV2BindingRow {
  browser_request_digest: string;
  budget_policy_version: string;
  capability_bundle_version: string;
  created_at: string;
  editor_build_id: string;
  execution_contract_digest: string;
  execution_contract_version: string;
  execution_profile: 'fast' | 'verified';
  model_policy_version: string;
  prompt_version: string;
  snapshot_state_fingerprint: string;
  snapshot_timeline_revision: number;
  turn_id: string;
}

export interface HostedAgentServiceBillingClaims {
  clientInstanceId: string;
  maximumIterations: number;
  maxTurnSpendCredits: number;
  model: string;
  nonce: string;
  protocolVersion: string;
  providerProtocol: HostedAgentProviderProtocol;
  sessionId: string;
  sub: string;
  toolExecutionMode: HostedAgentTurnRequest['toolExecutionMode'];
  turnId: string;
}

export class HostedAgentK0BillingError extends Error {
  readonly code:
    | 'billing_conflict'
    | 'insufficient_credits'
    | 'invalid_claims'
    | 'iteration_limit'
    | 'round_conflict'
    | 'turn_spend_limit';

  constructor(
    code:
      | 'billing_conflict'
      | 'insufficient_credits'
      | 'invalid_claims'
      | 'iteration_limit'
      | 'round_conflict'
      | 'turn_spend_limit',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'HostedAgentK0BillingError';
  }
}

function translateHostedBillingError(error: unknown): never {
  if (!(error instanceof HostedChatBillingError)) {
    throw error;
  }
  const code = error.code === 'insufficient_credits'
    ? 'insufficient_credits'
    : error.code === 'turn_spend_limit_exceeded'
      ? 'turn_spend_limit'
      : error.code === 'round_in_progress'
        ? 'round_conflict'
        : 'billing_conflict';
  throw new HostedAgentK0BillingError(code, error.message);
}

const HOSTED_TURN_SELECT = `SELECT turn_id, billing_turn_id, user_id, session_id,
                                   client_instance_id, model, provider_protocol,
                                   protocol_version, requested_max_spend_credits,
                                   accepted_max_spend_credits, maximum_iterations,
                                   prompt_version, history_format_version,
                                   tool_schema_version, tool_execution_mode,
                                   assertion_nonce, status,
                                   created_at, updated_at, completed_at
                            FROM hosted_agent_k0_turns`;

export async function getHostedAgentK0Turn(
  db: AppD1Database,
  userId: string,
  turnId: string,
): Promise<HostedAgentK0TurnRow | null> {
  return db
    .prepare(
      `${HOSTED_TURN_SELECT}
       WHERE turn_id = ? AND user_id = ?
       LIMIT 1`,
    )
    .bind(turnId, userId)
    .first<HostedAgentK0TurnRow>();
}

export async function getHostedAgentK0TurnForService(
  db: AppD1Database,
  turnId: string,
): Promise<HostedAgentK0TurnRow | null> {
  return db
    .prepare(
      `${HOSTED_TURN_SELECT}
       WHERE turn_id = ?
       LIMIT 1`,
    )
    .bind(turnId)
    .first<HostedAgentK0TurnRow>();
}

const FAST_V2_BINDING_SELECT = `SELECT turn_id, browser_request_digest,
                                       editor_build_id, execution_contract_version,
                                       execution_contract_digest, execution_profile,
                                       snapshot_timeline_revision,
                                       snapshot_state_fingerprint, prompt_version,
                                       capability_bundle_version, model_policy_version,
                                       budget_policy_version, created_at
                                FROM hosted_agent_fast_v2_bindings`;

export async function getHostedAgentFastV2Binding(
  db: AppD1Database,
  turnId: string,
): Promise<HostedAgentFastV2BindingRow | null> {
  return db.prepare(
    `${FAST_V2_BINDING_SELECT}
     WHERE turn_id = ?
     LIMIT 1`,
  ).bind(turnId).first<HostedAgentFastV2BindingRow>();
}

function fastV2BindingMatches(input: {
  browserRequest: HostedAgentFastV2StartRequest;
  browserRequestDigest: string;
  edge: HostedAgentFastV2EdgePins;
}, binding: HostedAgentFastV2BindingRow): boolean {
  return binding.browser_request_digest === input.browserRequestDigest
    && binding.editor_build_id === input.browserRequest.editorBuildId
    && binding.execution_contract_version === input.browserRequest.executionContractVersion
    && binding.execution_contract_digest === input.browserRequest.executionContractDigest
    && binding.execution_profile === input.edge.executionProfile
    && binding.execution_profile === (input.browserRequest.executionProfile ?? 'fast')
    && binding.snapshot_timeline_revision === input.browserRequest.compactSnapshot.timelineRevision
    && binding.snapshot_state_fingerprint === input.browserRequest.compactSnapshot.stateFingerprint
    && binding.prompt_version === input.edge.promptVersion
    && binding.capability_bundle_version === input.edge.capabilityBundleVersion
    && binding.model_policy_version === input.edge.modelPolicyVersion
    && binding.budget_policy_version === input.edge.budgetPolicyVersion;
}

export async function bindHostedAgentFastV2Turn(
  db: AppD1Database,
  input: {
    browserRequest: HostedAgentFastV2StartRequest;
    browserRequestDigest: string;
    edge: HostedAgentFastV2EdgePins;
  },
): Promise<HostedAgentFastV2BindingRow> {
  await db.prepare(
    `INSERT OR IGNORE INTO hosted_agent_fast_v2_bindings (
       turn_id, browser_request_digest, editor_build_id,
       execution_contract_version, execution_contract_digest,
       execution_profile,
       snapshot_timeline_revision, snapshot_state_fingerprint,
       prompt_version, capability_bundle_version, model_policy_version,
       budget_policy_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.browserRequest.turnId,
    input.browserRequestDigest,
    input.browserRequest.editorBuildId,
    input.browserRequest.executionContractVersion,
    input.browserRequest.executionContractDigest,
    input.edge.executionProfile,
    input.browserRequest.compactSnapshot.timelineRevision,
    input.browserRequest.compactSnapshot.stateFingerprint,
    input.edge.promptVersion,
    input.edge.capabilityBundleVersion,
    input.edge.modelPolicyVersion,
    input.edge.budgetPolicyVersion,
  ).run();
  const binding = await getHostedAgentFastV2Binding(db, input.browserRequest.turnId);
  if (!binding || !fastV2BindingMatches(input, binding)) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The Fast V2 turn binding conflicts with an existing request.',
    );
  }
  return binding;
}

export async function resolveHostedAgentFastV2BillingClaims(
  db: AppD1Database,
  claims: HostedAgentFastV2AssertionClaims,
): Promise<HostedAgentServiceBillingClaims> {
  const turn = await getHostedAgentK0TurnForService(db, claims.turnId);
  const binding = await getHostedAgentFastV2Binding(db, claims.turnId);
  if (
    !turn
    || !binding
    || turn.user_id !== claims.sub
    || turn.session_id !== claims.sessionId
    || turn.client_instance_id !== claims.clientInstanceId
    || turn.protocol_version !== claims.protocolVersion
    || turn.accepted_max_spend_credits !== claims.maxTurnSpendCredits
    || turn.maximum_iterations !== claims.maximumIterations
    || turn.assertion_nonce !== claims.nonce
    || binding.browser_request_digest !== claims.browserRequestDigest
    || binding.editor_build_id !== claims.editorBuildId
    || binding.execution_contract_version !== claims.executionContractVersion
    || binding.execution_contract_digest !== claims.executionContractDigest
    || binding.execution_profile !== (claims.executionProfile ?? 'fast')
    || binding.snapshot_timeline_revision !== claims.snapshotTimelineRevision
    || binding.snapshot_state_fingerprint !== claims.snapshotStateFingerprint
    || binding.prompt_version !== claims.promptVersion
    || binding.capability_bundle_version !== claims.capabilityBundleVersion
    || binding.model_policy_version !== claims.modelPolicyVersion
    || binding.budget_policy_version !== claims.budgetPolicyVersion
  ) {
    throw new HostedAgentK0BillingError(
      'invalid_claims',
      'The signed Fast V2 identity does not match its durable D1 binding.',
    );
  }
  const billingClaims: HostedAgentServiceBillingClaims = {
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
  await assertHostedAgentClaimsMatchD1(db, billingClaims, { allowTerminal: true });
  return billingClaims;
}

function billingTurnId(turnId: string): string {
  return `${BILLING_TURN_PREFIX}${turnId}`;
}

function turnMatchesRequest(
  turn: HostedAgentK0TurnRow,
  userId: string,
  identity: HostedAgentTurnBillingIdentity,
): boolean {
  return turn.user_id === userId
    && turn.client_instance_id === identity.clientInstanceId
    && turn.model === identity.model
    && turn.provider_protocol === identity.providerProtocol
    && turn.protocol_version === identity.protocolVersion
    && turn.requested_max_spend_credits === identity.requestedMaxSpendCredits
    && turn.maximum_iterations === identity.maximumIterations
    && turn.prompt_version === identity.promptVersion
    && turn.history_format_version === identity.historyFormatVersion
    && turn.tool_schema_version === identity.toolSchemaVersion
    && turn.tool_execution_mode === identity.toolExecutionMode;
}

export async function createHostedAgentTurnFromServerPolicy(
  db: AppD1Database,
  input: {
    identity: HostedAgentTurnBillingIdentity;
    maximumTurnSpendCredits?: number;
    userId: string;
  },
): Promise<{ replayed: boolean; turn: HostedAgentK0TurnRow }> {
  const existing = await getHostedAgentK0Turn(db, input.userId, input.identity.turnId);
  if (existing) {
    if (!turnMatchesRequest(existing, input.userId, input.identity)) {
      throw new HostedAgentK0BillingError(
        'billing_conflict',
        'The hosted-agent turn ID already belongs to a different turn.',
      );
    }
    // Exact terminal replays are read-only reconnects. This lets a page that
    // reloaded during the final provider round recover the durable terminal
    // event without authorizing or charging another round.
    return { replayed: true, turn: existing };
  }

  const balance = await getCreditBalance(db, input.userId);
  if (balance <= 0) {
    throw new HostedAgentK0BillingError(
      'insufficient_credits',
      'A positive D1 credit balance is required for a hosted-agent turn.',
    );
  }
  const acceptedMaximumSpend = Math.min(
    input.identity.requestedMaxSpendCredits,
    input.maximumTurnSpendCredits ?? HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
    Math.floor(balance),
  );
  const minimumRoundCost = getModelCreditCost(input.identity.model);
  if (acceptedMaximumSpend < minimumRoundCost) {
    throw new HostedAgentK0BillingError(
      'turn_spend_limit',
      'The requested turn budget is below the server-authoritative model round cost.',
    );
  }

  const now = new Date().toISOString();
  const hostedBillingTurnId = billingTurnId(input.identity.turnId);
  const sessionId = `ha_${crypto.randomUUID()}`;
  const assertionNonce = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO ai_chat_turns (
             id, user_id, model, protocol, status, provider_credits, credits_charged,
             max_spend_credits, next_round_index, terminal_reason,
             created_at, updated_at, completed_at
           )
           SELECT ?, ?, ?, ?, 'active', 0, 0, ?, 0, NULL, ?, ?, NULL
           WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
        )
        .bind(
          hostedBillingTurnId,
          input.userId,
          input.identity.model,
          input.identity.providerProtocol,
          acceptedMaximumSpend,
          now,
          now,
          input.userId,
        ),
      db
        .prepare(
          `INSERT INTO hosted_agent_k0_turns (
             turn_id, billing_turn_id, user_id, session_id, client_instance_id,
             model, provider_protocol, protocol_version,
             requested_max_spend_credits, accepted_max_spend_credits,
             maximum_iterations, prompt_version, history_format_version,
              tool_schema_version, tool_execution_mode, assertion_nonce, status,
             created_at, updated_at, completed_at
           )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
        )
        .bind(
          input.identity.turnId,
          hostedBillingTurnId,
          input.userId,
          sessionId,
          input.identity.clientInstanceId,
          input.identity.model,
          input.identity.providerProtocol,
          input.identity.protocolVersion,
          input.identity.requestedMaxSpendCredits,
          acceptedMaximumSpend,
          input.identity.maximumIterations,
          input.identity.promptVersion,
          input.identity.historyFormatVersion,
          input.identity.toolSchemaVersion,
          input.identity.toolExecutionMode,
          assertionNonce,
          now,
          now,
        ),
    ]);
  } catch {
    // A concurrent idempotent starter may have won. Resolve the durable rows below.
  }

  const created = await getHostedAgentK0Turn(db, input.userId, input.identity.turnId);
  if (
    !created
    || created.status !== 'active'
    || !turnMatchesRequest(created, input.userId, input.identity)
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn could not be created atomically.',
    );
  }
  const billingTurn = await getHostedChatTurn(db, input.userId, created.billing_turn_id);
  if (
    !billingTurn
    || billingTurn.max_spend_credits !== created.accepted_max_spend_credits
    || billingTurn.model !== created.model
    || billingTurn.protocol !== created.provider_protocol
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn has no matching authoritative billing turn.',
    );
  }
  return { replayed: false, turn: created };
}

export async function createHostedAgentK0Turn(
  db: AppD1Database,
  input: {
    maximumTurnSpendCredits?: number;
    providerProtocol: HostedAgentProviderProtocol;
    request: HostedAgentTurnRequest;
    userId: string;
  },
): Promise<{ replayed: boolean; turn: HostedAgentK0TurnRow }> {
  return createHostedAgentTurnFromServerPolicy(db, {
    identity: {
      clientInstanceId: input.request.clientInstanceId,
      historyFormatVersion: input.request.historyFormatVersion,
      maximumIterations: HOSTED_AGENT_MAXIMUM_ITERATIONS,
      model: input.request.model,
      promptVersion: input.request.promptVersion,
      protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
      providerProtocol: input.providerProtocol,
      requestedMaxSpendCredits: input.request.maxTurnSpendCredits,
      toolExecutionMode: input.request.toolExecutionMode,
      toolSchemaVersion: input.request.toolSchemaVersion,
      turnId: input.request.turnId,
    },
    ...(input.maximumTurnSpendCredits === undefined
      ? {}
      : { maximumTurnSpendCredits: input.maximumTurnSpendCredits }),
    userId: input.userId,
  });
}

export async function assertHostedAgentClaimsMatchD1(
  db: AppD1Database,
  claims: HostedAgentServiceBillingClaims,
  options: { allowTerminal?: boolean } = {},
): Promise<{ billingTurn: HostedChatTurnRow; turn: HostedAgentK0TurnRow }> {
  const turn = await getHostedAgentK0TurnForService(db, claims.turnId);
  if (
    !turn
    || turn.user_id !== claims.sub
    || turn.session_id !== claims.sessionId
    || turn.client_instance_id !== claims.clientInstanceId
    || turn.model !== claims.model
    || turn.provider_protocol !== claims.providerProtocol
    || turn.protocol_version !== claims.protocolVersion
    || turn.accepted_max_spend_credits !== claims.maxTurnSpendCredits
    || turn.maximum_iterations !== claims.maximumIterations
    || turn.tool_execution_mode !== claims.toolExecutionMode
    || turn.assertion_nonce !== claims.nonce
    || (!options.allowTerminal && turn.status !== 'active')
  ) {
    throw new HostedAgentK0BillingError(
      'invalid_claims',
      'The signed service identity does not match the D1 hosted-agent turn.',
    );
  }

  const billingTurn = await getHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  if (
    !billingTurn
    || billingTurn.user_id !== claims.sub
    || billingTurn.model !== claims.model
    || billingTurn.protocol !== claims.providerProtocol
    || billingTurn.max_spend_credits !== claims.maxTurnSpendCredits
    || (!options.allowTerminal && billingTurn.status !== 'active')
  ) {
    throw new HostedAgentK0BillingError(
      'invalid_claims',
      'The signed service identity does not match the authoritative D1 billing turn.',
    );
  }
  return { billingTurn, turn };
}

function validateRoundIdentity(
  turn: HostedAgentK0TurnRow,
  roundIndex: number,
  idempotencyKey: string,
): void {
  if (
    !Number.isInteger(roundIndex)
    || roundIndex < 0
    || roundIndex >= turn.maximum_iterations
  ) {
    throw new HostedAgentK0BillingError(
      'iteration_limit',
      'The server-authoritative hosted-agent iteration limit has been reached.',
    );
  }
  const expectedIdempotencyKey = turn.protocol_version === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    ? hostedAgentFastV2RoundIdempotencyKey(turn.turn_id, roundIndex)
    : hostedAgentRoundIdempotencyKey(turn.turn_id, roundIndex);
  if (idempotencyKey !== expectedIdempotencyKey) {
    throw new HostedAgentK0BillingError(
      'round_conflict',
      'The provider-round idempotency key does not match the signed turn.',
    );
  }
}

export async function authorizeHostedAgentK0Round(
  db: AppD1Database,
  claims: HostedAgentServiceBillingClaims,
  input: { idempotencyKey: string; roundIndex: number },
  options: { replayOnly?: boolean } = {},
): Promise<HostedAgentRoundAuthorizationResponse> {
  const { turn } = await assertHostedAgentClaimsMatchD1(db, claims);
  validateRoundIdentity(turn, input.roundIndex, input.idempotencyKey);
  if (options.replayOnly) {
    const durableRound = await getHostedChatRoundByIdempotencyKey(
      db,
      turn.user_id,
      input.idempotencyKey,
    );
    if (!durableRound) {
      throw new HostedAgentK0BillingError(
        'round_conflict',
        'The provider-round authorization has no durable replay.',
      );
    }
  }
  const authorization = await authorizeHostedChatRound(db, {
    idempotencyKey: input.idempotencyKey,
    model: turn.model,
    protocol: turn.provider_protocol,
    roundIndex: input.roundIndex,
    turnId: turn.billing_turn_id,
    userId: turn.user_id,
  });
  if (!authorization.ok) {
    const code = authorization.code === 'insufficient_credits'
      ? 'insufficient_credits'
      : authorization.code === 'turn_spend_limit_exceeded'
        ? 'turn_spend_limit'
        : 'round_conflict';
    throw new HostedAgentK0BillingError(code, authorization.message);
  }

  return {
    billingTurnId: turn.billing_turn_id,
    idempotencyKey: input.idempotencyKey,
    maximumIterations: turn.maximum_iterations,
    remainingTurnSpendCredits: Math.max(
      0,
      authorization.turn.max_spend_credits - authorization.turn.credits_charged,
    ),
    replayed: authorization.duplicateRound !== null,
    roundIndex: input.roundIndex,
    status: authorization.duplicateRound?.status === 'settled' ? 'settled' : 'authorized',
    turnId: turn.turn_id,
  };
}

function finiteOptionalInteger(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

function storedProviderResultDigest(responseJson: string | null): string | null {
  if (!responseJson) {
    return null;
  }
  try {
    const response = JSON.parse(responseJson) as {
      hosted_agent_k0?: { provider_result_digest?: unknown };
    };
    const digest = response.hosted_agent_k0?.provider_result_digest;
    return typeof digest === 'string' ? digest : null;
  } catch {
    return null;
  }
}

export async function settleHostedAgentK0Round(
  db: AppD1Database,
  claims: HostedAgentServiceBillingClaims,
  input: HostedAgentRoundSettlementRequest,
  options: { replayOnly?: boolean } = {},
): Promise<HostedAgentRoundSettlementResponse> {
  const { billingTurn, turn } = await assertHostedAgentClaimsMatchD1(db, claims);
  validateRoundIdentity(turn, input.roundIndex, input.idempotencyKey);
  const durableRound = await getHostedChatRoundByIdempotencyKey(
    db,
    turn.user_id,
    input.idempotencyKey,
  );
  if (!durableRound) {
    throw new HostedAgentK0BillingError(
      'round_conflict',
      'The provider round has no D1 authorization claim.',
    );
  }
  if (options.replayOnly && durableRound.status !== 'settled') {
    throw new HostedAgentK0BillingError(
      'round_conflict',
      'The provider-round settlement has no durable replay.',
    );
  }
  if (
    durableRound.status === 'settled'
    && storedProviderResultDigest(durableRound.response_json) !== input.providerResultDigest
  ) {
    throw new HostedAgentK0BillingError(
      'round_conflict',
      'The settled provider round belongs to a different result digest.',
    );
  }

  const billingPayload = {
    credits_consumed: input.providerCredits,
    hosted_agent_k0: {
      provider_result_digest: input.providerResultDigest,
      redaction: 'usage-and-digest-only',
      tool_call_count: input.toolCallCount,
    },
    usage: {
      input_tokens: finiteOptionalInteger(input.inputTokens),
      input_tokens_details: {
        cached_tokens: finiteOptionalInteger(input.cachedInputTokens),
      },
      output_tokens: finiteOptionalInteger(input.outputTokens),
      output_tokens_details: {
        reasoning_tokens: finiteOptionalInteger(input.reasoningTokens),
      },
    },
  };
  let settlement;
  try {
    settlement = durableRound.status === 'settled'
      ? await replayHostedChatRound(db, turn.user_id, durableRound)
      : await settleHostedChatRound(db, {
          fallbackRoundCredits: getModelCreditCost(turn.model),
          idempotencyKey: input.idempotencyKey,
          model: turn.model,
          payload: billingPayload,
          roundIndex: input.roundIndex,
          terminalAction: 'continue',
          turn: billingTurn,
          userId: turn.user_id,
        });
  } catch (error) {
    translateHostedBillingError(error);
  }

  return {
    creditBalance: settlement.balance,
    creditsCharged: settlement.creditsCharged,
    idempotencyKey: input.idempotencyKey,
    ledgerEntryId: settlement.ledgerEntryId,
    replayed: settlement.replayed,
    roundIndex: input.roundIndex,
    totalCreditsCharged: settlement.totalCreditsCharged,
    turnId: turn.turn_id,
    turnStatus: 'active',
  };
}

export async function completeHostedAgentK0Turn(
  db: AppD1Database,
  claims: HostedAgentServiceBillingClaims,
  options: { replayOnly?: boolean } = {},
): Promise<HostedAgentTurnCompletionResponse> {
  const { billingTurn, turn } = await assertHostedAgentClaimsMatchD1(
    db,
    claims,
    { allowTerminal: true },
  );
  if (turn.status === 'completed' && billingTurn.status === 'completed') {
    return {
      creditsCharged: billingTurn.credits_charged,
      terminalReason: 'explicit_complete',
      turnId: turn.turn_id,
      turnStatus: 'completed',
    };
  }
  if (options.replayOnly) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent completion has no durable replay.',
    );
  }
  if (
    turn.status !== 'active'
    || !['active', 'completed'].includes(billingTurn.status)
    || billingTurn.next_round_index < 1
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn cannot complete before one settled provider round.',
    );
  }

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE ai_chat_turns
       SET status = 'completed', terminal_reason = 'explicit_complete',
           updated_at = ?, completed_at = ?
       WHERE id = ? AND user_id = ? AND status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM ai_chat_turn_rounds
           WHERE turn_id = ? AND user_id = ? AND status = 'pending'
         )`,
    ).bind(
      now,
      now,
      turn.billing_turn_id,
      turn.user_id,
      turn.billing_turn_id,
      turn.user_id,
    ),
    db.prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'completed', updated_at = ?, completed_at = ?
       WHERE turn_id = ? AND user_id = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM ai_chat_turns
           WHERE id = ? AND user_id = ? AND status = 'completed'
         )`,
    ).bind(
      now,
      now,
      turn.turn_id,
      turn.user_id,
      turn.billing_turn_id,
      turn.user_id,
    ),
  ]);
  const completed = await getHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  const hostedCompleted = await getHostedAgentK0Turn(db, turn.user_id, turn.turn_id);
  if (
    !completed
    || completed.status !== 'completed'
    || !hostedCompleted
    || hostedCompleted.status !== 'completed'
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The billing and hosted-agent terminal markers did not complete atomically.',
    );
  }
  return {
    creditsCharged: completed.credits_charged,
    terminalReason: 'explicit_complete',
    turnId: turn.turn_id,
    turnStatus: 'completed',
  };
}

export async function cancelHostedAgentK0Turn(
  db: AppD1Database,
  turn: HostedAgentK0TurnRow,
): Promise<void> {
  if (!['active', 'cancelled'].includes(turn.status)) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn is already terminal.',
    );
  }
  await terminateHostedAgentK0Turn(db, turn, 'cancelled', 'explicit_cancel');
}

async function terminateHostedAgentK0Turn(
  db: AppD1Database,
  turn: HostedAgentK0TurnRow,
  status: 'cancelled' | 'provider_failed',
  terminalReason: 'explicit_cancel' | 'provider_failed',
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE ai_chat_turn_rounds
       SET status = ?, settled_at = COALESCE(settled_at, ?)
       WHERE turn_id = ? AND user_id = ? AND status = 'pending'`,
    ).bind(status, now, turn.billing_turn_id, turn.user_id),
    db.prepare(
      `UPDATE ai_chat_turns
       SET status = ?, terminal_reason = ?, updated_at = ?, completed_at = ?
       WHERE id = ? AND user_id = ? AND status = 'active'`,
    ).bind(
      status,
      terminalReason,
      now,
      now,
      turn.billing_turn_id,
      turn.user_id,
    ),
    db.prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = ?, updated_at = ?, completed_at = ?
       WHERE turn_id = ? AND user_id = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM ai_chat_turns
           WHERE id = ? AND user_id = ? AND status = ?
         )`,
    ).bind(
      status,
      now,
      now,
      turn.turn_id,
      turn.user_id,
      turn.billing_turn_id,
      turn.user_id,
      status,
    ),
  ]);
  const billingTerminal = await getHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  const hostedTerminal = await getHostedAgentK0Turn(db, turn.user_id, turn.turn_id);
  if (
    !billingTerminal
    || billingTerminal.status !== status
    || !hostedTerminal
    || hostedTerminal.status !== status
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The billing and hosted-agent terminal markers did not complete atomically.',
    );
  }
}

export async function failHostedAgentTurn(
  db: AppD1Database,
  claims: HostedAgentServiceBillingClaims,
): Promise<{
  terminalReason: 'completed' | 'explicit_cancel' | 'provider_failed';
  turnId: string;
  turnStatus: 'cancelled' | 'completed' | 'provider_failed';
}> {
  const { billingTurn, turn } = await assertHostedAgentClaimsMatchD1(
    db,
    claims,
    { allowTerminal: true },
  );
  if (turn.status === 'cancelled' && billingTurn.status === 'cancelled') {
    return {
      terminalReason: 'explicit_cancel',
      turnId: turn.turn_id,
      turnStatus: 'cancelled',
    };
  }
  if (turn.status === 'completed' && billingTurn.status === 'completed') {
    return {
      terminalReason: 'completed',
      turnId: turn.turn_id,
      turnStatus: 'completed',
    };
  }
  if (
    !['active', 'provider_failed'].includes(turn.status)
    || !['active', 'provider_failed'].includes(billingTurn.status)
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn cannot be marked provider-failed from its current state.',
    );
  }
  await terminateHostedAgentK0Turn(db, turn, 'provider_failed', 'provider_failed');
  return {
    terminalReason: 'provider_failed',
    turnId: turn.turn_id,
    turnStatus: 'provider_failed',
  };
}
