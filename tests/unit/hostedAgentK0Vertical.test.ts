// @vitest-environment node

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
import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  hostedAgentFastV2RoundIdempotencyKey,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent/fastV2StartContract';
import {
  cancelHostedAgentK0Turn,
  getHostedAgentK0Turn,
} from '../../functions/lib/hostedAgent/billing';

const SERVICE_SECRET = 'hosted-agent-k0-fixture-secret-at-least-thirty-two-characters';
const KERNEL_TOKEN = 'fixture-kernel-token';
const TURN_ID = 'turn-k0-vertical';
const CLIENT_ID = 'client-k0-tab';
const USER_ID = 'user-k0';
const PROMPT_SENTINEL = 'PROMPT_MUST_NOT_REACH_D1';
const TOOL_RESULT_SENTINEL = 'TOOL_RESULT_MUST_NOT_REACH_D1';
const OPERATION_STATE_FINGERPRINT =
  'sha256:2222222222222222222222222222222222222222222222222222222222222222';

interface TestEnv extends Env {
  HOSTED_AGENT_FAST_V2_CANARY_PERCENT: string;
  HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: string;
  HOSTED_AGENT_FAST_V2_ENABLED: string;
  HOSTED_AGENT_VERIFIED_PILOT_ENABLED?: string;
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

function decodeAssertionClaims(assertion: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
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

function fastV2TurnRequest(turnId = 'turn-fast-v2-vertical'): HostedAgentFastV2StartRequest {
  return {
    clientInstanceId: CLIENT_ID,
    compactSnapshot: {
      payload: {
        clips: [{ duration: 5, id: 'clip:1', startTime: 0, trackId: 'track:1' }],
        tracks: [{ id: 'track:1', type: 'video' }],
      },
      schemaVersion: 1,
      stateFingerprint: OPERATION_STATE_FINGERPRINT,
      timelineRevision: 7,
    },
    editorBuildId: '2.4.4',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    protocolVersion: 'fast-agent-v2',
    request: `Remove the selected range. ${PROMPT_SENTINEL}`,
    requestedExecutionMode: 'normal',
    requestedModelClass: 'fast',
    runSource: 'ui',
    turnId,
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
    migration('0018_hosted_agent_fast_v2_bindings.sql'),
    migration('0019_hosted_agent_fast_v2_execution_profile.sql'),
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
    HOSTED_AGENT_FAST_V2_CANARY_PERCENT: '100',
    HOSTED_AGENT_FAST_V2_EMERGENCY_ROLLBACK: 'false',
    HOSTED_AGENT_FAST_V2_ENABLED: 'true',
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
    let forwardedOperationResult = '';
    let forwardedOperationSettlement = '';
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
        if (url.pathname.endsWith('/operation-results')) {
          forwardedOperationResult = String(init?.body);
          expect(headers.get(HOSTED_AGENT_HEADERS.pageLease)).toBe('test-page-lease');
          return new Response('{"accepted":true,"sequence":0}', {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            status: 200,
          });
        }
        if (url.pathname.endsWith('/operation-settlements')) {
          forwardedOperationSettlement = String(init?.body);
          expect(headers.get(HOSTED_AGENT_HEADERS.pageLease)).toBe('test-page-lease');
          return new Response('{"accepted":true,"sequence":0}', {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            status: 200,
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
      [HOSTED_AGENT_HEADERS.pageLease]: 'test-page-lease',
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
        providerContent: {
          openAiFollowupInput: [{
            content: [
              { text: 'Visual output from captureFrame:', type: 'input_text' },
              {
                detail: 'high',
                image_url: 'data:image/png;base64,iVBORw0KGgo=',
                type: 'input_image',
              },
            ],
            role: 'user',
          }],
        },
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

    const operationResult = {
      result: {
        batchId: 'k0-operation-batch',
        capabilitySetId: 'k0-operation-capabilities',
        clientInstanceId: CLIENT_ID,
        kind: 'operation-plan-result',
        preparedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        result: {
          batchId: 'k0-operation-batch',
          results: [{
            operationId: 'timeline.visual.capture-grid.v1',
            result: {
              data: {
                frameTimes: [1.5, 7.5],
                imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              },
              success: true,
            },
            sequence: 1,
          }],
          success: true,
        },
        schemaVersion: 1,
        sequence: 0,
        sessionId,
        stateRevisionAfter: 4,
        stateRevisionBefore: 4,
        status: 'prepared',
        turnId: TURN_ID,
      },
    };
    const operationResultResponse = await onRequest(context({
      body: operationResult,
      headers: sessionHeaders,
      method: 'POST',
      path: `hosted-agent/turns/${TURN_ID}/operation-results`,
    }));
    expect(operationResultResponse.status).toBe(200);
    expect(JSON.parse(forwardedOperationResult)).toEqual(operationResult);

    for (const [operationId, projectedResult] of [
      ['timeline.editor.catalog.v1', { success: true }],
      ['timeline.editor.inspect.v1', { data: { inspected: true }, success: true }],
      ['timeline.editor.mutate.v1', { data: { updated: true }, success: true }],
      ['timeline.editor.destructive.v1', { data: { deleted: true }, success: true }],
    ] as const) {
      const progressiveOperationResult = {
        result: {
          ...operationResult.result,
          result: {
            batchId: operationResult.result.batchId,
            results: [{
              operationId,
              result: projectedResult,
              sequence: 1,
            }],
            success: true,
          },
        },
      };
      const progressiveResponse = await onRequest(context({
        body: progressiveOperationResult,
        headers: sessionHeaders,
        method: 'POST',
        path: `hosted-agent/turns/${TURN_ID}/operation-results`,
      }));
      expect(progressiveResponse.status).toBe(200);
      expect(JSON.parse(forwardedOperationResult)).toEqual(progressiveOperationResult);
    }

    const operationSettlement = {
      receipt: {
        batchId: 'k0-operation-batch',
        capabilitySetId: 'k0-operation-capabilities',
        clientInstanceId: CLIENT_ID,
        committedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        kind: 'operation-plan-settlement-receipt',
        outcome: 'committed',
        preparedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        schemaVersion: 1,
        sequence: 0,
        sessionId,
        simulatedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        stateRevisionAfterSettlement: 5,
        turnId: TURN_ID,
      },
    };
    const operationSettlementResponse = await onRequest(context({
      body: operationSettlement,
      headers: sessionHeaders,
      method: 'POST',
      path: `hosted-agent/turns/${TURN_ID}/operation-settlements`,
    }));
    expect(operationSettlementResponse.status).toBe(200);
    expect(JSON.parse(forwardedOperationSettlement)).toEqual(operationSettlement);

    const rejectedUnboundOperationResult = await onRequest(context({
      body: {
        result: {
          ...operationResult.result,
          clientInstanceId: 'different-client',
        },
      },
      headers: sessionHeaders,
      method: 'POST',
      path: `hosted-agent/turns/${TURN_ID}/operation-results`,
    }));
    expect(rejectedUnboundOperationResult.status).toBe(400);
    expect(await rejectedUnboundOperationResult.json()).toMatchObject({
      error: 'invalid_operation_result',
    });

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
      toolCallCount: 1,
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

    await db.prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'active', completed_at = NULL
       WHERE turn_id = ? AND user_id = ?`,
    ).bind(TURN_ID, USER_ID).run();
    const healedPartialCompletion = await onRequest(context({
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/complete`,
      user: false,
    }));
    expect(healedPartialCompletion.status).toBe(200);
    expect(await healedPartialCompletion.json()).toMatchObject({
      turnId: TURN_ID,
      turnStatus: 'completed',
    });
    const cleanupAfterCompletion = await onRequest(context({
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/fail`,
      user: false,
    }));
    expect(cleanupAfterCompletion.status).toBe(200);
    expect(await cleanupAfterCompletion.json()).toEqual({
      terminalReason: 'completed',
      turnId: TURN_ID,
      turnStatus: 'completed',
    });
    const replayedCompletion = await onRequest(context({
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${TURN_ID}/complete-replay`,
      user: false,
    }));
    expect(replayedCompletion.status).toBe(200);
    expect(await replayedCompletion.json()).toMatchObject({
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
              r.response_json, r.tool_call_count, r.has_more_tools
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
      tool_call_count: 1,
      has_more_tools: 1,
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

    await db.prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'active', completed_at = NULL
       WHERE turn_id = ? AND user_id = ?`,
    ).bind(failedTurnId, USER_ID).run();
    const partiallyCancelled = await getHostedAgentK0Turn(db, USER_ID, failedTurnId);
    expect(partiallyCancelled).not.toBeNull();
    await cancelHostedAgentK0Turn(db, partiallyCancelled!);

    await db.prepare(
      `UPDATE ai_chat_turns
       SET status = 'active', terminal_reason = NULL, completed_at = NULL
       WHERE id = ? AND user_id = ?`,
    ).bind(partiallyCancelled!.billing_turn_id, USER_ID).run();
    const hostedAlreadyCancelled = await getHostedAgentK0Turn(db, USER_ID, failedTurnId);
    expect(hostedAlreadyCancelled?.status).toBe('cancelled');
    await cancelHostedAgentK0Turn(db, hostedAlreadyCancelled!);

    const healedRows = await db.prepare(
      `SELECT h.status, t.status AS billing_status
       FROM hosted_agent_k0_turns h
       JOIN ai_chat_turns t ON t.id = h.billing_turn_id
       WHERE h.turn_id = ?`,
    ).bind(failedTurnId).all<Record<string, unknown>>();
    expect(healedRows.results).toEqual([expect.objectContaining({
      billing_status: 'cancelled',
      status: 'cancelled',
    })]);
    const cleanupAfterCancel = await onRequest(context({
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${failedTurnId}/fail`,
      user: false,
    }));
    expect(cleanupAfterCancel.status).toBe(200);
    expect(await cleanupAfterCancel.json()).toEqual({
      terminalReason: 'explicit_cancel',
      turnId: failedTurnId,
      turnStatus: 'cancelled',
    });
    upstreamFetch.mockRestore();
  });

  it('does not let a browser bypass the server-owned Fast V2 rollout flag', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 201 }),
    );
    env.HOSTED_AGENT_FAST_V2_ENABLED = 'false';
    try {
      const selection = await onRequest(context({
        method: 'GET',
        path: 'hosted-agent/protocol',
      }));
      expect(selection.status).toBe(200);
      expect(await selection.json()).toEqual({
        availableExecutionProfiles: ['fast'],
        protocolVersion: 'hosted-agent-k2-v1',
        reason: 'feature_disabled',
      });

      const response = await onRequest(context({
        body: fastV2TurnRequest('turn-fast-v2-flag-bypass'),
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'fast_v2_not_enabled' });
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      env.HOSTED_AGENT_FAST_V2_ENABLED = 'true';
      upstreamFetch.mockRestore();
    }
  });

  it('keeps the Verified V2 profile disabled by default before D1 or private egress', async () => {
    const turnId = 'turn-fast-v2-verified-default-off';
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 201 }),
    );
    delete env.HOSTED_AGENT_VERIFIED_PILOT_ENABLED;
    try {
      const response = await onRequest(context({
        body: {
          ...fastV2TurnRequest(turnId),
          executionProfile: 'verified',
        },
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'verified_profile_not_enabled',
      });
      expect(upstreamFetch).not.toHaveBeenCalled();
      expect(await db.prepare(
        'SELECT turn_id FROM hosted_agent_k0_turns WHERE turn_id = ?',
      ).bind(turnId).first()).toBeNull();
      expect(await db.prepare(
        'SELECT turn_id FROM hosted_agent_fast_v2_bindings WHERE turn_id = ?',
      ).bind(turnId).first()).toBeNull();
    } finally {
      delete env.HOSTED_AGENT_VERIFIED_PILOT_ENABLED;
      upstreamFetch.mockRestore();
    }
  });

  it('binds an enabled Verified V2 profile through D1, assertions, and settlements', async () => {
    const request = {
      ...fastV2TurnRequest('turn-fast-v2-verified-settlement'),
      executionProfile: 'verified' as const,
    };
    let forwardedSettlement: unknown;
    let firstSettlementBody = '';
    let serviceAssertion = '';
    let sessionId = '';
    const forwardedAssertionClaims: Record<string, unknown>[] = [];
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (requestInfo, init) => {
        const url = new URL(String(requestInfo));
        const assertion = new Headers(init?.headers)
          .get(HOSTED_AGENT_HEADERS.serviceAssertion) ?? '';
        forwardedAssertionClaims.push(decodeAssertionClaims(assertion));
        if (url.pathname === '/kernel/hosted-agent/v2/turns') {
          serviceAssertion = assertion;
          const envelope = JSON.parse(String(init?.body)) as {
            browserRequest: HostedAgentFastV2StartRequest;
            edge: { executionProfile: string; sessionId: string };
          };
          expect(envelope.browserRequest.executionProfile).toBe('verified');
          expect(envelope.edge.executionProfile).toBe('verified');
          sessionId = envelope.edge.sessionId;
          return new Response(JSON.stringify({
            pageLease: {
              expiresAt: '2026-08-01T15:15:00.000Z',
              leaseToken: 'verified-v2-page-lease',
              sessionId,
            },
            protocolVersion: 'fast-agent-v2',
            route: 'fast-agent-v2',
            sessionId,
            turnId: request.turnId,
          }), { status: 201 });
        }
        if (
          url.pathname
          === `/kernel/hosted-agent/v2/turns/${request.turnId}/operation-settlements`
        ) {
          const settlementBody = String(init?.body);
          forwardedSettlement = JSON.parse(settlementBody);
          if (firstSettlementBody === '') {
            firstSettlementBody = settlementBody;
            return new Response(JSON.stringify({ accepted: true, replayed: false }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            });
          }
          if (settlementBody === firstSettlementBody) {
            return new Response(JSON.stringify({ accepted: true, replayed: true }), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            });
          }
          return new Response(JSON.stringify({
            error: 'operation_settlement_conflict',
          }), {
            headers: { 'Content-Type': 'application/json' },
            status: 409,
          });
        }
        throw new Error(`Unexpected Verified V2 upstream path: ${url.pathname}`);
      },
    );
    env.HOSTED_AGENT_VERIFIED_PILOT_ENABLED = 'true';
    try {
      const start = await onRequest(context({
        body: request,
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }));
      expect(start.status).toBe(201);
      expect(forwardedAssertionClaims[0]).toMatchObject({
        executionProfile: 'verified',
        sessionId,
        turnId: request.turnId,
      });

      const persisted = await db.prepare(
        `SELECT execution_profile, snapshot_state_fingerprint,
                snapshot_timeline_revision
         FROM hosted_agent_fast_v2_bindings
         WHERE turn_id = ?`,
      ).bind(request.turnId).first<Record<string, unknown>>();
      expect(persisted).toMatchObject({
        execution_profile: 'verified',
        snapshot_state_fingerprint: request.compactSnapshot.stateFingerprint,
        snapshot_timeline_revision: request.compactSnapshot.timelineRevision,
      });

      const receipt = {
        batchId: 'batch-fast-v2-verified-settlement',
        capabilitySetId: 'fast-v2-remove-ranges-v1',
        clientInstanceId: request.clientInstanceId,
        committedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        kind: 'operation-plan-settlement-receipt',
        outcome: 'committed',
        preparedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        schemaVersion: 1,
        sequence: 0,
        sessionId,
        simulatedStateFingerprint: OPERATION_STATE_FINGERPRINT,
        stateRevisionAfterSettlement: 8,
        turnId: request.turnId,
      };
      const settlement = await onRequest(context({
        body: { receipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.pageLease]: 'verified-v2-page-lease',
          [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
      }));
      expect(settlement.status).toBe(200);
      expect(await settlement.json()).toEqual({ accepted: true, replayed: false });
      expect(forwardedSettlement).toEqual({ receipt });
      expect(forwardedAssertionClaims[1]).toMatchObject({
        executionProfile: 'verified',
        sessionId,
        turnId: request.turnId,
      });

      const completedAt = '2026-08-01T15:16:00.000Z';
      await db.prepare(
        `UPDATE hosted_agent_k0_turns
         SET status = 'completed', updated_at = ?, completed_at = ?
         WHERE turn_id = ?`,
      ).bind(completedAt, completedAt, request.turnId).run();
      await db.prepare(
        `UPDATE ai_chat_turns
         SET status = 'completed', terminal_reason = 'explicit_complete',
             updated_at = ?, completed_at = ?
         WHERE id = (
           SELECT billing_turn_id FROM hosted_agent_k0_turns WHERE turn_id = ?
         )`,
      ).bind(completedAt, completedAt, request.turnId).run();

      const forwardedCountBeforeBindingChecks = forwardedAssertionClaims.length;
      const unauthenticatedReplay = await onRequest(context({
        body: { receipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
        user: false,
      }));
      expect(unauthenticatedReplay.status).toBe(401);
      expect(await unauthenticatedReplay.json()).toMatchObject({
        error: 'authentication_required',
      });
      const wrongSessionReplay = await onRequest(context({
        body: { receipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.sessionId]: 'wrong-verified-session',
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
      }));
      expect(wrongSessionReplay.status).toBe(409);
      expect(await wrongSessionReplay.json()).toMatchObject({
        error: 'session_binding_mismatch',
      });
      expect(forwardedAssertionClaims).toHaveLength(forwardedCountBeforeBindingChecks);

      const replay = await onRequest(context({
        body: { receipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.pageLease]: 'verified-v2-page-lease',
          [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
      }));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ accepted: true, replayed: true });
      expect(forwardedAssertionClaims[2]).toMatchObject({
        executionProfile: 'verified',
        sessionId,
        turnId: request.turnId,
      });

      const conflictingReceipt = {
        ...receipt,
        batchId: 'batch-fast-v2-verified-settlement-conflict',
      };
      const conflict = await onRequest(context({
        body: { receipt: conflictingReceipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.pageLease]: 'verified-v2-page-lease',
          [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
      }));
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: 'operation_settlement_conflict' });
      expect(forwardedAssertionClaims[3]).toMatchObject({
        executionProfile: 'verified',
        sessionId,
        turnId: request.turnId,
      });

      await db.prepare(
        `UPDATE hosted_agent_fast_v2_bindings
         SET execution_profile = 'fast'
         WHERE turn_id = ?`,
      ).bind(request.turnId).run();
      const mismatchedAssertion = await onRequest(context({
        body: {},
        headers: {
          Authorization: `Bearer ${KERNEL_TOKEN}`,
          [HOSTED_AGENT_HEADERS.serviceAssertion]: serviceAssertion,
        },
        method: 'POST',
        path: `hosted-agent/service/turns/${request.turnId}/rounds/0/authorize`,
        user: false,
      }));
      expect(mismatchedAssertion.status).toBe(401);
      expect(await mismatchedAssertion.json()).toMatchObject({ error: 'invalid_claims' });

      await db.prepare(
        `UPDATE hosted_agent_fast_v2_bindings
         SET execution_profile = 'verified'
         WHERE turn_id = ?`,
      ).bind(request.turnId).run();
      await db.prepare(
        `UPDATE hosted_agent_k0_turns
         SET status = 'cancelled', updated_at = ?
         WHERE turn_id = ?`,
      ).bind('2026-08-01T15:17:00.000Z', request.turnId).run();
      const forwardedCountBeforeCancelledReplay = forwardedAssertionClaims.length;
      const cancelledReplay = await onRequest(context({
        body: { receipt },
        headers: {
          [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
          [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
        },
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
      }));
      expect(cancelledReplay.status).toBe(409);
      expect(await cancelledReplay.json()).toMatchObject({ error: 'turn_terminal' });
      expect(forwardedAssertionClaims).toHaveLength(forwardedCountBeforeCancelledReplay);
    } finally {
      delete env.HOSTED_AGENT_VERIFIED_PILOT_ENABLED;
      upstreamFetch.mockRestore();
    }
  });

  it('reconciles a lost private cancel notification before events and blocks start replay', async () => {
    const request = fastV2TurnRequest('turn-fast-v2-cancel-reconcile');
    let cancelAttempts = 0;
    let eventsCalls = 0;
    let sessionId = '';
    let startCalls = 0;
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (requestInfo, init) => {
        const url = new URL(String(requestInfo));
        if (url.pathname === '/kernel/hosted-agent/v2/turns') {
          startCalls += 1;
          const envelope = JSON.parse(String(init?.body)) as {
            edge: { sessionId: string };
          };
          sessionId = envelope.edge.sessionId;
          return new Response(JSON.stringify({
            pageLease: {
              expiresAt: '2026-08-01T15:15:00.000Z',
              leaseToken: 'fast-v2-cancel-lease',
              sessionId,
            },
            protocolVersion: 'fast-agent-v2',
            route: 'fast-agent-v2',
            sessionId,
            turnId: request.turnId,
          }), { status: 201 });
        }
        if (url.pathname.endsWith('/cancel')) {
          cancelAttempts += 1;
          if (cancelAttempts === 1) throw new Error('lost origin cancel notification');
          return new Response(JSON.stringify({
            turnId: request.turnId,
            turnStatus: 'cancelled',
          }), { status: 200 });
        }
        if (url.pathname.endsWith('/events')) {
          eventsCalls += 1;
          return new Response(
            `id: 1\nevent: turn-canceled\ndata: {"eventId":"1","kind":"turn-canceled","message":"cancelled","protocolVersion":"fast-agent-v2","recoverable":false,"sessionId":"${sessionId}","turnId":"${request.turnId}"}\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      },
    );
    try {
      expect((await onRequest(context({
        body: request,
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }))).status).toBe(201);
      const sessionHeaders = {
        [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
        [HOSTED_AGENT_HEADERS.pageLease]: 'fast-v2-cancel-lease',
        [HOSTED_AGENT_HEADERS.sessionId]: sessionId,
      };
      expect((await onRequest(context({
        headers: sessionHeaders,
        method: 'POST',
        path: `hosted-agent/v2/turns/${request.turnId}/cancel`,
      }))).status).toBe(200);
      expect(cancelAttempts).toBe(1);

      const replay = await onRequest(context({
        body: request,
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }));
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ error: 'turn_terminal' });
      expect(startCalls).toBe(1);

      const events = await onRequest(context({
        headers: sessionHeaders,
        method: 'GET',
        path: `hosted-agent/v2/turns/${request.turnId}/events`,
      }));
      expect(events.status).toBe(200);
      expect(await events.text()).toContain('event: turn-canceled');
      expect(cancelAttempts).toBe(2);
      expect(eventsCalls).toBe(1);
    } finally {
      upstreamFetch.mockRestore();
    }
  });

  it('forwards a strict server-owned Fast V2 envelope and binds exact replays', async () => {
    const request = fastV2TurnRequest();
    let forwardedBody: Record<string, unknown> | null = null;
    let assertionClaims: Record<string, unknown> | null = null;
    let serviceAssertion = '';
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (requestInfo, init) => {
        const url = new URL(String(requestInfo));
        expect(url.pathname).toBe('/kernel/hosted-agent/v2/turns');
        const headers = new Headers(init?.headers);
        expect(headers.get(HOSTED_AGENT_HEADERS.protocolVersion)).toBe('fast-agent-v2');
        const assertion = headers.get(HOSTED_AGENT_HEADERS.serviceAssertion) ?? '';
        serviceAssertion = assertion;
        assertionClaims = JSON.parse(
          Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        forwardedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const edge = forwardedBody.edge as Record<string, unknown>;
        const forwardedRequest = forwardedBody.browserRequest as HostedAgentFastV2StartRequest;
        return new Response(JSON.stringify({
          acceptedExecutionContractDigest: forwardedRequest.executionContractDigest,
          acceptedExecutionContractVersion: forwardedRequest.executionContractVersion,
          eventsPath: `/api/kernel/hosted-agent/v2/turns/${forwardedRequest.turnId}/events`,
          maximumIterations: edge.maximumIterations,
          maximumSpendCredits: edge.maxTurnSpendCredits,
          pageLease: {
            expiresAt: '2026-08-01T15:15:00.000Z',
            leaseToken: 'fast-v2-page-lease',
            sessionId: edge.sessionId,
          },
          protocolVersion: 'fast-agent-v2',
          replayed: false,
          route: 'fast-agent-v2',
          sessionId: edge.sessionId,
          turnId: forwardedRequest.turnId,
        }), {
          headers: { 'Content-Type': 'application/json; profile="fast-agent-v2"' },
          status: 201,
        });
      },
    );

    const response = await onRequest(context({
      body: request,
      method: 'POST',
      path: 'hosted-agent/v2/turns',
    }));
    expect(response.status).toBe(201);
    expect(response.headers.get(HOSTED_AGENT_HEADERS.protocolVersion)).toBe('fast-agent-v2');
    expect(forwardedBody).not.toBeNull();
    expect(Object.keys(forwardedBody ?? {}).sort()).toEqual(['browserRequest', 'edge']);
    expect(forwardedBody?.browserRequest).toEqual(request);
    expect(forwardedBody?.browserRequest).not.toHaveProperty('systemPrompt');
    expect(forwardedBody?.browserRequest).not.toHaveProperty('providerInput');
    expect(forwardedBody?.browserRequest).not.toHaveProperty('tools');
    expect(forwardedBody?.edge).toMatchObject({ executionProfile: 'fast' });
    expect(assertionClaims).toMatchObject({
      clientInstanceId: CLIENT_ID,
      editorBuildId: request.editorBuildId,
      executionContractDigest: request.executionContractDigest,
      executionContractVersion: request.executionContractVersion,
      executionProfile: 'fast',
      protocolVersion: 'fast-agent-v2',
      snapshotStateFingerprint: request.compactSnapshot.stateFingerprint,
      snapshotTimelineRevision: request.compactSnapshot.timelineRevision,
      turnId: request.turnId,
    });
    expect(assertionClaims).not.toHaveProperty('model');
    expect(assertionClaims).not.toHaveProperty('providerProtocol');

    const persisted = await db.prepare(
      `SELECT h.protocol_version, h.model, h.provider_protocol,
              v.browser_request_digest, v.execution_profile, v.snapshot_timeline_revision,
              v.snapshot_state_fingerprint
       FROM hosted_agent_k0_turns h
       JOIN hosted_agent_fast_v2_bindings v ON v.turn_id = h.turn_id
       WHERE h.turn_id = ?`,
    ).bind(request.turnId).first<Record<string, unknown>>();
    expect(persisted).toMatchObject({
      model: 'masterselects-fast-v2-fast',
      protocol_version: 'fast-agent-v2',
      provider_protocol: 'openai-responses',
      execution_profile: 'fast',
      snapshot_state_fingerprint: request.compactSnapshot.stateFingerprint,
      snapshot_timeline_revision: request.compactSnapshot.timelineRevision,
    });
    expect(JSON.stringify(persisted)).not.toContain(PROMPT_SENTINEL);

    upstreamFetch.mockClear();
    const fastOperationSettlement = await onRequest(context({
      body: { receipt: {} },
      headers: {
        [HOSTED_AGENT_HEADERS.clientInstanceId]: request.clientInstanceId,
        [HOSTED_AGENT_HEADERS.pageLease]: 'fast-v2-page-lease',
        [HOSTED_AGENT_HEADERS.sessionId]: String(
          (forwardedBody?.edge as Record<string, unknown> | undefined)?.sessionId ?? '',
        ),
      },
      method: 'POST',
      path: `hosted-agent/v2/turns/${request.turnId}/operation-settlements`,
    }));
    expect(fastOperationSettlement.status).toBe(409);
    expect(await fastOperationSettlement.json()).toMatchObject({
      error: 'invalid_operation_settlement',
    });
    expect(upstreamFetch).not.toHaveBeenCalled();

    const serviceHeaders = {
      Authorization: `Bearer ${KERNEL_TOKEN}`,
      [HOSTED_AGENT_HEADERS.serviceAssertion]: serviceAssertion,
    };
    const idempotencyKey = hostedAgentFastV2RoundIdempotencyKey(request.turnId, 0);
    const authorization = await onRequest(context({
      body: {
        budgetPolicyVersion: assertionClaims?.budgetPolicyVersion,
        idempotencyKey,
        modelPolicyVersion: assertionClaims?.modelPolicyVersion,
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        snapshotStateFingerprint: request.compactSnapshot.stateFingerprint,
        snapshotTimelineRevision: request.compactSnapshot.timelineRevision,
      },
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${request.turnId}/rounds/0/authorize`,
      user: false,
    }));
    expect(authorization.status).toBe(200);
    expect(await authorization.json()).toMatchObject({
      idempotencyKey,
      roundIndex: 0,
      status: 'authorized',
    });

    const settlement = await onRequest(context({
      body: {
        idempotencyKey,
        inputTokens: 120,
        outputTokens: 30,
        providerCredits: 4,
        providerResultDigest:
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        toolCallCount: 1,
      },
      headers: serviceHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${request.turnId}/rounds/0/settle`,
      user: false,
    }));
    expect(settlement.status).toBe(200);
    expect(await settlement.json()).toMatchObject({
      creditsCharged: 24,
      idempotencyKey,
      roundIndex: 0,
    });

    upstreamFetch.mockClear();
    const conflict = await onRequest(context({
      body: { ...request, request: 'A conflicting replay.' },
      method: 'POST',
      path: 'hosted-agent/v2/turns',
    }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'billing_conflict' });
    expect(upstreamFetch).not.toHaveBeenCalled();

    const qualityRequest = {
      ...fastV2TurnRequest('turn.fast-v2-slow-billing'),
      requestedModelClass: 'slow' as const,
    };
    const qualityStart = await onRequest(context({
      body: qualityRequest,
      method: 'POST',
      path: 'hosted-agent/v2/turns',
    }));
    expect(qualityStart.status).toBe(201);
    expect(await db.prepare(
      'SELECT model FROM hosted_agent_k0_turns WHERE turn_id = ?',
    ).bind(qualityRequest.turnId).first<Record<string, unknown>>()).toMatchObject({
      model: 'masterselects-fast-v2-slow',
    });

    const qualityHeaders = {
      Authorization: `Bearer ${KERNEL_TOKEN}`,
      [HOSTED_AGENT_HEADERS.serviceAssertion]: serviceAssertion,
    };
    const qualityIdempotencyKey = hostedAgentFastV2RoundIdempotencyKey(
      qualityRequest.turnId,
      0,
    );
    const missingReplay = await onRequest(context({
      body: {
        budgetPolicyVersion: assertionClaims?.budgetPolicyVersion,
        idempotencyKey: hostedAgentFastV2RoundIdempotencyKey(qualityRequest.turnId, 1),
        modelPolicyVersion: assertionClaims?.modelPolicyVersion,
        protocolVersion: 'fast-agent-v2',
        roundIndex: 1,
        snapshotStateFingerprint: qualityRequest.compactSnapshot.stateFingerprint,
        snapshotTimelineRevision: qualityRequest.compactSnapshot.timelineRevision,
      },
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/rounds/1/authorize-replay`,
      user: false,
    }));
    expect(missingReplay.status).toBe(409);
    expect(await missingReplay.json()).toMatchObject({ error: 'round_conflict' });
    expect((await onRequest(context({
      body: {
        budgetPolicyVersion: assertionClaims?.budgetPolicyVersion,
        idempotencyKey: qualityIdempotencyKey,
        modelPolicyVersion: assertionClaims?.modelPolicyVersion,
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        snapshotStateFingerprint: qualityRequest.compactSnapshot.stateFingerprint,
        snapshotTimelineRevision: qualityRequest.compactSnapshot.timelineRevision,
      },
      headers: qualityHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/rounds/0/authorize`,
      user: false,
    }))).status).toBe(200);
    const replayedAuthorization = await onRequest(context({
      body: {
        budgetPolicyVersion: assertionClaims?.budgetPolicyVersion,
        idempotencyKey: qualityIdempotencyKey,
        modelPolicyVersion: assertionClaims?.modelPolicyVersion,
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        snapshotStateFingerprint: qualityRequest.compactSnapshot.stateFingerprint,
        snapshotTimelineRevision: qualityRequest.compactSnapshot.timelineRevision,
      },
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/rounds/0/authorize-replay`,
      user: false,
    }));
    expect(replayedAuthorization.status).toBe(200);
    expect(await replayedAuthorization.json()).toMatchObject({ replayed: true, roundIndex: 0 });
    const qualitySettlement = await onRequest(context({
      body: {
        idempotencyKey: qualityIdempotencyKey,
        inputTokens: 10,
        outputTokens: 5,
        providerResultDigest:
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        toolCallCount: 0,
      },
      headers: qualityHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/rounds/0/settle`,
      user: false,
    }));
    expect(qualitySettlement.status).toBe(200);
    expect(await qualitySettlement.json()).toMatchObject({ creditsCharged: 8 });
    const replayedSettlement = await onRequest(context({
      body: {
        idempotencyKey: qualityIdempotencyKey,
        inputTokens: 10,
        outputTokens: 5,
        providerResultDigest:
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        protocolVersion: 'fast-agent-v2',
        roundIndex: 0,
        toolCallCount: 0,
      },
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/rounds/0/settle-replay`,
      user: false,
    }));
    expect(replayedSettlement.status).toBe(200);
    expect(await replayedSettlement.json()).toMatchObject({ replayed: true, roundIndex: 0 });

    const failed = await onRequest(context({
      headers: qualityHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/fail`,
      user: false,
    }));
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ turnStatus: 'provider_failed' });

    await db.prepare(
      `UPDATE hosted_agent_k0_turns
       SET status = 'active', completed_at = NULL
       WHERE turn_id = ? AND user_id = ?`,
    ).bind(qualityRequest.turnId, USER_ID).run();
    const healedHostedMarker = await onRequest(context({
      headers: qualityHeaders,
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/fail`,
      user: false,
    }));
    expect(healedHostedMarker.status).toBe(200);

    const qualityHosted = await getHostedAgentK0Turn(db, USER_ID, qualityRequest.turnId);
    await db.prepare(
      `UPDATE ai_chat_turns
       SET status = 'active', terminal_reason = NULL, completed_at = NULL
       WHERE id = ? AND user_id = ?`,
    ).bind(qualityHosted!.billing_turn_id, USER_ID).run();
    const healedBillingMarker = await onRequest(context({
      // Durable failure cleanup is terminal-only and remains valid after the
      // short-lived browser assertion expires or disappears with the page.
      headers: { Authorization: `Bearer ${KERNEL_TOKEN}` },
      method: 'POST',
      path: `hosted-agent/service/turns/${qualityRequest.turnId}/fail`,
      user: false,
    }));
    expect(healedBillingMarker.status).toBe(200);
    expect(await db.prepare(
      `SELECT h.status, t.status AS billing_status
       FROM hosted_agent_k0_turns h
       JOIN ai_chat_turns t ON t.id = h.billing_turn_id
       WHERE h.turn_id = ?`,
    ).bind(qualityRequest.turnId).first<Record<string, unknown>>()).toMatchObject({
      billing_status: 'provider_failed',
      status: 'provider_failed',
    });

    upstreamFetch.mockRestore();
  });

  it('rejects Fast V2 prompt, provider, tool, model, and budget authority before egress', async () => {
    const forbiddenFields = [
      'systemPrompt',
      'providerInput',
      'tools',
      'model',
      'reasoningEffort',
      'temperature',
      'maximumOutputTokens',
      'maximumIterations',
      'maxTurnSpendCredits',
      'promptVersion',
      'toolSchemaVersion',
    ];
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 201 }),
    );
    for (const [index, field] of forbiddenFields.entries()) {
      const response = await onRequest(context({
        body: {
          ...fastV2TurnRequest(`turn-fast-v2-forbidden-${index}`),
          [field]: 'client override',
        },
        method: 'POST',
        path: 'hosted-agent/v2/turns',
      }));
      expect(response.status, field).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'invalid_fast_v2_start_request',
      });
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
    upstreamFetch.mockRestore();
  });
});
