import { stringifyAiPayloadForStorage } from './aiAudit';
import type { AppD1Database } from './env';

export interface ChatLogRow {
  id: string;
  user_id: string;
  request_id: string | null;
  idempotency_key: string | null;
  model: string;
  messages_json: string;
  response_json: string;
  tool_calls_json: string | null;
  finish_reason: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_total: number | null;
  credit_cost: number;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface ChatLogInput {
  userId: string;
  requestId: string | null;
  idempotencyKey: string | null;
  model: string;
  messages: unknown[];
  response: unknown;
  creditCost: number;
  durationMs: number | null;
  status: 'completed' | 'failed';
  errorMessage?: string | null;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function extractOpenAIFields(response: unknown): {
  toolCalls: unknown[] | null;
  finishReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensTotal: number | null;
} {
  if (!isRecord(response)) {
    return { toolCalls: null, finishReason: null, tokensIn: null, tokensOut: null, tokensTotal: null };
  }

  const r = response as OpenAIResponse;
  const choice = r.choices?.[0];
  const usage = r.usage;

  const toolCalls = choice?.message?.tool_calls ?? null;
  const finishReason = choice?.finish_reason ?? null;
  const tokensIn = usage?.prompt_tokens ?? null;
  const tokensOut = usage?.completion_tokens ?? null;
  const tokensTotal = usage?.total_tokens ?? null;

  return {
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
    finishReason,
    tokensIn,
    tokensOut,
    tokensTotal,
  };
}

export async function insertChatLog(
  db: AppD1Database,
  input: ChatLogInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const { toolCalls, finishReason, tokensIn, tokensOut, tokensTotal } = extractOpenAIFields(input.response);

  await db
    .prepare(
      `
      INSERT INTO chat_logs (
        id, user_id, request_id, idempotency_key, model,
        messages_json, response_json, tool_calls_json, finish_reason,
        tokens_in, tokens_out, tokens_total,
        credit_cost, duration_ms, status, error_message, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .bind(
      id,
      input.userId,
      input.requestId,
      input.idempotencyKey,
      input.model,
      stringifyAiPayloadForStorage(input.messages),
      stringifyAiPayloadForStorage(input.response),
      toolCalls ? stringifyAiPayloadForStorage(toolCalls) : null,
      finishReason,
      tokensIn,
      tokensOut,
      tokensTotal,
      input.creditCost,
      input.durationMs,
      input.status,
      input.errorMessage ?? null,
      new Date().toISOString(),
    )
    .run();

  return id;
}

export interface ChatLogListOptions {
  userId: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ChatLogSummary {
  id: string;
  model: string;
  userMessage: string | null;
  assistantMessage: string | null;
  toolNames: string[];
  finishReason: string | null;
  tokensTotal: number | null;
  creditCost: number;
  durationMs: number | null;
  status: string;
  createdAt: string;
}

function extractLastUserMessage(messagesJson: string): string | null {
  try {
    const messages = JSON.parse(messagesJson) as Array<{ role: string; content: unknown }>;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          const textPart = content.find(
            (p: unknown) => isRecord(p) && p.type === 'text' && typeof p.text === 'string',
          );
          if (textPart && isRecord(textPart)) return textPart.text as string;
        }
        return JSON.stringify(content);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function extractAssistantMessage(responseJson: string): string | null {
  try {
    const response = JSON.parse(responseJson) as OpenAIResponse;
    return response.choices?.[0]?.message?.content ?? null;
  } catch {
    // ignore
  }
  return null;
}

function extractToolNames(toolCallsJson: string | null): string[] {
  if (!toolCallsJson) return [];
  try {
    const toolCalls = JSON.parse(toolCallsJson) as Array<{ function?: { name?: string } }>;
    return toolCalls
      .map((tc) => tc.function?.name)
      .filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

export async function getChatLogs(
  db: AppD1Database,
  options: ChatLogListOptions,
): Promise<{ logs: ChatLogSummary[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  let whereClause = 'WHERE user_id = ?';
  const params: unknown[] = [options.userId];

  if (options.search) {
    whereClause += ' AND (messages_json LIKE ? OR response_json LIKE ?)';
    const searchPattern = `%${options.search}%`;
    params.push(searchPattern, searchPattern);
  }

  const countResult = await db
    .prepare(`SELECT COUNT(*) as count FROM chat_logs ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  const rows = await db
    .prepare(
      `
      SELECT id, model, messages_json, response_json, tool_calls_json,
             finish_reason, tokens_total, credit_cost, duration_ms, status, created_at
      FROM chat_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
    .bind(...params, limit, offset)
    .all<{
      id: string;
      model: string;
      messages_json: string;
      response_json: string;
      tool_calls_json: string | null;
      finish_reason: string | null;
      tokens_total: number | null;
      credit_cost: number;
      duration_ms: number | null;
      status: string;
      created_at: string;
    }>();

  const logs: ChatLogSummary[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    model: row.model,
    userMessage: extractLastUserMessage(row.messages_json),
    assistantMessage: extractAssistantMessage(row.response_json),
    toolNames: extractToolNames(row.tool_calls_json),
    finishReason: row.finish_reason,
    tokensTotal: row.tokens_total,
    creditCost: row.credit_cost,
    durationMs: row.duration_ms,
    status: row.status,
    createdAt: row.created_at,
  }));

  return { logs, total };
}

export async function getChatLogDetail(
  db: AppD1Database,
  userId: string,
  logId: string,
): Promise<ChatLogRow | null> {
  return db
    .prepare(
      `
      SELECT id, user_id, request_id, idempotency_key, model,
             messages_json, response_json, tool_calls_json, finish_reason,
             tokens_in, tokens_out, tokens_total,
             credit_cost, duration_ms, status, error_message, created_at
      FROM chat_logs
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    )
    .bind(logId, userId)
    .first<ChatLogRow>();
}
