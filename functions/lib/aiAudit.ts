import type { AiModerationResult } from './aiModeration';
import type { AppContext } from './env';

export type AiAuditStatus = 'accepted' | 'blocked' | 'completed' | 'failed';

export interface AiAuditInput {
  creditCost?: number;
  errorMessage?: string | null;
  feature: string;
  idempotencyKey?: string | null;
  model?: string | null;
  moderation: AiModerationResult;
  prompt: unknown;
  provider: string;
  providerTaskId?: string | null;
  requestId?: string | null;
  status: AiAuditStatus;
  userId: string;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 24_000);
  } catch {
    return '"[unserializable]"';
  }
}

async function buildIpHash(context: AppContext): Promise<string | null> {
  const ip = context.request.headers.get('cf-connecting-ip')?.trim()
    ?? context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? '';
  const secret = context.env.VISITOR_NOTIFY_SECRET?.trim() || context.env.SESSION_SECRET?.trim();
  if (!ip || !secret) return null;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function insertAiAuditEvent(context: AppContext, input: AiAuditInput): Promise<string> {
  const id = crypto.randomUUID();
  const ipHash = await buildIpHash(context);

  await context.env.DB.prepare(
    `
      INSERT INTO ai_audit_events (
        id, user_id, request_id, idempotency_key, feature, provider, model, status,
        prompt_json, moderation_status, moderation_flagged, moderation_categories_json,
        provider_task_id, credit_cost, error_message, ip_hash, user_agent, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      id,
      input.userId,
      input.requestId ?? null,
      input.idempotencyKey ?? null,
      input.feature,
      input.provider,
      input.model ?? null,
      input.status,
      safeJson(input.prompt),
      input.moderation.status,
      input.moderation.flagged ? 1 : 0,
      safeJson(input.moderation.categories),
      input.providerTaskId ?? null,
      input.creditCost ?? 0,
      input.errorMessage ?? input.moderation.errorMessage ?? null,
      ipHash,
      (context.request.headers.get('user-agent') ?? '').slice(0, 300),
      new Date().toISOString(),
    )
    .run();

  return id;
}
