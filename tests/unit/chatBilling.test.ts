import { describe, expect, it } from 'vitest';
import {
  authorizeHostedChatRound,
  calculateHostedChatCreditSettlement,
  extractKieChatProviderUsage,
  resolveHostedChatRoundIdentity,
  type HostedChatTurnRow,
} from '../../functions/lib/chatBilling';
import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';

function createAuthorizationDb(initialBalance: number): {
  advanceTurn(turnId: string, nextRoundIndex: number): void;
  db: AppD1Database;
  setBalance(balance: number): void;
  setTurnSpend(turnId: string, creditsCharged: number, maxSpendCredits: number): void;
} {
  let balance = initialBalance;
  const turns = new Map<string, HostedChatTurnRow>();
  const rounds = new Map<string, import('../../functions/lib/chatBilling').HostedChatTurnRoundRow>();

  class AuthorizationStatement implements AppD1Statement {
    private values: unknown[] = [];
    private readonly query: string;

    constructor(query: string) {
      this.query = query;
    }

    bind(...values: unknown[]): AppD1Statement {
      this.values = values;
      return this;
    }

    async all<T>(): Promise<{ results: T[] }> {
      return { results: [] };
    }

    async first<T>(): Promise<T | null> {
      if (this.query.includes('FROM ai_chat_turn_rounds')) {
        if (this.query.includes('idempotency_key = ?')) {
          return ([...rounds.values()].find((round) => (
            round.user_id === this.values[0] && round.idempotency_key === this.values[1]
          )) ?? null) as T | null;
        }
        return ([...rounds.values()].find((round) => (
          round.user_id === this.values[0]
          && round.turn_id === this.values[1]
          && round.round_index === this.values[2]
        )) ?? null) as T | null;
      }
      if (this.query.includes('COALESCE(SUM(amount), 0) AS balance')) {
        return { balance } as T;
      }
      if (this.query.includes('FROM ai_chat_turns')) {
        return (turns.get(`${this.values[1]}:${this.values[0]}`) ?? null) as T | null;
      }
      return null;
    }

    async raw<T = unknown[]>(): Promise<T[]> {
      return [];
    }

    async run(): Promise<unknown> {
      if (this.query.includes('INSERT INTO ai_chat_turns')) {
        const [id, userId, model, protocol, maxSpendCredits, createdAt, updatedAt] =
          this.values as string[];
        turns.set(`${userId}:${id}`, {
          completed_at: null,
          created_at: createdAt,
          credits_charged: 0,
          id,
          model,
          max_spend_credits: Number(maxSpendCredits),
          next_round_index: 0,
          protocol: protocol as HostedChatTurnRow['protocol'],
          provider_credits: 0,
          status: 'active',
          terminal_reason: null,
          updated_at: updatedAt,
          user_id: userId,
        });
      }
      if (this.query.includes('INSERT INTO ai_chat_turn_rounds')) {
        const isSelect = this.query.includes('SELECT ?, t.id');
        const [id, turnId, userId, roundIndex, idempotencyKey, createdAt] = isSelect
          ? [
              this.values[0],
              this.values[4],
              this.values[5],
              this.values[1],
              this.values[2],
              this.values[3],
            ]
          : this.values;
        rounds.set(String(idempotencyKey), {
          cached_input_tokens: null,
          created_at: String(createdAt),
          credits_charged: 0,
          has_more_tools: 0,
          id: String(id),
          idempotency_key: String(idempotencyKey),
          input_tokens: null,
          ledger_entry_id: null,
          output_tokens: null,
          provider_credits: null,
          reasoning_tokens: null,
          response_json: null,
          round_index: Number(roundIndex),
          settled_at: null,
          status: 'pending',
          tool_call_count: 0,
          total_credits_charged: null,
          total_provider_credits: null,
          turn_id: String(turnId),
          user_id: String(userId),
        });
      }
      return {};
    }
  }

  return {
    advanceTurn(turnId, nextRoundIndex) {
      const turn = turns.get(`user-1:${turnId}`);
      if (turn) turn.next_round_index = nextRoundIndex;
    },
    db: {
      async batch<T>(statements: AppD1Statement[]): Promise<T[]> {
        for (const statement of statements) {
          await statement.run();
        }
        return [] as T[];
      },
      async exec(): Promise<unknown> {
        return {};
      },
      prepare(query: string): AppD1Statement {
        return new AuthorizationStatement(query);
      },
    },
    setBalance(nextBalance) {
      balance = nextBalance;
    },
    setTurnSpend(turnId, creditsCharged, maxSpendCredits) {
      const turn = turns.get(`user-1:${turnId}`);
      if (turn) {
        turn.credits_charged = creditsCharged;
        turn.max_spend_credits = maxSpendCredits;
      }
    },
  };
}

describe('hosted chat billing', () => {
  it('extracts exact Kie.ai credits and tool usage from OpenAI Responses', () => {
    expect(extractKieChatProviderUsage({
      credits_consumed: 1.4,
      output: [
        { type: 'function_call', name: 'getTimelineState' },
        { type: 'message', content: [] },
      ],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 10 },
      },
    })).toEqual({
      cachedInputTokens: 20,
      hasMoreTools: true,
      inputTokens: 100,
      outputTokens: 30,
      providerCredits: 1.4,
      reasoningTokens: 10,
      toolCallCount: 1,
    });
  });

  it('extracts exact Kie.ai credits and tool usage from Claude Messages', () => {
    expect(extractKieChatProviderUsage({
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'tool-1', name: 'getTimelineState' },
      ],
      credits_consumed: 2.25,
      usage: {
        cache_read_input_tokens: 40,
        input_tokens: 250,
        output_tokens: 50,
      },
    })).toMatchObject({
      cachedInputTokens: 40,
      hasMoreTools: true,
      inputTokens: 250,
      outputTokens: 50,
      providerCredits: 2.25,
      toolCallCount: 1,
    });
  });

  it('uses the hosted-agent redacted tool count when raw provider calls are omitted', () => {
    expect(extractKieChatProviderUsage({
      credits_consumed: 3.5,
      hosted_agent_k0: {
        provider_result_digest: 'digest',
        redaction: 'usage-and-digest-only',
        tool_call_count: 4,
      },
      usage: {
        input_tokens: 500,
        output_tokens: 80,
      },
    })).toMatchObject({
      hasMoreTools: true,
      providerCredits: 3.5,
      toolCallCount: 4,
    });
  });

  it('rounds only once across the complete agent turn', () => {
    const first = calculateHostedChatCreditSettlement({
      fallbackRoundCredits: 5,
      previousCreditsCharged: 0,
      previousProviderCredits: 0,
      roundProviderCredits: 1.4,
    });
    const second = calculateHostedChatCreditSettlement({
      fallbackRoundCredits: 5,
      previousCreditsCharged: first.totalCreditsCharged,
      previousProviderCredits: first.totalProviderCredits,
      roundProviderCredits: 1.91,
    });

    expect(first).toEqual({
      creditsToCharge: 9,
      totalCreditsCharged: 9,
      totalProviderCredits: 1.4,
    });
    expect(second.creditsToCharge).toBe(11);
    expect(second.totalCreditsCharged).toBe(20);
    expect(second.totalProviderCredits).toBeCloseTo(3.31);
  });

  it('matches the two audited dev-server examples at the six-times rate', () => {
    expect(calculateHostedChatCreditSettlement({
      fallbackRoundCredits: 5,
      previousCreditsCharged: 0,
      previousProviderCredits: 0,
      roundProviderCredits: 10.34,
    }).totalCreditsCharged).toBe(63);
    expect(calculateHostedChatCreditSettlement({
      fallbackRoundCredits: 5,
      previousCreditsCharged: 0,
      previousProviderCredits: 0,
      roundProviderCredits: 31.55,
    }).totalCreditsCharged).toBe(190);
  });

  it('uses the model fallback only when Kie.ai omits its measured cost', () => {
    expect(calculateHostedChatCreditSettlement({
      fallbackRoundCredits: 5,
      previousCreditsCharged: 20,
      previousProviderCredits: 3.31,
      roundProviderCredits: null,
    })).toEqual({
      creditsToCharge: 5,
      totalCreditsCharged: 25,
      totalProviderCredits: 3.31,
    });
  });

  it('validates a stable turn id and sequential round index', () => {
    expect(resolveHostedChatRoundIdentity({
      billingRoundIndex: 12,
      billingTurnId: 'flashboard-chat-turn:abc_123',
    }, 'request-id')).toEqual({
      roundIndex: 12,
      turnId: 'flashboard-chat-turn:abc_123',
    });
    expect(resolveHostedChatRoundIdentity({}, 'request-id')).toEqual({
      roundIndex: 0,
      turnId: 'single-chat:request-id',
    });
    expect(resolveHostedChatRoundIdentity({
      billingRoundIndex: 1.5,
      billingTurnId: 'turn:abc',
    }, 'request-id')).toBeNull();
  });

  it('fails closed before a continuation when the remaining balance is exhausted', async () => {
    const authorizationDb = createAuthorizationDb(1);
    const firstRound = await authorizeHostedChatRound(authorizationDb.db, {
      idempotencyKey: 'turn:one:openai-responses:0',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      roundIndex: 0,
      turnId: 'turn:one',
      userId: 'user-1',
    });

    expect(firstRound.ok).toBe(true);

    authorizationDb.advanceTurn('turn:one', 1);
    authorizationDb.setBalance(-8);
    const continuation = await authorizeHostedChatRound(authorizationDb.db, {
      idempotencyKey: 'turn:one:openai-responses:1',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      roundIndex: 1,
      turnId: 'turn:one',
      userId: 'user-1',
    });
    const newTurn = await authorizeHostedChatRound(authorizationDb.db, {
      idempotencyKey: 'turn:two:openai-responses:0',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      roundIndex: 0,
      turnId: 'turn:two',
      userId: 'user-1',
    });

    expect(continuation).toMatchObject({
      balance: -8,
      code: 'insufficient_credits',
      ok: false,
    });
    expect(newTurn).toMatchObject({
      balance: -8,
      code: 'insufficient_credits',
      ok: false,
    });
  });

  it('fails closed before a continuation when the stored turn budget is exhausted', async () => {
    const authorizationDb = createAuthorizationDb(100);
    await authorizeHostedChatRound(authorizationDb.db, {
      idempotencyKey: 'turn:budget:openai-responses:0',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      roundIndex: 0,
      turnId: 'turn:budget',
      userId: 'user-1',
    });
    authorizationDb.advanceTurn('turn:budget', 1);
    authorizationDb.setTurnSpend('turn:budget', 25, 25);

    await expect(authorizeHostedChatRound(authorizationDb.db, {
      idempotencyKey: 'turn:budget:openai-responses:1',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
      roundIndex: 1,
      turnId: 'turn:budget',
      userId: 'user-1',
    })).resolves.toMatchObject({
      balance: 100,
      code: 'turn_spend_limit_exceeded',
      ok: false,
    });
  });
});
