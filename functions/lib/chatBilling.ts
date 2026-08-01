import {
  getCreditBalance,
  getCreditLedgerEntryBySource,
} from './credits';
import type { AppD1Database } from './env';
import { HOSTED_KIE_CREDIT_MULTIPLIER } from './kieai';
import type { KieChatProtocol } from './providers/kieChat';

const MAX_CHAT_TURN_ID_LENGTH = 200;
export const MAX_CHAT_TURN_ROUNDS = 400;
export const HOSTED_CHAT_MAX_TURN_SPEND_CREDITS = 500;
export const HOSTED_CHAT_DEVELOPMENT_MAX_TURN_SPEND_CREDITS = 2_000;
const FLOATING_POINT_ROUNDING_EPSILON = 1e-9;

export type HostedChatTurnStatus = 'active' | 'completed' | 'cancelled' | 'provider_failed';
export type HostedChatRoundStatus = 'pending' | 'settled' | 'cancelled' | 'provider_failed';
export type HostedChatRoundTerminalAction = 'auto' | 'continue' | 'complete';
export type HostedChatTurnAction = 'complete' | 'cancel';

export interface HostedChatTurnRow {
  completed_at: string | null;
  created_at: string;
  credits_charged: number;
  id: string;
  max_spend_credits: number;
  model: string;
  next_round_index: number;
  protocol: KieChatProtocol;
  provider_credits: number;
  status: HostedChatTurnStatus;
  terminal_reason: string | null;
  updated_at: string;
  user_id: string;
}

export interface HostedChatTurnRoundRow {
  cached_input_tokens: number | null;
  created_at: string;
  credits_charged: number;
  has_more_tools: number;
  id: string;
  idempotency_key: string;
  input_tokens: number | null;
  ledger_entry_id: string | null;
  output_tokens: number | null;
  provider_credits: number | null;
  reasoning_tokens: number | null;
  response_json: string | null;
  round_index: number;
  settled_at: string | null;
  status: HostedChatRoundStatus;
  tool_call_count: number;
  total_credits_charged: number | null;
  total_provider_credits: number | null;
  turn_id: string;
  user_id: string;
}

export interface KieChatProviderUsage {
  cachedInputTokens: number | null;
  hasMoreTools: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCredits: number | null;
  reasoningTokens: number | null;
  toolCallCount: number;
}

export interface HostedChatRoundIdentity {
  roundIndex: number;
  turnId: string;
}

export type HostedChatRoundAuthorization =
  | {
      balance: number;
      duplicateRound: HostedChatTurnRoundRow | null;
      ok: true;
      turn: HostedChatTurnRow;
    }
  | {
      balance: number;
      code:
        | 'insufficient_credits'
        | 'round_in_progress'
        | 'turn_conflict'
        | 'turn_spend_limit_exceeded';
      message: string;
      ok: false;
    };

export interface HostedChatRoundSettlement {
  balance: number;
  creditsCharged: number;
  ledgerEntryId: string | null;
  providerCredits: number | null;
  replayed: boolean;
  response: unknown;
  totalCreditsCharged: number;
  totalProviderCredits: number;
  turnCompleted: boolean;
  usage: KieChatProviderUsage;
}

export class HostedChatBillingError extends Error {
  readonly code:
    | 'insufficient_credits'
    | 'round_in_progress'
    | 'settlement_conflict'
    | 'turn_conflict'
    | 'turn_spend_limit_exceeded';

  constructor(
    code:
      | 'insufficient_credits'
      | 'round_in_progress'
      | 'settlement_conflict'
      | 'turn_conflict'
      | 'turn_spend_limit_exceeded',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'HostedChatBillingError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const number = finiteNonNegativeNumber(value);
  return number === null || !Number.isInteger(number) ? null : number;
}

function serializeReplayPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload) ?? 'null';
  } catch {
    throw new HostedChatBillingError(
      'settlement_conflict',
      'The hosted AI response could not be stored for idempotent replay.',
    );
  }
}

export function deserializeHostedChatRoundResponse(round: HostedChatTurnRoundRow): unknown {
  if (round.status !== 'settled' || round.response_json === null) {
    throw new HostedChatBillingError(
      round.status === 'pending' ? 'round_in_progress' : 'turn_conflict',
      round.status === 'pending'
        ? 'This hosted AI chat round is already in progress.'
        : 'This hosted AI chat round did not settle successfully.',
    );
  }

  try {
    return JSON.parse(round.response_json) as unknown;
  } catch {
    throw new HostedChatBillingError(
      'settlement_conflict',
      'The stored hosted AI response is unavailable for replay.',
    );
  }
}

export function resolveHostedChatRoundIdentity(
  body: Record<string, unknown> | null,
  requestId: string,
): HostedChatRoundIdentity | null {
  const suppliedTurnId = typeof body?.billingTurnId === 'string'
    ? body.billingTurnId.trim()
    : '';
  const turnId = suppliedTurnId || `single-chat:${requestId}`;
  const roundIndex = body?.billingRoundIndex === undefined
    ? 0
    : finiteNonNegativeInteger(body.billingRoundIndex);

  if (
    !turnId
    || turnId.length > MAX_CHAT_TURN_ID_LENGTH
    || !/^[a-zA-Z0-9:_-]+$/.test(turnId)
    || roundIndex === null
    || roundIndex >= MAX_CHAT_TURN_ROUNDS
  ) {
    return null;
  }

  return { roundIndex, turnId };
}

export function resolveHostedChatTurnAction(
  body: Record<string, unknown> | null,
): HostedChatTurnAction | null {
  return body?.billingTurnAction === 'complete' || body?.billingTurnAction === 'cancel'
    ? body.billingTurnAction
    : null;
}

export function resolveHostedChatRoundTerminalAction(
  body: Record<string, unknown> | null,
): HostedChatRoundTerminalAction {
  return body?.billingTurnAction === 'continue' || body?.billingTurnAction === 'complete'
    ? body.billingTurnAction
    : 'auto';
}

export function extractKieChatProviderUsage(payload: unknown): KieChatProviderUsage {
  const response = isRecord(payload) ? payload : {};
  const usage = isRecord(response.usage) ? response.usage : {};
  const hostedAgentUsage = isRecord(response.hosted_agent_k0)
    ? response.hosted_agent_k0
    : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const openAiToolCalls = Array.isArray(response.output)
    ? response.output.filter((item) => isRecord(item) && item.type === 'function_call')
    : [];
  const claudeToolCalls = Array.isArray(response.content)
    ? response.content.filter((item) => isRecord(item) && item.type === 'tool_use')
    : [];
  const toolCallCount = finiteNonNegativeInteger(hostedAgentUsage.tool_call_count)
    ?? openAiToolCalls.length + claudeToolCalls.length;

  return {
    cachedInputTokens: finiteNonNegativeInteger(inputDetails.cached_tokens)
      ?? finiteNonNegativeInteger(usage.cache_read_input_tokens),
    hasMoreTools: toolCallCount > 0,
    inputTokens: finiteNonNegativeInteger(usage.input_tokens)
      ?? finiteNonNegativeInteger(usage.prompt_tokens),
    outputTokens: finiteNonNegativeInteger(usage.output_tokens)
      ?? finiteNonNegativeInteger(usage.completion_tokens),
    providerCredits: finiteNonNegativeNumber(response.credits_consumed),
    reasoningTokens: finiteNonNegativeInteger(outputDetails.reasoning_tokens),
    toolCallCount,
  };
}

export function calculateHostedChatCreditSettlement(input: {
  fallbackRoundCredits: number;
  previousCreditsCharged: number;
  previousProviderCredits: number;
  roundProviderCredits: number | null;
}): {
  creditsToCharge: number;
  totalCreditsCharged: number;
  totalProviderCredits: number;
} {
  const previousCreditsCharged = Math.max(0, Math.floor(input.previousCreditsCharged));
  const previousProviderCredits = Math.max(0, input.previousProviderCredits);
  const roundProviderCredits = input.roundProviderCredits === null
    ? null
    : Math.max(0, input.roundProviderCredits);
  const totalProviderCredits = previousProviderCredits + (roundProviderCredits ?? 0);
  const totalCreditsCharged = roundProviderCredits === null
    ? previousCreditsCharged + Math.max(1, Math.ceil(input.fallbackRoundCredits))
    : Math.max(
        previousCreditsCharged,
        Math.ceil(
          totalProviderCredits * HOSTED_KIE_CREDIT_MULTIPLIER
          - FLOATING_POINT_ROUNDING_EPSILON,
        ),
      );

  return {
    creditsToCharge: totalCreditsCharged - previousCreditsCharged,
    totalCreditsCharged,
    totalProviderCredits,
  };
}

export async function getHostedChatTurn(
  db: AppD1Database,
  userId: string,
  turnId: string,
): Promise<HostedChatTurnRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, model, protocol, status, provider_credits, credits_charged,
              max_spend_credits, next_round_index, terminal_reason,
              created_at, updated_at, completed_at
       FROM ai_chat_turns
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
    )
    .bind(turnId, userId)
    .first<HostedChatTurnRow>();
}

const ROUND_SELECT = `SELECT id, turn_id, user_id, round_index, idempotency_key, status,
                             provider_credits, credits_charged, total_provider_credits,
                             total_credits_charged, input_tokens, cached_input_tokens,
                             output_tokens, reasoning_tokens, tool_call_count, has_more_tools,
                             response_json, ledger_entry_id, created_at, settled_at
                      FROM ai_chat_turn_rounds`;

export async function getHostedChatRoundByIdempotencyKey(
  db: AppD1Database,
  userId: string,
  idempotencyKey: string,
): Promise<HostedChatTurnRoundRow | null> {
  return db
    .prepare(
      `${ROUND_SELECT}
       WHERE user_id = ? AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(userId, idempotencyKey)
    .first<HostedChatTurnRoundRow>();
}

async function getHostedChatRoundByIndex(
  db: AppD1Database,
  userId: string,
  turnId: string,
  roundIndex: number,
): Promise<HostedChatTurnRoundRow | null> {
  return db
    .prepare(
      `${ROUND_SELECT}
       WHERE user_id = ? AND turn_id = ? AND round_index = ?
       LIMIT 1`,
    )
    .bind(userId, turnId, roundIndex)
    .first<HostedChatTurnRoundRow>();
}

function authorizationForDuplicate(
  balance: number,
  duplicateRound: HostedChatTurnRoundRow,
  turn: HostedChatTurnRow,
  input: {
    model: string;
    protocol: KieChatProtocol;
    roundIndex: number;
    turnId: string;
  },
): HostedChatRoundAuthorization {
  if (
    turn.id !== input.turnId
    || duplicateRound.round_index !== input.roundIndex
    || turn.model !== input.model
    || turn.protocol !== input.protocol
  ) {
    return {
      balance,
      code: 'turn_conflict',
      message: 'The idempotency key belongs to a different hosted AI chat round.',
      ok: false,
    };
  }

  return {
    balance,
    duplicateRound,
    ok: true,
    turn,
  };
}

export async function authorizeHostedChatRound(
  db: AppD1Database,
  input: {
    idempotencyKey: string;
    model: string;
    protocol: KieChatProtocol;
    roundIndex: number;
    turnId: string;
    userId: string;
  },
): Promise<HostedChatRoundAuthorization> {
  const currentBalance = await getCreditBalance(db, input.userId);
  let claimedByThisRequest = false;
  const duplicateRound = await getHostedChatRoundByIdempotencyKey(
    db,
    input.userId,
    input.idempotencyKey,
  );

  if (duplicateRound) {
    const duplicateTurn = await getHostedChatTurn(db, input.userId, duplicateRound.turn_id);
    return duplicateTurn
      ? authorizationForDuplicate(currentBalance, duplicateRound, duplicateTurn, input)
      : {
          balance: currentBalance,
          code: 'turn_conflict',
          message: 'The hosted AI chat turn for this round no longer exists.',
          ok: false,
        };
  }

  let turn = await getHostedChatTurn(db, input.userId, input.turnId);
  if (!turn) {
    if (input.roundIndex !== 0) {
      return {
        balance: currentBalance,
        code: 'turn_conflict',
        message: 'A new chat turn must begin with round zero.',
        ok: false,
      };
    }
    if (currentBalance <= 0) {
      return {
        balance: currentBalance,
        code: 'insufficient_credits',
        message: 'You need a positive credit balance to start a hosted AI chat turn.',
        ok: false,
      };
    }

    const now = new Date().toISOString();
    const claimId = crypto.randomUUID();
    const maxSpendCredits = Math.min(
      HOSTED_CHAT_MAX_TURN_SPEND_CREDITS,
      Math.max(1, Math.floor(currentBalance)),
    );
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO ai_chat_turns (
               id, user_id, model, protocol, status, provider_credits, credits_charged,
               max_spend_credits, next_round_index, terminal_reason,
               created_at, updated_at, completed_at
             )
             VALUES (?, ?, ?, ?, 'active', 0, 0, ?, 0, NULL, ?, ?, NULL)`,
          )
          .bind(
            input.turnId,
            input.userId,
            input.model,
            input.protocol,
            maxSpendCredits,
            now,
            now,
          ),
        db
          .prepare(
            `INSERT INTO ai_chat_turn_rounds (
               id, turn_id, user_id, round_index, idempotency_key, status,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
          )
          .bind(
            claimId,
            input.turnId,
            input.userId,
            input.roundIndex,
            input.idempotencyKey,
            now,
          ),
      ]);
      claimedByThisRequest = true;
    } catch {
      // A concurrent request may have created the turn/claim. Resolve it below.
    }
  } else {
    const validContinuation = turn.status === 'active'
      && turn.model === input.model
      && turn.protocol === input.protocol
      && turn.next_round_index === input.roundIndex;
    if (!validContinuation) {
      return {
        balance: currentBalance,
        code: 'turn_conflict',
        message: 'This chat turn is terminal or the requested round is out of sequence.',
        ok: false,
      };
    }
    if (currentBalance <= 0) {
      return {
        balance: currentBalance,
        code: 'insufficient_credits',
        message: 'The remaining credit balance is not sufficient for another hosted AI round.',
        ok: false,
      };
    }
    if (turn.credits_charged >= turn.max_spend_credits) {
      return {
        balance: currentBalance,
        code: 'turn_spend_limit_exceeded',
        message: 'This hosted AI chat turn has reached its server-authoritative spend limit.',
        ok: false,
      };
    }

    const now = new Date().toISOString();
    const claimId = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO ai_chat_turn_rounds (
             id, turn_id, user_id, round_index, idempotency_key, status, created_at
           )
           SELECT ?, t.id, t.user_id, ?, ?, 'pending', ?
           FROM ai_chat_turns t
           WHERE t.id = ? AND t.user_id = ? AND t.status = 'active'
             AND t.model = ? AND t.protocol = ? AND t.next_round_index = ?
             AND t.credits_charged < t.max_spend_credits
             AND (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = ?) > 0`,
        )
        .bind(
          claimId,
          input.roundIndex,
          input.idempotencyKey,
          now,
          input.turnId,
          input.userId,
          input.model,
          input.protocol,
          input.roundIndex,
          input.userId,
        )
        .run();
      claimedByThisRequest = true;
    } catch {
      // A concurrent request may own this exact round. Resolve it below.
    }
  }

  const claimedRound = await getHostedChatRoundByIdempotencyKey(
    db,
    input.userId,
    input.idempotencyKey,
  );
  turn = await getHostedChatTurn(db, input.userId, input.turnId);
  if (claimedRound && turn) {
    const authorization = authorizationForDuplicate(
      currentBalance,
      claimedRound,
      turn,
      input,
    );
    return authorization.ok && claimedByThisRequest
      ? { ...authorization, duplicateRound: null }
      : authorization;
  }

  const competingRound = await getHostedChatRoundByIndex(
    db,
    input.userId,
    input.turnId,
    input.roundIndex,
  );
  if (competingRound) {
    return {
      balance: currentBalance,
      code: competingRound.status === 'pending' ? 'round_in_progress' : 'turn_conflict',
      message: competingRound.status === 'pending'
        ? 'This hosted AI chat round is already in progress.'
        : 'This hosted AI chat round has already been processed.',
      ok: false,
    };
  }

  return {
    balance: await getCreditBalance(db, input.userId),
    code: 'turn_conflict',
    message: 'The hosted AI chat round could not be authorized safely.',
    ok: false,
  };
}

function usageFromRound(round: HostedChatTurnRoundRow): KieChatProviderUsage {
  return {
    cachedInputTokens: round.cached_input_tokens,
    hasMoreTools: round.has_more_tools === 1,
    inputTokens: round.input_tokens,
    outputTokens: round.output_tokens,
    providerCredits: round.provider_credits,
    reasoningTokens: round.reasoning_tokens,
    toolCallCount: round.tool_call_count,
  };
}

async function settlementFromStoredRound(
  db: AppD1Database,
  userId: string,
  round: HostedChatTurnRoundRow,
  replayed: boolean,
): Promise<HostedChatRoundSettlement> {
  const turn = await getHostedChatTurn(db, userId, round.turn_id);
  const ledgerEntry = round.credits_charged > 0
    ? await getCreditLedgerEntryBySource(
        db,
        userId,
        'hosted:ai_chat',
        round.idempotency_key,
      )
    : null;
  const hasProvenTurnAdvance = Boolean(
    turn
    && turn.next_round_index >= round.round_index + 1
    && turn.credits_charged >= (round.total_credits_charged ?? Number.POSITIVE_INFINITY)
    && turn.provider_credits + FLOATING_POINT_ROUNDING_EPSILON
      >= (round.total_provider_credits ?? Number.POSITIVE_INFINITY),
  );
  const hasExactLedger = round.credits_charged === 0 || Boolean(
    ledgerEntry
    && ledgerEntry.id === round.ledger_entry_id
    && ledgerEntry.amount === -round.credits_charged,
  );
  if (!turn || round.status !== 'settled' || !hasProvenTurnAdvance || !hasExactLedger) {
    throw new HostedChatBillingError(
      round.status === 'pending' ? 'round_in_progress' : 'settlement_conflict',
      round.status === 'pending'
        ? 'This hosted AI chat round is still in progress.'
        : 'The hosted AI chat round lacks an exact ledger and turn-advance proof.',
    );
  }

  return {
    balance: await getCreditBalance(db, userId),
    creditsCharged: round.credits_charged,
    ledgerEntryId: round.ledger_entry_id,
    providerCredits: round.provider_credits,
    replayed,
    response: deserializeHostedChatRoundResponse(round),
    totalCreditsCharged: round.total_credits_charged ?? turn.credits_charged,
    totalProviderCredits: round.total_provider_credits ?? turn.provider_credits,
    turnCompleted: turn.status === 'completed',
    usage: usageFromRound(round),
  };
}

export function replayHostedChatRound(
  db: AppD1Database,
  userId: string,
  round: HostedChatTurnRoundRow,
): Promise<HostedChatRoundSettlement> {
  return settlementFromStoredRound(db, userId, round, true);
}

async function compensateUnprovenSettlement(
  db: AppD1Database,
  input: {
    idempotencyKey: string;
    previousTurn: HostedChatTurnRow;
    roundId: string;
    userId: string;
  },
): Promise<void> {
  const spendEntry = await getCreditLedgerEntryBySource(
    db,
    input.userId,
    'hosted:ai_chat',
    input.idempotencyKey,
  );
  const compensationSource = 'refund:hosted:ai_chat_settlement';
  const compensationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [];

  if (spendEntry) {
    statements.push(
      db
        .prepare(
          `INSERT INTO credit_ledger (
             id, user_id, entry_type, amount, balance_after, source, source_id,
             description, metadata_json, created_at
           )
           SELECT ?, ?, 'adjustment', -spend.amount, (
                    SELECT COALESCE(SUM(amount), 0) - spend.amount
                    FROM credit_ledger WHERE user_id = ?
                  ),
                  ?, ?, 'Hosted AI chat settlement compensation',
                  ?, ?
           FROM credit_ledger spend
           WHERE spend.id = ? AND spend.user_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM credit_ledger
               WHERE user_id = ? AND source = ? AND source_id = ?
             )`,
        )
        .bind(
          compensationId,
          input.userId,
          input.userId,
          compensationSource,
          input.idempotencyKey,
          JSON.stringify({
            originalLedgerEntryId: spendEntry.id,
            reason: 'settlement_proof_failed',
          }),
          now,
          spendEntry.id,
          input.userId,
          input.userId,
          compensationSource,
          input.idempotencyKey,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE ai_chat_turn_rounds
         SET status = 'provider_failed',
             credits_charged = 0,
             total_provider_credits = ?,
             total_credits_charged = ?,
             ledger_entry_id = NULL,
             response_json = NULL,
             settled_at = COALESCE(settled_at, ?)
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        input.previousTurn.provider_credits,
        input.previousTurn.credits_charged,
        now,
        input.roundId,
        input.userId,
      ),
    db
      .prepare(
        `UPDATE ai_chat_turns
         SET status = 'provider_failed',
             provider_credits = ?,
             credits_charged = ?,
             next_round_index = ?,
             terminal_reason = 'settlement_proof_failed',
             updated_at = ?,
             completed_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        input.previousTurn.provider_credits,
        input.previousTurn.credits_charged,
        input.previousTurn.next_round_index,
        now,
        now,
        input.previousTurn.id,
        input.userId,
      ),
  );
  await db.batch(statements);

  if (spendEntry) {
    const compensation = await getCreditLedgerEntryBySource(
      db,
      input.userId,
      compensationSource,
      input.idempotencyKey,
    );
    if (!compensation || compensation.amount !== Math.abs(spendEntry.amount)) {
      throw new HostedChatBillingError(
        'settlement_conflict',
        'The hosted AI settlement failed and its debit could not be compensated.',
      );
    }
  }
}

export async function settleHostedChatRound(
  db: AppD1Database,
  input: {
    fallbackRoundCredits: number;
    idempotencyKey: string;
    model: string;
    payload: unknown;
    roundIndex: number;
    terminalAction?: HostedChatRoundTerminalAction;
    turn: HostedChatTurnRow;
    userId: string;
  },
): Promise<HostedChatRoundSettlement> {
  const existingRound = await getHostedChatRoundByIdempotencyKey(
    db,
    input.userId,
    input.idempotencyKey,
  );
  if (existingRound?.status === 'settled') {
    return settlementFromStoredRound(db, input.userId, existingRound, true);
  }
  if (!existingRound || existingRound.status !== 'pending') {
    throw new HostedChatBillingError(
      'settlement_conflict',
      'The hosted AI chat round has no active authorization claim.',
    );
  }

  const currentTurn = await getHostedChatTurn(db, input.userId, input.turn.id);
  if (
    !currentTurn
    || currentTurn.status !== 'active'
    || currentTurn.model !== input.model
    || currentTurn.next_round_index !== input.roundIndex
  ) {
    throw new HostedChatBillingError(
      'turn_conflict',
      'The hosted AI chat turn changed before this round could settle.',
    );
  }

  const usage = extractKieChatProviderUsage(input.payload);
  const calculated = calculateHostedChatCreditSettlement({
    fallbackRoundCredits: input.fallbackRoundCredits,
    previousCreditsCharged: currentTurn.credits_charged,
    previousProviderCredits: currentTurn.provider_credits,
    roundProviderCredits: usage.providerCredits,
  });
  if (calculated.totalCreditsCharged > currentTurn.max_spend_credits) {
    throw new HostedChatBillingError(
      'turn_spend_limit_exceeded',
      'This provider round would exceed the server-authoritative chat-turn spend limit.',
    );
  }

  const balanceBeforeSettlement = await getCreditBalance(db, input.userId);
  if (balanceBeforeSettlement < calculated.creditsToCharge) {
    throw new HostedChatBillingError(
      'insufficient_credits',
      'The remaining credit balance is not sufficient to settle this hosted AI round.',
    );
  }

  const terminalAction = input.terminalAction ?? 'auto';
  const shouldComplete = terminalAction === 'complete'
    || (terminalAction === 'auto' && !usage.hasMoreTools);
  const terminalReason = shouldComplete
    ? terminalAction === 'complete' ? 'explicit_complete' : 'legacy_auto_complete'
    : null;
  const replayPayload = serializeReplayPayload(input.payload);
  const roundLedgerEntryId = calculated.creditsToCharge > 0 ? crypto.randomUUID() : null;
  const now = new Date().toISOString();

  const statements = [
    db
      .prepare(
        `UPDATE ai_chat_turn_rounds
         SET status = 'settled',
             provider_credits = ?,
             credits_charged = ?,
             total_provider_credits = ?,
             total_credits_charged = ?,
             input_tokens = ?,
             cached_input_tokens = ?,
             output_tokens = ?,
             reasoning_tokens = ?,
             tool_call_count = ?,
             has_more_tools = ?,
             response_json = ?,
             ledger_entry_id = NULL,
             settled_at = ?
         WHERE id = ? AND turn_id = ? AND user_id = ? AND round_index = ?
           AND idempotency_key = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM ai_chat_turns t
             WHERE t.id = ? AND t.user_id = ? AND t.status = 'active'
               AND t.model = ? AND t.protocol = ? AND t.next_round_index = ?
               AND t.credits_charged = ? AND t.max_spend_credits >= ?
           )
           AND (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = ?) >= ?`,
      )
      .bind(
        usage.providerCredits,
        calculated.creditsToCharge,
        calculated.totalProviderCredits,
        calculated.totalCreditsCharged,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.outputTokens,
        usage.reasoningTokens,
        usage.toolCallCount,
        usage.hasMoreTools ? 1 : 0,
        replayPayload,
        now,
        existingRound.id,
        currentTurn.id,
        input.userId,
        input.roundIndex,
        input.idempotencyKey,
        currentTurn.id,
        input.userId,
        currentTurn.model,
        currentTurn.protocol,
        input.roundIndex,
        currentTurn.credits_charged,
        calculated.totalCreditsCharged,
        input.userId,
        calculated.creditsToCharge,
      ),
  ];

  if (roundLedgerEntryId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO credit_ledger (
             id, user_id, entry_type, amount, balance_after, source, source_id,
             description, metadata_json, created_at
           )
           SELECT ?, ?, 'spend', ?, (
                    SELECT COALESCE(SUM(amount), 0) + ?
                    FROM credit_ledger WHERE user_id = ?
                  ),
                  'hosted:ai_chat', ?, 'Hosted AI chat usage', ?, ?
           FROM ai_chat_turn_rounds r
           WHERE r.id = ? AND r.user_id = ? AND r.status = 'settled'
             AND r.ledger_entry_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM credit_ledger
               WHERE user_id = ? AND source = 'hosted:ai_chat' AND source_id = ?
             )`,
        )
        .bind(
          roundLedgerEntryId,
          input.userId,
          -calculated.creditsToCharge,
          -calculated.creditsToCharge,
          input.userId,
          input.idempotencyKey,
          JSON.stringify({
            billingRoundIndex: input.roundIndex,
            billingTurnId: currentTurn.id,
            cachedInputTokens: usage.cachedInputTokens,
            inputTokens: usage.inputTokens,
            model: input.model,
            outputTokens: usage.outputTokens,
            providerCredits: usage.providerCredits,
            reasoningTokens: usage.reasoningTokens,
            toolCallCount: usage.toolCallCount,
          }),
          now,
          existingRound.id,
          input.userId,
          input.userId,
          input.idempotencyKey,
        ),
    );
    statements.push(
      db
        .prepare(
          `UPDATE ai_chat_turn_rounds
           SET ledger_entry_id = ?
           WHERE id = ? AND turn_id = ? AND user_id = ? AND round_index = ?
             AND idempotency_key = ? AND status = 'settled'
             AND ledger_entry_id IS NULL
             AND EXISTS (
               SELECT 1 FROM credit_ledger l
               WHERE l.id = ? AND l.user_id = ?
                 AND l.source = 'hosted:ai_chat' AND l.source_id = ?
             )`,
        )
        .bind(
          roundLedgerEntryId,
          existingRound.id,
          currentTurn.id,
          input.userId,
          input.roundIndex,
          input.idempotencyKey,
          roundLedgerEntryId,
          input.userId,
          input.idempotencyKey,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE ai_chat_turns
         SET provider_credits = ?,
             credits_charged = ?,
             next_round_index = ?,
             status = ?,
             terminal_reason = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active' AND next_round_index = ?
           AND EXISTS (
             SELECT 1 FROM ai_chat_turn_rounds r
             WHERE r.id = ? AND r.user_id = ? AND r.status = 'settled'
               AND r.total_credits_charged = ?
               AND (? = 0 OR EXISTS (
                 SELECT 1 FROM credit_ledger l
                 WHERE l.id = r.ledger_entry_id AND l.user_id = r.user_id
               ))
           )`,
      )
      .bind(
        calculated.totalProviderCredits,
        calculated.totalCreditsCharged,
        input.roundIndex + 1,
        shouldComplete ? 'completed' : 'active',
        terminalReason,
        now,
        shouldComplete ? now : null,
        currentTurn.id,
        input.userId,
        input.roundIndex,
        existingRound.id,
        input.userId,
        calculated.totalCreditsCharged,
        calculated.creditsToCharge,
      ),
  );

  try {
    await db.batch(statements);
  } catch {
    const replay = await getHostedChatRoundByIdempotencyKey(
      db,
      input.userId,
      input.idempotencyKey,
    );
    if (replay?.status === 'settled') {
      return settlementFromStoredRound(db, input.userId, replay, true);
    }
    throw new HostedChatBillingError(
      'settlement_conflict',
      'The hosted AI round could not be settled atomically.',
    );
  }

  const settledRound = await getHostedChatRoundByIdempotencyKey(
    db,
    input.userId,
    input.idempotencyKey,
  );
  if (!settledRound || settledRound.status !== 'settled') {
    throw new HostedChatBillingError(
      'settlement_conflict',
      'The hosted AI round lost its settlement race without advancing the turn.',
    );
  }
  try {
    return await settlementFromStoredRound(db, input.userId, settledRound, false);
  } catch (error) {
    await compensateUnprovenSettlement(db, {
      idempotencyKey: input.idempotencyKey,
      previousTurn: currentTurn,
      roundId: settledRound.id,
      userId: input.userId,
    });
    throw error;
  }
}

async function terminateHostedChatTurn(
  db: AppD1Database,
  userId: string,
  turnId: string,
  status: Exclude<HostedChatTurnStatus, 'active'>,
  reason: string,
): Promise<HostedChatTurnRow> {
  const existing = await getHostedChatTurn(db, userId, turnId);
  if (!existing) {
    throw new HostedChatBillingError('turn_conflict', 'The hosted AI chat turn does not exist.');
  }
  if (existing.status === status) {
    return existing;
  }
  if (existing.status !== 'active') {
    throw new HostedChatBillingError(
      'turn_conflict',
      `The hosted AI chat turn is already terminal (${existing.status}).`,
    );
  }

  const now = new Date().toISOString();
  if (status === 'completed') {
    await db
      .prepare(
        `UPDATE ai_chat_turns
         SET status = 'completed', terminal_reason = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM ai_chat_turn_rounds
             WHERE turn_id = ? AND user_id = ? AND status = 'pending'
           )`,
      )
      .bind(reason, now, now, turnId, userId, turnId, userId)
      .run();
  } else {
    await db.batch([
      db
        .prepare(
          `UPDATE ai_chat_turn_rounds
           SET status = ?, settled_at = COALESCE(settled_at, ?)
           WHERE turn_id = ? AND user_id = ? AND status = 'pending'`,
        )
        .bind(status, now, turnId, userId),
      db
        .prepare(
          `UPDATE ai_chat_turns
           SET status = ?, terminal_reason = ?, updated_at = ?, completed_at = ?
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        )
        .bind(status, reason, now, now, turnId, userId),
    ]);
  }

  const terminal = await getHostedChatTurn(db, userId, turnId);
  if (!terminal || terminal.status !== status) {
    throw new HostedChatBillingError(
      status === 'completed' ? 'round_in_progress' : 'turn_conflict',
      status === 'completed'
        ? 'The hosted AI chat turn still has a provider round in progress.'
        : 'The hosted AI chat turn could not enter its terminal state.',
    );
  }
  return terminal;
}

export function completeHostedChatTurn(
  db: AppD1Database,
  userId: string,
  turnId: string,
): Promise<HostedChatTurnRow> {
  return terminateHostedChatTurn(db, userId, turnId, 'completed', 'explicit_complete');
}

export function cancelHostedChatTurn(
  db: AppD1Database,
  userId: string,
  turnId: string,
): Promise<HostedChatTurnRow> {
  return terminateHostedChatTurn(db, userId, turnId, 'cancelled', 'explicit_cancel');
}

export async function failHostedChatTurn(
  db: AppD1Database,
  userId: string,
  turnId: string,
): Promise<void> {
  await terminateHostedChatTurn(
    db,
    userId,
    turnId,
    'provider_failed',
    'provider_failed',
  );
}
