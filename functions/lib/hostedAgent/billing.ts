import {
  authorizeHostedChatRound,
  cancelHostedChatTurn,
  completeHostedChatTurn,
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
  type HostedAgentServiceAssertionClaims,
  type HostedAgentTurnCompletionResponse,
  type HostedAgentTurnRequest,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

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

function billingTurnId(turnId: string): string {
  return `${BILLING_TURN_PREFIX}${turnId}`;
}

function turnMatchesRequest(
  turn: HostedAgentK0TurnRow,
  userId: string,
  request: HostedAgentTurnRequest,
  providerProtocol: HostedAgentProviderProtocol,
): boolean {
  return turn.user_id === userId
    && turn.client_instance_id === request.clientInstanceId
    && turn.model === request.model
    && turn.provider_protocol === providerProtocol
    && turn.protocol_version === HOSTED_AGENT_PROTOCOL_VERSION
    && turn.requested_max_spend_credits === request.maxTurnSpendCredits
    && turn.maximum_iterations === HOSTED_AGENT_MAXIMUM_ITERATIONS
    && turn.prompt_version === request.promptVersion
    && turn.history_format_version === request.historyFormatVersion
    && turn.tool_schema_version === request.toolSchemaVersion
    && turn.tool_execution_mode === request.toolExecutionMode;
}

export async function createHostedAgentK0Turn(
  db: AppD1Database,
  input: {
    providerProtocol: HostedAgentProviderProtocol;
    request: HostedAgentTurnRequest;
    userId: string;
  },
): Promise<{ replayed: boolean; turn: HostedAgentK0TurnRow }> {
  const existing = await getHostedAgentK0Turn(db, input.userId, input.request.turnId);
  if (existing) {
    if (!turnMatchesRequest(existing, input.userId, input.request, input.providerProtocol)) {
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
    input.request.maxTurnSpendCredits,
    HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
    Math.floor(balance),
  );
  const minimumRoundCost = getModelCreditCost(input.request.model);
  if (acceptedMaximumSpend < minimumRoundCost) {
    throw new HostedAgentK0BillingError(
      'turn_spend_limit',
      'The requested turn budget is below the server-authoritative model round cost.',
    );
  }

  const now = new Date().toISOString();
  const hostedBillingTurnId = billingTurnId(input.request.turnId);
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
          input.request.model,
          input.providerProtocol,
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
          input.request.turnId,
          hostedBillingTurnId,
          input.userId,
          sessionId,
          input.request.clientInstanceId,
          input.request.model,
          input.providerProtocol,
          HOSTED_AGENT_PROTOCOL_VERSION,
          input.request.maxTurnSpendCredits,
          acceptedMaximumSpend,
          HOSTED_AGENT_MAXIMUM_ITERATIONS,
          input.request.promptVersion,
          input.request.historyFormatVersion,
          input.request.toolSchemaVersion,
          input.request.toolExecutionMode,
          assertionNonce,
          now,
          now,
        ),
    ]);
  } catch {
    // A concurrent idempotent starter may have won. Resolve the durable rows below.
  }

  const created = await getHostedAgentK0Turn(db, input.userId, input.request.turnId);
  if (
    !created
    || created.status !== 'active'
    || !turnMatchesRequest(created, input.userId, input.request, input.providerProtocol)
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

export async function assertHostedAgentClaimsMatchD1(
  db: AppD1Database,
  claims: HostedAgentServiceAssertionClaims,
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
  if (idempotencyKey !== hostedAgentRoundIdempotencyKey(turn.turn_id, roundIndex)) {
    throw new HostedAgentK0BillingError(
      'round_conflict',
      'The provider-round idempotency key does not match the signed turn.',
    );
  }
}

export async function authorizeHostedAgentK0Round(
  db: AppD1Database,
  claims: HostedAgentServiceAssertionClaims,
  input: { idempotencyKey: string; roundIndex: number },
): Promise<HostedAgentRoundAuthorizationResponse> {
  const { turn } = await assertHostedAgentClaimsMatchD1(db, claims);
  validateRoundIdentity(turn, input.roundIndex, input.idempotencyKey);
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
  claims: HostedAgentServiceAssertionClaims,
  input: HostedAgentRoundSettlementRequest,
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
    replayed: settlement.replayed,
    roundIndex: input.roundIndex,
    totalCreditsCharged: settlement.totalCreditsCharged,
    turnId: turn.turn_id,
    turnStatus: 'active',
  };
}

export async function completeHostedAgentK0Turn(
  db: AppD1Database,
  claims: HostedAgentServiceAssertionClaims,
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
  if (
    turn.status !== 'active'
    || billingTurn.status !== 'active'
    || billingTurn.next_round_index < 1
  ) {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn cannot complete before one settled provider round.',
    );
  }

  let completed: HostedChatTurnRow;
  try {
    completed = await completeHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  } catch (error) {
    translateHostedBillingError(error);
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'completed', updated_at = ?, completed_at = ?
       WHERE turn_id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(now, now, turn.turn_id, turn.user_id)
    .run();
  const hostedCompleted = await getHostedAgentK0Turn(db, turn.user_id, turn.turn_id);
  if (!hostedCompleted || hostedCompleted.status !== 'completed') {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The billing turn completed but the hosted-agent terminal marker is missing.',
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
  if (turn.status === 'cancelled') {
    return;
  }
  if (turn.status !== 'active') {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn is already terminal.',
    );
  }
  try {
    await cancelHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  } catch (error) {
    translateHostedBillingError(error);
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'cancelled', updated_at = ?, completed_at = ?
       WHERE turn_id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(now, now, turn.turn_id, turn.user_id)
    .run();
}

export async function failHostedAgentTurn(
  db: AppD1Database,
  claims: HostedAgentServiceAssertionClaims,
): Promise<{
  terminalReason: 'provider_failed';
  turnId: string;
  turnStatus: 'provider_failed';
}> {
  const { billingTurn, turn } = await assertHostedAgentClaimsMatchD1(
    db,
    claims,
    { allowTerminal: true },
  );
  if (turn.status === 'provider_failed') {
    return {
      terminalReason: 'provider_failed',
      turnId: turn.turn_id,
      turnStatus: 'provider_failed',
    };
  }
  if (turn.status !== 'active' || billingTurn.status !== 'active') {
    throw new HostedAgentK0BillingError(
      'billing_conflict',
      'The hosted-agent turn cannot be marked provider-failed from its current state.',
    );
  }
  try {
    await cancelHostedChatTurn(db, turn.user_id, turn.billing_turn_id);
  } catch (error) {
    translateHostedBillingError(error);
  }
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'provider_failed', updated_at = ?, completed_at = ?
       WHERE turn_id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(now, now, turn.turn_id, turn.user_id)
    .run();
  return {
    terminalReason: 'provider_failed',
    turnId: turn.turn_id,
    turnStatus: 'provider_failed',
  };
}
