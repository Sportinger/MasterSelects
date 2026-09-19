import {
  isProductAnalyticsEventName,
  sanitizeProductAnalyticsProperties,
  type ProductAnalyticsEventName,
} from '../../../src/services/productAnalytics/catalog';
import { hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitPolicy,
} from '../../lib/rateLimit';

const MAX_BATCH_SIZE = 25;
const MAX_BODY_BYTES = 48_000;
const WRITE_RATE_LIMIT: RateLimitPolicy = { limit: 120, windowSeconds: 10 * 60 };
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9:-]{7,99}$/i;
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9:-]{7,99}$/i;
const RETENTION_DAYS = 180;
const RETENTION_GUARD_KEY = 'product-analytics:retention-cleanup';

interface AnalyticsEventInput {
  appVersion?: unknown;
  eventVersion?: unknown;
  id?: unknown;
  name?: unknown;
  occurredAt?: unknown;
  properties?: unknown;
  sessionId?: unknown;
}

interface AnalyticsBatchInput {
  events?: unknown;
}

interface ValidatedAnalyticsEvent {
  appVersion: string | null;
  eventVersion: number;
  id: string;
  name: ProductAnalyticsEventName;
  occurredAt: string;
  propertiesJson: string;
  sessionId: string;
}

function validateEventName(value: unknown) {
  return isProductAnalyticsEventName(value) ? value : null;
}

function validateTimestamp(value: unknown, receivedAtMs: number): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const maximumSkewMs = 24 * 60 * 60 * 1000;
  if (Math.abs(receivedAtMs - parsed) > maximumSkewMs) return null;
  return new Date(parsed).toISOString();
}

function validateEvent(value: unknown, receivedAtMs: number): ValidatedAnalyticsEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as AnalyticsEventInput;
  const name = validateEventName(input.name);
  if (!name) return null;
  if (typeof input.id !== 'string' || !EVENT_ID_PATTERN.test(input.id)) return null;
  if (typeof input.sessionId !== 'string' || !SESSION_ID_PATTERN.test(input.sessionId)) return null;
  const occurredAt = validateTimestamp(input.occurredAt, receivedAtMs);
  if (!occurredAt) return null;

  const appVersion = typeof input.appVersion === 'string'
    ? input.appVersion.trim().slice(0, 32) || null
    : null;
  const eventVersion = typeof input.eventVersion === 'number'
    && Number.isInteger(input.eventVersion)
    && input.eventVersion >= 1
    && input.eventVersion <= 10
    ? input.eventVersion
    : 1;
  const propertiesJson = JSON.stringify(sanitizeProductAnalyticsProperties(name, input.properties));
  if (propertiesJson.length > 2_048) return null;

  return {
    appVersion,
    eventVersion,
    id: input.id,
    name,
    occurredAt,
    propertiesJson,
    sessionId: input.sessionId,
  };
}

async function scheduleRetentionCleanup(context: AppContext): Promise<void> {
  const cleanupRecentlyScheduled = await context.env.KV.get(RETENTION_GUARD_KEY);
  if (cleanupRecentlyScheduled) return;
  await context.env.KV.put(RETENTION_GUARD_KEY, '1', { expirationTtl: 60 * 60 });
  await context.env.DB.prepare(
    `DELETE FROM product_analytics_events
     WHERE received_at < datetime('now', ?)`
  )
    .bind(`-${RETENTION_DAYS} days`)
    .run();
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
      await buildRateLimitKey('analytics-events', clientIp, context.env.SESSION_SECRET),
      WRITE_RATE_LIMIT,
    );
    if (!budget.allowed) return rateLimitedResponse(budget, { ok: false });
  }

  const body = await parseJson<AnalyticsBatchInput>(context.request);
  if (!body || !Array.isArray(body.events) || body.events.length === 0) {
    return json({ error: 'invalid_events', ok: false }, { status: 400 });
  }
  if (body.events.length > MAX_BATCH_SIZE) {
    return json({ error: 'batch_too_large', ok: false }, { status: 413 });
  }

  const receivedAt = new Date();
  const events = body.events
    .map((event) => validateEvent(event, receivedAt.getTime()))
    .filter((event): event is ValidatedAnalyticsEvent => event !== null);
  if (events.length === 0) {
    return json({ accepted: 0, error: 'no_valid_events', ok: false }, { status: 400 });
  }

  const userId = context.data.user?.id ?? null;
  const statements = events.map((event) => context.env.DB.prepare(
    `INSERT OR IGNORE INTO product_analytics_events (
       id, user_id, session_id, event_name, event_version, app_version,
       properties_json, occurred_at, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.id,
    userId,
    event.sessionId,
    event.name,
    event.eventVersion,
    event.appVersion,
    event.propertiesJson,
    event.occurredAt,
    receivedAt.toISOString(),
  ));

  await context.env.DB.batch(statements);
  context.waitUntil(scheduleRetentionCleanup(context).catch(() => {}));

  return json({
    accepted: events.length,
    discarded: body.events.length - events.length,
    ok: true,
  }, { status: 202 });
};
