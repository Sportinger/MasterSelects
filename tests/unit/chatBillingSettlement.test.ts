import { describe, expect, it } from 'vitest';
import {
  replayHostedChatRound,
  settleHostedChatRound,
  type HostedChatTurnRoundRow,
  type HostedChatTurnRow,
} from '../../functions/lib/chatBilling';
import type {
  CreditLedgerRow,
} from '../../functions/lib/credits';
import type {
  AppD1Database,
  AppD1Statement,
} from '../../functions/lib/env';

class StateStatement implements AppD1Statement {
  readonly query: string;
  private readonly state: BillingState;
  values: unknown[] = [];

  constructor(query: string, state: BillingState) {
    this.query = query;
    this.state = state;
  }

  bind(...values: unknown[]): AppD1Statement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async first<T>(): Promise<T | null> {
    if (this.query.includes('COALESCE(SUM(amount), 0) AS balance')) {
      return {
        balance: this.state.ledger.reduce((sum, entry) => sum + entry.amount, 0),
      } as T;
    }
    if (this.query.includes('FROM ai_chat_turn_rounds')) {
      return this.state.round as T | null;
    }
    if (this.query.includes('FROM ai_chat_turns')) {
      return this.state.turn as T | null;
    }
    if (this.query.includes('FROM credit_ledger')) {
      const [userId, source, sourceId] = this.values;
      return (this.state.ledger.find((entry) => (
        entry.user_id === userId
        && entry.source === source
        && entry.source_id === sourceId
      )) ?? null) as T | null;
    }
    return null;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [];
  }

  async run(): Promise<unknown> {
    return { meta: { changes: 0 } };
  }
}

interface BillingState {
  batchCount: number;
  ledger: CreditLedgerRow[];
  onBatch?: (state: BillingState, statements: StateStatement[]) => void;
  round: HostedChatTurnRoundRow | null;
  turn: HostedChatTurnRow | null;
}

function ledgerEntry(overrides: Partial<CreditLedgerRow>): CreditLedgerRow {
  return {
    amount: 100,
    balance_after: 100,
    created_at: '2026-07-30T00:00:00.000Z',
    description: null,
    entry_type: 'grant',
    id: 'grant-1',
    metadata_json: null,
    source: 'test:grant',
    source_id: 'grant-1',
    user_id: 'user-1',
    ...overrides,
  };
}

function activeTurn(overrides: Partial<HostedChatTurnRow> = {}): HostedChatTurnRow {
  return {
    completed_at: null,
    created_at: '2026-07-30T00:00:00.000Z',
    credits_charged: 0,
    id: 'turn-1',
    max_spend_credits: 100,
    model: 'gpt-5-6-terra',
    next_round_index: 0,
    protocol: 'openai-responses',
    provider_credits: 0,
    status: 'active',
    terminal_reason: null,
    updated_at: '2026-07-30T00:00:00.000Z',
    user_id: 'user-1',
    ...overrides,
  };
}

function pendingRound(overrides: Partial<HostedChatTurnRoundRow> = {}): HostedChatTurnRoundRow {
  return {
    cached_input_tokens: null,
    created_at: '2026-07-30T00:00:00.000Z',
    credits_charged: 0,
    has_more_tools: 0,
    id: 'round-1',
    idempotency_key: 'turn-1:openai-responses:0',
    input_tokens: null,
    ledger_entry_id: null,
    output_tokens: null,
    provider_credits: null,
    reasoning_tokens: null,
    response_json: null,
    round_index: 0,
    settled_at: null,
    status: 'pending',
    tool_call_count: 0,
    total_credits_charged: null,
    total_provider_credits: null,
    turn_id: 'turn-1',
    user_id: 'user-1',
    ...overrides,
  };
}

function createStateDb(state: BillingState): AppD1Database {
  return {
    async batch<T>(statements: AppD1Statement[]): Promise<T[]> {
      state.batchCount += 1;
      state.onBatch?.(state, statements as StateStatement[]);
      return [] as T[];
    },
    async exec(): Promise<unknown> {
      return {};
    },
    prepare(query: string): AppD1Statement {
      return new StateStatement(query, state);
    },
  };
}

const settleInput = (turn: HostedChatTurnRow) => ({
  fallbackRoundCredits: 5,
  idempotencyKey: 'turn-1:openai-responses:0',
  model: 'gpt-5-6-terra',
  payload: {
    credits_consumed: 1,
    output: [{ content: [{ text: 'Exact response' }], type: 'message' }],
    usage: { input_tokens: 10, output_tokens: 2 },
  },
  roundIndex: 0,
  terminalAction: 'complete' as const,
  turn,
  userId: 'user-1',
});

describe('hosted chat settlement proof', () => {
  it('replays a durable exact response only with matching turn and ledger proof', async () => {
    const response = { output: [{ type: 'message', content: [{ text: 'Exact response' }] }] };
    const turn = activeTurn({
      completed_at: '2026-07-30T00:00:01.000Z',
      credits_charged: 6,
      next_round_index: 1,
      provider_credits: 1,
      status: 'completed',
      terminal_reason: 'explicit_complete',
    });
    const round = pendingRound({
      credits_charged: 6,
      ledger_entry_id: 'spend-1',
      provider_credits: 1,
      response_json: JSON.stringify(response),
      settled_at: '2026-07-30T00:00:01.000Z',
      status: 'settled',
      total_credits_charged: 6,
      total_provider_credits: 1,
    });
    const state: BillingState = {
      batchCount: 0,
      ledger: [
        ledgerEntry({}),
        ledgerEntry({
          amount: -6,
          balance_after: 94,
          entry_type: 'spend',
          id: 'spend-1',
          source: 'hosted:ai_chat',
          source_id: round.idempotency_key,
        }),
      ],
      round,
      turn,
    };

    const result = await settleHostedChatRound(createStateDb(state), settleInput(turn));

    expect(result).toMatchObject({
      balance: 94,
      creditsCharged: 6,
      replayed: true,
      response,
      totalCreditsCharged: 6,
      turnCompleted: true,
    });
    expect(state.batchCount).toBe(0);
  });

  it('keeps an earlier settled response replayable after later rounds advance totals', async () => {
    const response = { output: [{ type: 'message', content: [{ text: 'Round zero' }] }] };
    const turn = activeTurn({
      credits_charged: 12,
      next_round_index: 2,
      provider_credits: 2,
    });
    const round = pendingRound({
      credits_charged: 6,
      has_more_tools: 1,
      ledger_entry_id: 'spend-1',
      provider_credits: 1,
      response_json: JSON.stringify(response),
      settled_at: '2026-07-30T00:00:01.000Z',
      status: 'settled',
      total_credits_charged: 6,
      total_provider_credits: 1,
    });
    const state: BillingState = {
      batchCount: 0,
      ledger: [
        ledgerEntry({}),
        ledgerEntry({
          amount: -6,
          balance_after: 94,
          entry_type: 'spend',
          id: 'spend-1',
          source: 'hosted:ai_chat',
          source_id: round.idempotency_key,
        }),
        ledgerEntry({
          amount: -6,
          balance_after: 88,
          entry_type: 'spend',
          id: 'spend-2',
          source: 'hosted:ai_chat',
          source_id: 'turn-1:openai-responses:1',
        }),
      ],
      round,
      turn,
    };

    const result = await replayHostedChatRound(createStateDb(state), 'user-1', round);

    expect(result).toMatchObject({
      balance: 88,
      replayed: true,
      response,
      totalCreditsCharged: 6,
    });
    expect(state.batchCount).toBe(0);
  });

  it('does not accept a settled round when the turn advance or ledger proof is missing', async () => {
    const turn = activeTurn();
    const round = pendingRound({
      credits_charged: 6,
      ledger_entry_id: 'missing-spend',
      provider_credits: 1,
      response_json: JSON.stringify({ ok: true }),
      settled_at: '2026-07-30T00:00:01.000Z',
      status: 'settled',
      total_credits_charged: 6,
      total_provider_credits: 1,
    });
    const state: BillingState = {
      batchCount: 0,
      ledger: [ledgerEntry({})],
      round,
      turn,
    };

    await expect(
      settleHostedChatRound(createStateDb(state), settleInput(turn)),
    ).rejects.toMatchObject({
      code: 'settlement_conflict',
    });
    expect(state.batchCount).toBe(0);
  });

  it('fails closed before settlement when measured usage exceeds the stored turn budget', async () => {
    const turn = activeTurn({ max_spend_credits: 5 });
    const state: BillingState = {
      batchCount: 0,
      ledger: [ledgerEntry({})],
      round: pendingRound(),
      turn,
    };

    await expect(
      settleHostedChatRound(createStateDb(state), settleInput(turn)),
    ).rejects.toMatchObject({
      code: 'turn_spend_limit_exceeded',
    });
    expect(state.batchCount).toBe(0);
    expect(state.ledger).toHaveLength(1);
  });

  it('creates the ledger parent before attaching its foreign key to the settled round', async () => {
    const turn = activeTurn();
    const state: BillingState = {
      batchCount: 0,
      ledger: [ledgerEntry({})],
      round: pendingRound(),
      turn,
      onBatch(current, statements) {
        const queries = statements.map(statement => statement.query);
        const settleRoundIndex = queries.findIndex(query => (
          query.includes('UPDATE ai_chat_turn_rounds')
          && query.includes("SET status = 'settled'")
        ));
        const insertLedgerIndex = queries.findIndex(query => (
          query.includes('INSERT INTO credit_ledger')
        ));
        const attachLedgerIndex = queries.findIndex(query => (
          query.includes('UPDATE ai_chat_turn_rounds')
          && query.includes('SET ledger_entry_id = ?')
        ));
        const advanceTurnIndex = queries.findIndex(query => (
          query.includes('UPDATE ai_chat_turns')
          && query.includes('SET provider_credits = ?')
        ));

        expect(settleRoundIndex).toBeGreaterThanOrEqual(0);
        expect(insertLedgerIndex).toBeGreaterThan(settleRoundIndex);
        expect(attachLedgerIndex).toBeGreaterThan(insertLedgerIndex);
        expect(advanceTurnIndex).toBeGreaterThan(attachLedgerIndex);
        expect(queries[settleRoundIndex]).toContain('ledger_entry_id = NULL');

        const ledgerId = statements[attachLedgerIndex].values[0] as string;
        current.round = pendingRound({
          credits_charged: 6,
          ledger_entry_id: ledgerId,
          provider_credits: 1,
          response_json: JSON.stringify(settleInput(turn).payload),
          settled_at: '2026-07-30T00:00:01.000Z',
          status: 'settled',
          total_credits_charged: 6,
          total_provider_credits: 1,
        });
        current.turn = activeTurn({
          completed_at: '2026-07-30T00:00:01.000Z',
          credits_charged: 6,
          next_round_index: 1,
          provider_credits: 1,
          status: 'completed',
          terminal_reason: 'explicit_complete',
        });
        current.ledger.push(ledgerEntry({
          amount: -6,
          balance_after: 94,
          entry_type: 'spend',
          id: ledgerId,
          source: 'hosted:ai_chat',
          source_id: 'turn-1:openai-responses:0',
        }));
      },
    };

    await expect(
      settleHostedChatRound(createStateDb(state), settleInput(turn)),
    ).resolves.toMatchObject({
      balance: 94,
      creditsCharged: 6,
      replayed: false,
      totalCreditsCharged: 6,
      turnCompleted: true,
    });
    expect(state.batchCount).toBe(1);
  });

  it('compensates a debit when a zero-row turn advance leaves no exact settlement proof', async () => {
    const turn = activeTurn();
    const state: BillingState = {
      batchCount: 0,
      ledger: [ledgerEntry({})],
      round: pendingRound(),
      turn,
      onBatch(current) {
        if (current.batchCount === 1) {
          current.round = pendingRound({
            credits_charged: 6,
            ledger_entry_id: 'spend-1',
            provider_credits: 1,
            response_json: JSON.stringify({ ok: true }),
            settled_at: '2026-07-30T00:00:01.000Z',
            status: 'settled',
            total_credits_charged: 6,
            total_provider_credits: 1,
          });
          current.ledger.push(ledgerEntry({
            amount: -6,
            balance_after: 94,
            entry_type: 'spend',
            id: 'spend-1',
            source: 'hosted:ai_chat',
            source_id: 'turn-1:openai-responses:0',
          }));
          // Deliberately leave turn.next_round_index at zero: UPDATE ... WHERE
          // affected zero rows even though the round and debit were written.
          return;
        }

        current.ledger.push(ledgerEntry({
          amount: 6,
          balance_after: 100,
          entry_type: 'adjustment',
          id: 'compensation-1',
          source: 'refund:hosted:ai_chat_settlement',
          source_id: 'turn-1:openai-responses:0',
        }));
        current.round = pendingRound({
          settled_at: '2026-07-30T00:00:02.000Z',
          status: 'provider_failed',
          total_credits_charged: 0,
          total_provider_credits: 0,
        });
        current.turn = activeTurn({
          completed_at: '2026-07-30T00:00:02.000Z',
          status: 'provider_failed',
          terminal_reason: 'settlement_proof_failed',
        });
      },
    };

    await expect(
      settleHostedChatRound(createStateDb(state), settleInput(turn)),
    ).rejects.toMatchObject({
      code: 'settlement_conflict',
    });

    expect(state.batchCount).toBe(2);
    expect(state.ledger.reduce((sum, entry) => sum + entry.amount, 0)).toBe(100);
    expect(state.turn).toMatchObject({
      next_round_index: 0,
      status: 'provider_failed',
      terminal_reason: 'settlement_proof_failed',
    });
    expect(state.round?.status).toBe('provider_failed');
  });
});
