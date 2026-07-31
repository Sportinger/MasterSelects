import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, AppD1Database } from '../../functions/lib/env';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  completeUsage: vi.fn(),
  createUsage: vi.fn(),
  fail: vi.fn(),
  insertAudit: vi.fn(),
  insertChatLog: vi.fn(),
  moderate: vi.fn(),
  provider: vi.fn(),
  replay: vi.fn(),
  settle: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('../../functions/lib/billing', () => ({
  getUserBillingSnapshot: mocks.snapshot,
}));

vi.mock('../../functions/lib/chatBilling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../functions/lib/chatBilling')>();
  return {
    ...actual,
    authorizeHostedChatRound: mocks.authorize,
    cancelHostedChatTurn: mocks.cancel,
    completeHostedChatTurn: mocks.complete,
    failHostedChatTurn: mocks.fail,
    replayHostedChatRound: mocks.replay,
    settleHostedChatRound: mocks.settle,
  };
});

vi.mock('../../functions/lib/aiAudit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../functions/lib/aiAudit')>();
  return {
    ...actual,
    insertAiAuditEvent: mocks.insertAudit,
  };
});

vi.mock('../../functions/lib/aiModeration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../functions/lib/aiModeration')>();
  return {
    ...actual,
    moderateAiInput: mocks.moderate,
  };
});

vi.mock('../../functions/lib/chatLog', () => ({
  insertChatLog: mocks.insertChatLog,
}));

vi.mock('../../functions/lib/providers/kieChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../functions/lib/providers/kieChat')>();
  return {
    ...actual,
    runHostedKieChatCompletion: mocks.provider,
  };
});

vi.mock('../../functions/lib/usage', () => ({
  completeUsageEvent: mocks.completeUsage,
  createUsageEvent: mocks.createUsage,
}));

import { onRequest } from '../../functions/api/ai/chat';

const db = {
  async batch<T>(): Promise<T[]> {
    return [];
  },
  async exec(): Promise<unknown> {
    return {};
  },
  prepare() {
    return {
      bind() {
        return this;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async first<T>() {
        return null as T | null;
      },
      async raw<T = unknown[]>() {
        return [] as T[];
      },
      async run() {
        return {};
      },
    };
  },
} satisfies AppD1Database;

function contextFor(body: unknown): AppContext {
  return {
    data: {
      requestId: 'request-1',
      user: { email: 'user@example.test', id: 'user-1' },
    },
    env: {
      DB: db,
      KV: {} as AppContext['env']['KV'],
      MEDIA: {} as AppContext['env']['MEDIA'],
    },
    next: async () => new Response(null),
    params: {},
    request: new Request('https://masterselects.test/api/ai/chat', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    waitUntil: vi.fn(),
  };
}

const turn = {
  completed_at: null,
  created_at: '2026-07-30T00:00:00.000Z',
  credits_charged: 0,
  id: 'turn-1',
  max_spend_credits: 100,
  model: 'gpt-5-6-terra',
  next_round_index: 0,
  protocol: 'openai-responses' as const,
  provider_credits: 0,
  status: 'active' as const,
  terminal_reason: null,
  updated_at: '2026-07-30T00:00:00.000Z',
  user_id: 'user-1',
};

describe('hosted chat route billing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot.mockResolvedValue({
      balance: 100,
      hostedAIEnabled: true,
    });
    mocks.moderate.mockResolvedValue({
      categories: [],
      errorMessage: null,
      flagged: false,
      payload: null,
      status: 'clean',
    });
    mocks.insertAudit.mockResolvedValue('audit-1');
    mocks.insertChatLog.mockResolvedValue('log-1');
    mocks.createUsage.mockResolvedValue('usage-1');
    mocks.completeUsage.mockResolvedValue(undefined);
  });

  it('completes a turn explicitly without invoking the provider', async () => {
    mocks.complete.mockResolvedValue({
      ...turn,
      completed_at: '2026-07-30T00:00:01.000Z',
      status: 'completed',
      terminal_reason: 'explicit_complete',
    });

    const response = await onRequest(contextFor({
      billingTurnAction: 'complete',
      billingTurnId: 'turn-1',
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(db, 'user-1', 'turn-1');
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      data: {
        billingTurnId: 'turn-1',
        terminalReason: 'explicit_complete',
        terminalStatus: 'completed',
      },
      ok: true,
    });
  });

  it('passes an explicit continuation decision into atomic round settlement', async () => {
    mocks.authorize.mockResolvedValue({
      balance: 100,
      duplicateRound: null,
      ok: true,
      turn,
    });
    const providerPayload = {
      credits_consumed: 1,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }],
    };
    mocks.provider.mockResolvedValue(providerPayload);
    mocks.settle.mockResolvedValue({
      balance: 94,
      creditsCharged: 6,
      ledgerEntryId: 'ledger-1',
      providerCredits: 1,
      replayed: false,
      response: providerPayload,
      totalCreditsCharged: 6,
      totalProviderCredits: 1,
      turnCompleted: false,
      usage: {
        cachedInputTokens: null,
        hasMoreTools: false,
        inputTokens: null,
        outputTokens: null,
        providerCredits: 1,
        reasoningTokens: null,
        toolCallCount: 0,
      },
    });

    const response = await onRequest(contextFor({
      billingRoundIndex: 0,
      billingTurnAction: 'continue',
      billingTurnId: 'turn-1',
      idempotencyKey: 'turn-1:openai-responses:0',
      input: [{ content: 'USER_PROMPT_SENTINEL', role: 'user' }],
      instructions: 'SYSTEM_PROMPT_SENTINEL',
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
    }));

    expect(response.status).toBe(200);
    expect(mocks.settle).toHaveBeenCalledWith(db, expect.objectContaining({
      terminalAction: 'continue',
      turn,
    }));
    expect(mocks.fail).not.toHaveBeenCalled();
    const persistedAudit = JSON.stringify(mocks.insertAudit.mock.calls);
    const persistedChat = JSON.stringify(mocks.insertChatLog.mock.calls);
    expect(persistedAudit).not.toContain('SYSTEM_PROMPT_SENTINEL');
    expect(persistedAudit).not.toContain('USER_PROMPT_SENTINEL');
    expect(persistedChat).not.toContain('SYSTEM_PROMPT_SENTINEL');
    expect(persistedChat).not.toContain('USER_PROMPT_SENTINEL');
  });

  it('replays the durable round response without consulting the best-effort chat log', async () => {
    const duplicateRound = {
      cached_input_tokens: null,
      created_at: '2026-07-30T00:00:00.000Z',
      credits_charged: 6,
      has_more_tools: 0,
      id: 'round-1',
      idempotency_key: 'turn-1:openai-responses:0',
      input_tokens: 10,
      ledger_entry_id: 'ledger-1',
      output_tokens: 2,
      provider_credits: 1,
      reasoning_tokens: null,
      response_json: JSON.stringify({ output: [{ type: 'message' }] }),
      round_index: 0,
      settled_at: '2026-07-30T00:00:01.000Z',
      status: 'settled',
      tool_call_count: 0,
      total_credits_charged: 6,
      total_provider_credits: 1,
      turn_id: 'turn-1',
      user_id: 'user-1',
    };
    mocks.authorize.mockResolvedValue({
      balance: 94,
      duplicateRound,
      ok: true,
      turn: {
        ...turn,
        credits_charged: 6,
        next_round_index: 1,
        provider_credits: 1,
        status: 'completed',
      },
    });
    const exactResponse = { output: [{ type: 'message', content: [{ text: 'Replay me' }] }] };
    mocks.replay.mockResolvedValue({
      balance: 94,
      creditsCharged: 6,
      ledgerEntryId: 'ledger-1',
      providerCredits: 1,
      replayed: true,
      response: exactResponse,
      totalCreditsCharged: 6,
      totalProviderCredits: 1,
      turnCompleted: true,
      usage: {
        cachedInputTokens: null,
        hasMoreTools: false,
        inputTokens: 10,
        outputTokens: 2,
        providerCredits: 1,
        reasoningTokens: null,
        toolCallCount: 0,
      },
    });

    const response = await onRequest(contextFor({
      billingRoundIndex: 0,
      billingTurnId: 'turn-1',
      idempotencyKey: 'turn-1:openai-responses:0',
      input: [{ content: 'Retry', role: 'user' }],
      model: 'gpt-5-6-terra',
      protocol: 'openai-responses',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: exactResponse, ok: true });
    expect(mocks.replay).toHaveBeenCalledWith(db, 'user-1', duplicateRound);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.insertChatLog).not.toHaveBeenCalled();
  });
});
