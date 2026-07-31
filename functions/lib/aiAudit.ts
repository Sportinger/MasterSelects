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

const REDACTED = '[redacted]';
const CONTENT_OMITTED = '[content omitted]';
const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)$/i;
const HOSTED_CHAT_CONTENT_KEY_PATTERN =
  /^(?:system|instructions?|messages?|history|prompt|transcripts?|tool[-_]?results?|arguments|content|text|input|output|results?|response)$/i;
const BINARY_KEY_PATTERN =
  /^(?:base64|bytes|data|imageData|image_data|audioBase64|audio_base64|videoBase64|video_base64|fileData|file_data)$/i;
const EXPLICIT_BINARY_KEY_PATTERN =
  /^(?:base64|bytes|imageData|image_data|audioBase64|audio_base64|videoBase64|video_base64|fileData|file_data)$/i;
const DATA_URL_PATTERN = /data:[^;,\s]+;base64,[a-z0-9+/_=\s-]+/gi;
const BEARER_PATTERN = /\bBearer\s+[a-z0-9._~+/=-]+/gi;
const API_KEY_ASSIGNMENT_PATTERN =
  /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)\s*[:=]\s*["']?[^\s"',;}]+/gi;
const PROVIDER_KEY_PATTERN = /\b(?:sk|rk|pk|key)-[a-z0-9_-]{12,}\b/gi;

export function redactAiStorageText(value: string): string {
  return value
    .replace(DATA_URL_PATTERN, (match) => (
      /^data:image\//i.test(match) ? '[image data omitted]' : '[binary data omitted]'
    ))
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(API_KEY_ASSIGNMENT_PATTERN, (_match, label: string) => `${label}=${REDACTED}`)
    .replace(PROVIDER_KEY_PATTERN, REDACTED);
}

function looksLikeBareBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  return compact.length >= 64
    && compact.length % 4 === 0
    && /^[a-z0-9+/_=-]+$/i.test(compact);
}

function redactAiPayload(
  value: unknown,
  options: { omitHostedChatContent: boolean },
  parentKey = '',
  parentRecord?: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    if (
      EXPLICIT_BINARY_KEY_PATTERN.test(parentKey)
      || (BINARY_KEY_PATTERN.test(parentKey)
        && (parentRecord?.type === 'base64' || looksLikeBareBase64(value)))
    ) {
      return '[binary data omitted]';
    }
    return redactAiStorageText(value);
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAiPayload(item, options, parentKey));
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(source)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        redacted[key] = REDACTED;
      } else if (options.omitHostedChatContent && HOSTED_CHAT_CONTENT_KEY_PATTERN.test(key)) {
        redacted[key] = CONTENT_OMITTED;
      } else {
        redacted[key] = redactAiPayload(nestedValue, options, key, source);
      }
    }
    return redacted;
  }

  return redactAiStorageText(String(value));
}

export function redactAiPayloadForStorage(value: unknown): unknown {
  return redactAiPayload(value, { omitHostedChatContent: false });
}

export function redactHostedChatPayloadForStorage(value: unknown): unknown {
  return redactAiPayload(value, { omitHostedChatContent: true });
}

export function stringifyAiPayloadForStorage(value: unknown, maxLength?: number): string {
  try {
    const serialized = JSON.stringify(redactAiPayloadForStorage(value));
    return typeof maxLength === 'number' ? serialized.slice(0, maxLength) : serialized;
  } catch {
    return '"[unserializable]"';
  }
}

export function stringifyHostedChatPayloadForStorage(value: unknown, maxLength?: number): string {
  try {
    const serialized = JSON.stringify(redactHostedChatPayloadForStorage(value));
    return typeof maxLength === 'number' ? serialized.slice(0, maxLength) : serialized;
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
      stringifyAiPayloadForStorage(input.prompt, 24_000),
      input.moderation.status,
      input.moderation.flagged ? 1 : 0,
      stringifyAiPayloadForStorage(input.moderation.categories, 24_000),
      input.providerTaskId ?? null,
      input.creditCost ?? 0,
      input.errorMessage || input.moderation.errorMessage
        ? redactAiStorageText(input.errorMessage ?? input.moderation.errorMessage ?? '')
        : null,
      ipHash,
      redactAiStorageText(context.request.headers.get('user-agent') ?? '').slice(0, 300),
      new Date().toISOString(),
    )
    .run();

  return id;
}
