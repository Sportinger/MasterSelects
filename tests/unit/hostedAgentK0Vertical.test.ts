import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DatabaseSync,
  type StatementSync,
} from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/kernel/[[path]]';
import type {
  AppContext,
  AppD1Database,
  AppD1Statement,
  Env,
} from '../../functions/lib/env';
import {
  HOSTED_AGENT_HEADERS,
  hostedAgentRoundIdempotencyKey,
  type HostedAgentK1ToolBatchResult,
  type HostedAgentK1TurnRequest,
} from '../../src/services/kernelClient/hostedAgent/contracts';

const SERVICE_SECRET = 'hosted-agent-k0-fixture-secret-at-least-thirty-two-characters';
const KERNEL_TOKEN = 'fixture-kernel-token';
const TURN_ID = 'turn-k0-vertical';
const CLIENT_ID = 'client-k0-tab';
const USER_ID = 'user-k0';
const PROMPT_SENTINEL = 'PROMPT_MUST_NOT_REACH_D1';
const TOOL_RESULT_SENTINEL = 'TOOL_RESULT_MUST_NOT_REACH_D1';

interface TestEnv extends Env {
  KERNEL_SERVICE_ASSERTION_SECRET: string;
}

class SqliteD1Statement implements AppD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): AppD1Statement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.statement().all(...this.values) as T[] };
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.statement().get(...this.values) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return (columnName ? row[columnName] : row) as T;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.statement();
    statement.setReturnArrays(true);
    return statement.all(...this.values) as T[];
  }

  async run(): Promise<unknown> {
    return this.statement().run(...this.values);
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

class SqliteD1Database implements AppD1Database {
  constructor(readonly database = new DatabaseSync(':memory:')) {
    this.database.exec('PRAGMA foreign_keys = ON');
  }

  async batch<T>(statements: AppD1Statement[]): Promise<T[]> {
    this.database.exec('BEGIN IMMEDIATE');
    this.database.exec('PRAGMA defer_foreign_keys = ON');
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec('COMMIT');
      return results as T[];
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(query: string): Promise<unknown> {
    return this.database.exec(query);
  }

  prepare(query: string): AppD1Statement {
    return new SqliteD1Statement(this.database, query);
  }
}

let sqlite: SqliteD1Database;
let db: AppD1Database;
let env: TestEnv;

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'migrations', name), 'utf8');
}

function context(input: {
  body?: unknown;
  headers?: HeadersInit;
  method: 'GET' | 'POST';
  path: string;
  serviceBodyText?: string;
  user?: boolean;
}): AppContext {
  const headers = new Headers(input.headers);
  let body: string | undefined;
  if (input.serviceBodyText !== undefined) {
    body = input.serviceBodyText;
  } else if (input.body !== undefined) {
    body = JSON.stringify(input.body);
  }
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return {
    data: {
      requestId: crypto.randomUUID(),
      user: input.user === false
        ? null
        : { email: 'k0@example.test', id: USER_ID },
    },
    env,
    next: async () => new Response(null),
    params: { path: input.path },
    request: new Request(`https://masterselects.test/api/kernel/${input.path}`, {
      body,
      headers,
      method: input.method,
    }),
    waitUntil: vi.fn(),
  };
}

function turnRequest(): HostedAgentK1TurnRequest {
  return {
    clientCapabilities: {
      maximumInlineResultCharacters: 1_000_000,
      supportsImageResultRefs: true,
      supportsNarrationDeltas: true,
      toolNames: ['inspect_timeline'],
    },
    clientInstanceId: CLIENT_ID,
    contextSummary: `context:${PROMPT_SENTINEL}`,
    historyFormatVersion: 'history-v1',
    maximumOutputTokens: 32_000,
    maxTurnSpendCredits: 20,
    model: 'gpt-5-6-terra',
    modelPrompt: `model:${PROMPT_SENTINEL}`,
    playbookPrompt: `playbook:${PROMPT_SENTINEL}`,
    promptVersion: 'prompt-v1',
    providerInput: {
      input: [{ role: 'user', content: 'Inspect the timeline without changing it.' }],
      protocol: 'openai-responses',
      store: false,
      tools: [{ name: 'inspect_timeline', type: 'function' }],
    },
    reasoningEffort: 'medium',
    request: 'Inspect the timeline without changing it.',
    runSource: 'ui',
    systemPrompt: `system:${PROMPT_SENTINEL}`,
    toolExecutionMode: 'read-only',
    toolSchemaVersion: 'tools-v1',
    turnId: TURN_ID,
    visualReferences: [],
  };
}

beforeAll(async () => {
  sqlite = new SqliteD1Database();
  await sqlite.exec([
    migration('0001_users_and_auth.sql'),
    migration('0003_credits_and_usage.sql'),
    migration('0004_credit_ledger_source_uniques.sql'),
    migration('0014_ai_chat_turn_billing.sql'),
    migration('0015_hosted_agent_k0.sql'),
    migration('0016_hosted_agent_k2.sql'),
    migration('0017_ai_chat_turn_terminal_statuses.sql'),
  ].join('\n'));
  db = sqlite;
  await db
    .prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)')
    .bind(USER_ID, 'k0@example.test', 'K0')
    .run();
  await db
    .prepare(
      `INSERT INTO credit_ledger (
         id, user_id, entry_type, amount, balance_after, source, source_id, description
       ) VALUES (?, ?, 'grant', 100, 100, 'test:grant', ?, 'K0 fixture')`,
    )
    .bind('grant-k0', USER_ID, 'grant-k0')
    .run();
  env = {
    DB: db,
    KERNEL_AUTH_TOKEN: KERNEL_TOKEN,
    KERNEL_ORIGIN: 'https://fixture.kernel.test',
    KERNEL_SERVICE_ASSERTION_SECRET: SERVICE_SECRET,
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
  };
});

afterAll(async () => {
  sqlite.database.close();
});

describe('hosted-agent K2 public boundary', () => {
  it('decodes percent-encoded turn IDs from the Pages catch-all route', async () => {
    const response = await onRequest(context({
      method: 'GET',
      path: 'hosted-agent/turns/missing%3Aturn/events',
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'turn_not_found' });
  });

  it('runs a reconnectable, client-authoritative, multi-round D1-billed vertical slice', async () => {
    let serviceAssertion = '';
    let sessionId = '';
    let forwardedCursor: string | null = null;
    let forwardedToolResult = '';
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (requestInfo, init) => {
        const url = new URL(String(requestInfo));
        const headers = new Headers(init?.headers);
        expect(init?.redirect).toBe('manual');
        expect(headers.get('Authorization')).toBe(`Bearer ${KERNEL_TOKEN}`);
        expect(headers.get(HOSTED_AGENT_HEADERS.protocolVersion)).toBe('hosted-agent-k2-v1');
        expect(headers.get(HOSTED_AGENT_HEADERS.serviceAssertion)).toBeTruthy();

        if (url.pathname === '/kernel/hosted-agent/turns') {
          serviceAssertion = headers.get(HOSTED_AGENT_HEADERS.serviceAssertion) ?? '';
          const forwarded = JSON.parse(String(init?.body)) as Record<string, unknown>;
          sessionId = String(forwarded.sessionId);
          expect(forwarded.maximumIterations).toBe(400);
          expect(forwarded.maximumSpendCredits).toBe(20);
          expect(forwarded.systemPrompt).toContain(PROMPT_SENTINEL);
          return new Response(JSON.stringify({
            acceptedHistoryFormatVersion: forwarded.acceptedHistoryFormatVersion,
            acceptedPromptVersion: forwarded.acceptedPromptVersion,
            acceptedToolSchemaVersion: forwarded.acceptedToolSchemaVersion,
            maximumIterations: forwarded.maximumIterations,
            maximumSpendCredits: forwarded.maximumSpendCredits,
            pageLease: {
              expiresAt: '2026-07-30T12:05:00.000Z',
              leaseToken: 'test-page-lease',
              sessionId,
            },
            protocolVersion: forwarded.protocolVersion,
            replayed: forwarded.replayed,
            route: 'fast-agent',
            sessionId,
            turnId: TURN_ID,
          }), {
            headers: {
              'Content-Type': 'application/json; profile="hosted-agent-k2"',
              [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
            },
            status: 201,
          });
        }

        if (url.pathname.endsWith('/events')) {
          forwardedCursor = headers.get(HOSTED_AGENT_HEADERS.lastEventId);
          const events = forwardedCursor === '1'
            ? [
                `id: 2\nevent: narration-complete\ndata: {"eventId":"2","sessionId":"${sessionId}","turnId":"${TURN_ID}","kind":"narration-complete","phase":"inspecting","roundIndex":0,"text":"Inspection complete."}\n\n`,
                `id: 3\nevent: narration-complete\ndata: {"eventId":"3","sessionId":"${sessionId}","turnId":"${TURN_ID}","kind":"narration-complete","phase":"verifying","roundIndex":0,"text":"Ready."}\n\n`,
              ].join('')
            : [
                `id: 1\nevent: session-ready\ndata: {"eventId":"1","sessionId":"${sessionId}","turnId":"${TURN_ID}","kind":"session-ready","acceptedPromptVersion":"prompt-v1","acceptedHistoryFormatVersion":"history-v1","acceptedToolSchemaVersion":"tools-v1","maximumIterations":400,"maximumSpendCredits":20}\n\n`,
                `id: 2\nevent: narration-complete\ndata: {"eventId":"2","sessionId":"${sessionId}","turnId":"${TURN_ID}","kind":"narration-complete","phase":"inspecting","roundIndex":0,"text":"Inspection complete."}\n\n`,
              ].join('');
          return new Response(events, {
            headers: {
              'Cache-Control': 'no-cache',
              'Content-Type': 'text/event-stream; charset=utf-8',
              [HOSTED_AGENT_HEADERS.eventCursor]: forwardedCursor === '1' ? '3' : '2',
              [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
              'X-Accel-Buffering': 'no',
            },
          });
        }

        if (url.pathname.endsWith('/tool-results')) {
          forwardedToolResult = String(init?.body);
          return new Response('{"accepted":true}', {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            status: 202,
          });
        }
        return new Response('not found', { status: 404 });
      },
    );

    const start = await onRequest(context({
      body: turnRequest(),
      method: 'POST',
      path: 'hosted-agent/turns',
    }));
    expect(start.status).toBe(201);
    expect(start.headers.get('Content-Type')).toBe('application/json; profile="hosted-agent-k2"');
    expect(start.headers.has(HOSTED_AGENT_HEADERS.serviceAssertion)).toBe(false);
    expect(await start.json()).toMatchObject({
      maximumIterations: 400,
      maximumSpendCredits: 20,
      sessionId,
      turnId: TURN_ID,
    });

    const sessionHeaders = {
      [HOSTED_AGENT_HEADERS.clientInstanceId]: CLIENT_ID,
      [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
    };
    const initialEvents = await onRequest(context({
      headers: sessionHeaders,
      method: 'GET',
      path: `hosted-agent/turns/${TURN_ID}/events`,
    }));
    const initialEventText = await initialEvents.text();
    expect(initialEvents.status).toBe(200);
    expect(initialEvents.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(initialEvents.headers.get(HOSTED_AGENT_HEADERS.eventCursor)).toBe('2');
    expect([...initialEventText.matchAll(/^id: (\d+)$/gm)].map((match) => match[1]))
      .toEqual(['1', '2']);

    const reconnectEvents = await onRequest(context({
      headers: {
        ...sessionHeaders,
        [HOSTED_AGENT_HEADERS.lastEventId]: '1',
      },
      method: 'GET',
      path: `hosted-agent/turns/${TURN_ID}/events`,
    }));
    const reconnectEventText = await reconnectEvents.text();
    expect(forwardedCursor).toBe('1');
    expect(reconnectEvents.headers.get(HOSTED_AGENT_HEADERS.eventCursor)).toBe('3');
    expect([...reconnectEventText.matchAll(/^id: (\d+)$/gm)].map((match) => match[1]))
      .toEqual(['2', '3']);

    const largeModelContent = `${TOOL_RESULT_SENTINEL}:${'x'.repeat(256 * 1024)}`;
    const toolResult: HostedAgentK1ToolBatchResult = {
      authority: {
        approval: 'not-required',
        executionMode: 'read-only',
        policyChecked: true,
        stateRevisionAfter: 'timeline:1',
        stateRevisionBefore: 'timeline:1',
        validationPassed: true,
      },
      clientInstanceId: CLIENT_ID,
      results: [{
        modelContent: largeModelContent,
        success: true,
        toolCallId: 'tool-call-1',
      }],
      sequence: 0,
      sessionId,
      toolSchemaVersion: 'tools-v1',
      turnId: TURN_ID,
    };
    const toolResultText = JSON.stringify(toolResult);
    const toolResultBytes = new TextEncoder().encode(toolResultText).byteLength;
    const toolResultStartedAt = performance.now();
    const toolResultResponse = await onRequest(context({
      headers: sessionHeaders,
      method: 'POST',
      path: `hosted-agent/turns/${TURN_ID}/tool-results`,
      serviceBodyText: toolResultText,
    }));
    const toolResultLatencyMs = performance.now() - toolResultStartedAt;
    expect(toolResultResponse.status).toBe(202);
    expect(forwardedToolResult).toBe(toolResultText);
    expect(new TextEncoder().encode(forwardedToolResult).byteLength).toBe(toolResultBytes);

    const idempotencyKey = hostedAgentRoundIdempotencyKey(TURN_ID, 0);
    const serviceHeaders = {
      Authorization: `Bearer ${KERNEL_TOKEN}`,
      [HOSTED_AGENT_HEADERS.serviceAssertion]: serviceAssertion,
    };
    const authorization = await onRequest(context({
      body: { idempotencyKey, roundIndex: 0 },
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/0/authorize`,
      user: false,
    }));
    expect(authorization.status).toBe(200);
    expect(await authorization.json()).toMatchObject({
      maximumIterations: 400,
      replayed: false,
      roundIndex: 0,
      status: 'authorized',
      turnId: TURN_ID,
    });

    const settlementBody = {
      cachedInputTokens: 8,
      idempotencyKey,
      inputTokens: 120,
      outputTokens: 24,
      providerCredits: 1,
      providerResultDigest: 'a'.repeat(64),
      reasoningTokens: 4,
      roundIndex: 0,
    };
    const settled = await onRequest(context({
      body: settlementBody,
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/0/settle`,
      user: false,
    }));
    expect(settled.status).toBe(200);
    expect(await settled.json()).toMatchObject({
      creditBalance: 94,
      creditsCharged: 6,
      replayed: false,
      totalCreditsCharged: 6,
      turnStatus: 'active',
    });

    const replayedSettlement = await onRequest(context({
      body: settlementBody,
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/0/settle`,
      user: false,
    }));
    expect(replayedSettlement.status).toBe(200);
    expect(await replayedSettlement.json()).toMatchObject({
      creditBalance: 94,
      replayed: true,
      totalCreditsCharged: 6,
    });

    const conflictingReplay = await onRequest(context({
      body: {
        ...settlementBody,
        providerResultDigest: 'b'.repeat(64),
      },
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/0/settle`,
      user: false,
    }));
    expect(conflictingReplay.status).toBe(409);
    expect(await conflictingReplay.json()).toMatchObject({ error: 'round_conflict' });

    const excessIteration = await onRequest(context({
      body: {
        idempotencyKey: hostedAgentRoundIdempotencyKey(TURN_ID, 400),
        roundIndex: 400,
      },
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/400/authorize`,
      user: false,
    }));
    expect(excessIteration.status).toBe(409);
    expect(await excessIteration.json()).toMatchObject({ error: 'iteration_limit' });

    const completed = await onRequest(context({
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/complete`,
      user: false,
    }));
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({
      creditsCharged: 6,
      terminalReason: 'explicit_complete',
      turnId: TURN_ID,
      turnStatus: 'completed',
    });

    const terminalReconnect = await onRequest(context({
      body: turnRequest(),
      method: 'POST',
      path: 'hosted-agent/turns',
    }));
    expect(terminalReconnect.status).toBe(201);
    expect(await terminalReconnect.json()).toMatchObject({
      replayed: true,
      sessionId,
      turnId: TURN_ID,
    });

    const ledger = await db.prepare(
      `SELECT amount, source, source_id, metadata_json
       FROM credit_ledger
       WHERE user_id = ? AND source = 'hosted:ai_chat'`,
    ).bind(USER_ID).all<Record<string, unknown>>();
    expect(ledger.results).toHaveLength(1);
    expect(ledger.results[0]).toMatchObject({
      amount: -6,
      source_id: idempotencyKey,
    });

    const persisted = await db.prepare(
      `SELECT h.*, t.provider_credits, t.credits_charged, t.status AS billing_status,
              r.response_json
       FROM hosted_agent_k0_turns h
       JOIN ai_chat_turns t ON t.id = h.billing_turn_id
       JOIN ai_chat_turn_rounds r ON r.turn_id = t.id
       WHERE h.turn_id = ?`,
    ).bind(TURN_ID).all<Record<string, unknown>>();
    const persistedText = JSON.stringify(persisted.results);
    expect(persistedText).not.toContain(PROMPT_SENTINEL);
    expect(persistedText).not.toContain(TOOL_RESULT_SENTINEL);
    expect(persistedText).not.toContain(largeModelContent);
    expect(persisted.results[0]).toMatchObject({
      accepted_max_spend_credits: 20,
      billing_status: 'completed',
      credits_charged: 6,
      maximum_iterations: 400,
      model: 'gpt-5-6-terra',
      provider_protocol: 'openai-responses',
      status: 'completed',
      user_id: USER_ID,
    });

    const sseResponseBytes = new TextEncoder().encode(
      initialEventText + reconnectEventText,
    ).byteLength;
    console.info('HOSTED_AGENT_K0_METRICS', JSON.stringify({
      controlledUpstream: true,
      sseResponseBytes,
      toolResultBytes,
      toolResultProxyLatencyMs: Number(toolResultLatencyMs.toFixed(3)),
      upstreamToolResultEgressBytes: toolResultBytes,
    }));
    expect(toolResultBytes).toBeGreaterThan(256 * 1024);
    expect(toolResultLatencyMs).toBeLessThan(2_000);
    upstreamFetch.mockRestore();
  });

  it('rejects unsigned service billing requests', async () => {
    const unsigned = await onRequest(context({
      body: {
        idempotencyKey: hostedAgentRoundIdempotencyKey(TURN_ID, 0),
        roundIndex: 0,
      },
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/rounds/0/authorize`,
      user: false,
    }));
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toMatchObject({ error: 'service_assertion_required' });
  });

  it('cancels the durable billing turn when the private fast-agent cannot start', async () => {
    const failedTurnId = 'turn-k2-origin-start-failed';
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'hosted_agent_not_configured' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503,
      }),
    );
    const response = await onRequest(context({
      body: { ...turnRequest(), turnId: failedTurnId },
      method: 'POST',
      path: 'hosted-agent/turns',
    }));
    expect(response.status).toBe(503);
    const rows = await db.prepare(
      `SELECT h.status, t.status AS billing_status
       FROM hosted_agent_k0_turns h
       JOIN ai_chat_turns t ON t.id = h.billing_turn_id
       WHERE h.turn_id = ?`,
    ).bind(failedTurnId).all<Record<string, unknown>>();
    expect(rows.results).toEqual([expect.objectContaining({
      billing_status: 'cancelled',
      status: 'cancelled',
    })]);
    upstreamFetch.mockRestore();
  });
});
