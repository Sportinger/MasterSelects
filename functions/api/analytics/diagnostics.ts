import {
  insertAppDiagnosticEvents,
  requestCountry,
  scheduleAppDiagnosticRetentionCleanup,
  type AppDiagnosticEventRecord,
} from '../../lib/appDiagnosticEvents';
import { getAiUser, hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitPolicy,
} from '../../lib/rateLimit';

const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 256_000;
const WRITE_RATE_LIMIT: RateLimitPolicy = { limit: 120, windowSeconds: 10 * 60 };
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9:-]{7,99}$/i;
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{5,199}$/i;
const IDENTITY_PATTERN = /^[a-z0-9][a-z0-9:_-]{7,99}$/i;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]{2,39}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8,32}$/i;

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_ERROR_NAME_LENGTH = 120;
const MAX_STACK_LENGTH = 12_000;
const MAX_PAGE_PATH_LENGTH = 300;
const MAX_USER_AGENT_LENGTH = 400;
const MAX_COMPONENT_LENGTH = 80;
const MAX_CONTEXT_LENGTH = 24_000;
const MAX_REPEAT_COUNT = 1_000_000;

const PLATFORMS = new Set(['windows', 'macos', 'linux', 'ios', 'android', 'other']);
const DEVICE_CLASSES = new Set(['desktop', 'tablet', 'mobile']);
const BROWSERS = new Set(['chrome', 'edge', 'firefox', 'safari', 'other']);
const OUTCOMES = new Set(['started', 'succeeded', 'failed', 'cancelled']);
const AI_STAGES = new Set(['provider_processing', 'provider_result', 'download', 'import']);

interface DiagnosticEventInput {
  appVersion?: unknown;
  breadcrumbs?: unknown;
  browser?: unknown;
  component?: unknown;
  context?: unknown;
  deviceClass?: unknown;
  deviceId?: unknown;
  errorName?: unknown;
  failureCode?: unknown;
  fingerprint?: unknown;
  id?: unknown;
  kind?: unknown;
  message?: unknown;
  occurredAt?: unknown;
  outcome?: unknown;
  pagePath?: unknown;
  platform?: unknown;
  repeatCount?: unknown;
  sessionId?: unknown;
  stack?: unknown;
  stage?: unknown;
  taskId?: unknown;
}

interface DiagnosticBatchInput {
  events?: unknown;
}

interface ValidatedDiagnosticEvent {
  appVersion: string | null;
  browser: string;
  component: string | null;
  contextJson: string | null;
  deviceClass: string;
  deviceId: string | null;
  errorName: string | null;
  failureCode: string | null;
  fingerprint: string | null;
  id: string;
  kind: 'ai_generation' | 'client_runtime';
  message: string | null;
  occurredAt: string;
  outcome: string;
  pagePath: string | null;
  platform: string;
  repeatCount: number;
  sessionId: string | null;
  stack: string | null;
  stage: string;
  taskId: string | null;
}

interface OwnedTaskRow {
  model: string | null;
  output_type: string | null;
  provider: string | null;
}

function safeEnum(value: unknown, allowed: Set<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}… [truncated]` : trimmed;
}

function safeToken(value: unknown): string | null {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

function safeIdentity(value: unknown): string | null {
  return typeof value === 'string' && IDENTITY_PATTERN.test(value) ? value : null;
}

function safeComponent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^a-z0-9_.:-]/gi, '_').slice(0, MAX_COMPONENT_LENGTH);
  return cleaned || null;
}

function safeTimestamp(value: unknown, receivedAtMs: number): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || Math.abs(receivedAtMs - parsed) > 24 * 60 * 60 * 1000) return null;
  return new Date(parsed).toISOString();
}

function safeRepeatCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? Math.min(value, MAX_REPEAT_COUNT)
    : 1;
}

function safePagePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  return value.slice(0, MAX_PAGE_PATH_LENGTH);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serializes the device context and breadcrumb trail, dropping the heaviest
 * parts first when the combined blob exceeds the storage budget.
 */
function buildContextJson(context: unknown, breadcrumbs: unknown): string | null {
  const safeContext = isPlainObject(context) ? context : null;
  const safeBreadcrumbs = Array.isArray(breadcrumbs) ? breadcrumbs.slice(-40) : null;
  if (!safeContext && !safeBreadcrumbs) return null;

  const attempts: Array<Record<string, unknown>> = [
    { breadcrumbs: safeBreadcrumbs, context: safeContext },
    { breadcrumbs: null, context: safeContext, truncated: 'breadcrumbs' },
    { breadcrumbs: null, context: safeContext ? { ...safeContext, extra: undefined } : null, truncated: 'breadcrumbs+extra' },
  ];
  for (const attempt of attempts) {
    try {
      const serialized = JSON.stringify(attempt);
      if (serialized.length <= MAX_CONTEXT_LENGTH) return serialized;
    } catch {
      return null;
    }
  }
  return JSON.stringify({ breadcrumbs: null, context: null, truncated: 'all' });
}

function validateEvent(value: unknown, receivedAtMs: number): ValidatedDiagnosticEvent | null {
  if (!isPlainObject(value)) return null;
  const input = value as DiagnosticEventInput;
  if (typeof input.id !== 'string' || !EVENT_ID_PATTERN.test(input.id)) return null;
  const kind = input.kind === 'ai_generation' || input.kind === 'client_runtime' ? input.kind : null;
  if (!kind) return null;
  const stage = kind === 'ai_generation' ? safeEnum(input.stage, AI_STAGES) : safeToken(input.stage);
  const outcome = safeEnum(input.outcome, OUTCOMES);
  const platform = safeEnum(input.platform, PLATFORMS);
  const deviceClass = safeEnum(input.deviceClass, DEVICE_CLASSES);
  const browser = safeEnum(input.browser, BROWSERS);
  const occurredAt = safeTimestamp(input.occurredAt, receivedAtMs);
  if (!stage || !outcome || !platform || !deviceClass || !browser || !occurredAt) return null;
  const taskId = typeof input.taskId === 'string' && TASK_ID_PATTERN.test(input.taskId)
    ? input.taskId
    : null;
  if (kind === 'ai_generation' && !taskId) return null;
  let failureCode = input.failureCode === undefined ? null : (safeToken(input.failureCode) ?? 'unknown');
  if (outcome === 'failed' && !failureCode) failureCode = 'unknown';

  return {
    appVersion: safeText(input.appVersion, 32),
    browser,
    component: safeComponent(input.component),
    contextJson: buildContextJson(input.context, input.breadcrumbs),
    deviceClass,
    deviceId: safeIdentity(input.deviceId),
    errorName: safeText(input.errorName, MAX_ERROR_NAME_LENGTH),
    failureCode,
    fingerprint: typeof input.fingerprint === 'string' && FINGERPRINT_PATTERN.test(input.fingerprint)
      ? input.fingerprint.toLowerCase()
      : null,
    id: input.id,
    kind,
    message: safeText(input.message, MAX_MESSAGE_LENGTH),
    occurredAt,
    outcome,
    pagePath: safePagePath(input.pagePath),
    platform,
    repeatCount: safeRepeatCount(input.repeatCount),
    sessionId: safeIdentity(input.sessionId),
    stack: safeText(input.stack, MAX_STACK_LENGTH),
    stage,
    taskId,
  };
}

async function getOwnedTask(
  context: AppContext,
  userId: string,
  taskId: string,
): Promise<OwnedTaskRow | null> {
  return context.env.DB.prepare(
    `SELECT provider, model,
            CASE
              WHEN feature LIKE '%image%' THEN 'image'
              WHEN feature LIKE '%audio%' THEN 'audio'
              ELSE 'video'
            END AS output_type
     FROM ai_audit_events
     WHERE user_id = ? AND provider_task_id = ?
     UNION ALL
     SELECT json_extract(metadata_json, '$.provider') AS provider,
            NULL AS model,
            json_extract(metadata_json, '$.outputType') AS output_type
     FROM credit_ledger
     WHERE user_id = ? AND json_extract(metadata_json, '$.taskId') = ?
     LIMIT 1`,
  ).bind(userId, taskId, userId, taskId).first<OwnedTaskRow>();
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!hasTrustedOrigin(context.request)) {
    return json({ error: 'untrusted_origin', ok: false }, { status: 403 });
  }
  const contentLength = Number(context.request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large', ok: false }, { status: 413 });
  }
  const clientIp = getClientIp(context.request);
  if (clientIp) {
    const budget = await consumeRateLimit(
      context.env.KV,
      await buildRateLimitKey('analytics-diagnostics', clientIp, context.env.SESSION_SECRET),
      WRITE_RATE_LIMIT,
    );
    if (!budget.allowed) return rateLimitedResponse(budget, { ok: false });
  }
  const body = await parseJson<DiagnosticBatchInput>(context.request);
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return json({ error: 'invalid_events', ok: false }, { status: 400 });
  }
  if (body.events.length > MAX_BATCH_SIZE) {
    return json({ error: 'batch_too_large', ok: false }, { status: 413 });
  }

  const receivedAt = new Date();
  const validated = body.events
    .map((event) => validateEvent(event, receivedAt.getTime()))
    .filter((event): event is ValidatedDiagnosticEvent => event !== null);
  const user = getAiUser(context);
  const userAgent = safeText(context.request.headers.get('user-agent'), MAX_USER_AGENT_LENGTH);
  const country = requestCountry(context.request);
  const accepted: Array<ValidatedDiagnosticEvent & OwnedTaskRow> = [];

  for (const event of validated) {
    if (event.kind === 'client_runtime') {
      accepted.push({ ...event, model: null, output_type: null, provider: null });
      continue;
    }
    if (!user || !event.taskId) continue;
    const ownedTask = await getOwnedTask(context, user.id, event.taskId);
    if (ownedTask) accepted.push({ ...event, ...ownedTask });
  }

  if (accepted.length === 0) {
    return json({ accepted: 0, discarded: body.events.length, ok: true }, { status: 202 });
  }
  const records = accepted.map((event): AppDiagnosticEventRecord => ({
    appVersion: event.appVersion,
    browser: event.browser,
    component: event.component,
    contextJson: event.contextJson,
    country,
    deviceClass: event.deviceClass,
    deviceId: event.deviceId,
    errorName: event.errorName,
    failureCode: event.failureCode,
    fingerprint: event.fingerprint,
    id: event.id,
    kind: event.kind,
    message: event.message,
    model: event.model,
    occurredAt: event.occurredAt,
    outcome: event.outcome,
    outputType: event.output_type,
    pagePath: event.pagePath,
    platform: event.platform,
    provider: event.provider,
    providerTaskId: event.taskId,
    receivedAt: receivedAt.toISOString(),
    repeatCount: event.repeatCount,
    sessionId: event.sessionId,
    stack: event.stack,
    stage: event.stage,
    userAgent,
    userId: user?.id ?? null,
  }));
  await insertAppDiagnosticEvents(context.env.DB, records);
  context.waitUntil(scheduleAppDiagnosticRetentionCleanup(context).catch(() => {}));

  return json({
    accepted: accepted.length,
    discarded: body.events.length - accepted.length,
    ok: true,
  }, { status: 202 });
};
