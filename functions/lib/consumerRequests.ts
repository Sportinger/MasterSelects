import { hasSameOriginHeader, json, methodNotAllowed, parseJson } from './db';
import {
  sendConsumerRequestReceiptEmails,
  type ConsumerRequestKind,
} from './consumerContractEmail';
import { normalizeLegalLocale } from './consumerContractRecords';
import type { AppContext } from './env';

const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_REQUESTS = 3;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MANAGED_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'paused'];

interface ConsumerRequestBody {
  confirmation?: unknown;
  contractReference?: unknown;
  effectiveAt?: unknown;
  email?: unknown;
  locale?: unknown;
  name?: unknown;
  /** Honeypot: real users never fill it. */
  website?: unknown;
}

interface MatchedSubscriptionRow {
  plan_id: string;
  stripe_subscription_id: string | null;
  user_id: string;
}

interface ExistingRequestRow {
  id: string;
  received_at: string;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function getRateLimitKey(context: AppContext, kind: ConsumerRequestKind): Promise<string | null> {
  const ip = context.request.headers.get('cf-connecting-ip')?.trim();
  if (!ip) return null;
  const secret = context.env.VISITOR_NOTIFY_SECRET?.trim()
    || context.env.SESSION_SECRET?.trim()
    || 'masterselects-consumer-request';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${kind}:${ip}`));
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
  return `consumer-request-rate:${hash}`;
}

async function findManagedSubscription(
  db: AppContext['env']['DB'],
  email: string,
): Promise<MatchedSubscriptionRow | null> {
  try {
    return await db
      .prepare(
        `SELECT s.user_id, s.plan_id, s.stripe_subscription_id
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         WHERE lower(u.email) = ? AND s.status IN (${MANAGED_STATUSES.map(() => '?').join(', ')})
         ORDER BY s.updated_at DESC
         LIMIT 1`,
      )
      .bind(email, ...MANAGED_STATUSES)
      .first<MatchedSubscriptionRow>();
  } catch {
    return null;
  }
}

/**
 * Shared implementation of the public withdrawal (§355 BGB) and cancellation
 * button (§312k BGB) endpoints. Both must work without a login, so the route is
 * protected by same-origin, a honeypot, a per-IP rate limit, and 24-hour
 * de-duplication instead of authentication. Every accepted request is stored
 * before any email is sent, so a mail outage never loses a statutory notice.
 */
export async function handleConsumerRequest(
  context: AppContext,
  kind: ConsumerRequestKind,
): Promise<Response> {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }
  if (!hasSameOriginHeader(context.request)) {
    return json({ error: 'forbidden_origin', message: 'The request must be sent from the MasterSelects website.' }, { status: 403 });
  }

  const body = (await parseJson<ConsumerRequestBody>(context.request)) ?? {};
  const name = cleanText(body.name, 160);
  const email = cleanText(body.email, 254).toLowerCase();
  const providedReference = cleanText(body.contractReference, 240);
  const requestedEffectiveAt = kind === 'cancellation' && body.effectiveAt === 'immediately' ? 'immediately' : 'period_end';
  const locale = normalizeLegalLocale(body.locale);

  if (cleanText(body.website, 10) || body.confirmation !== true || !name || !isEmail(email)) {
    return json(
      {
        error: kind === 'cancellation' ? 'invalid_cancellation_request' : 'invalid_withdrawal_request',
        message: 'Name, a valid email address, and the explicit confirmation are required.',
      },
      { status: 400 },
    );
  }

  if (!context.env.RESEND_API_KEY?.trim() || !context.env.AUTH_EMAIL_FROM?.trim()) {
    return json(
      {
        error: 'consumer_request_delivery_not_configured',
        message: 'The online form is temporarily unavailable. Please send your notice by email to admin@masterselects.com.',
      },
      { status: 503 },
    );
  }

  const rateLimitKey = await getRateLimitKey(context, kind);
  if (rateLimitKey) {
    const seen = Number((await context.env.KV.get(rateLimitKey)) ?? 0);
    if (seen >= RATE_LIMIT_MAX_REQUESTS) {
      return json(
        { error: 'rate_limited', message: 'Too many requests from this connection. Please try again later or send an email.' },
        { status: 429 },
      );
    }
    await context.env.KV.put(rateLimitKey, String(seen + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  }

  const duplicateSince = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const existing = await context.env.DB
    .prepare(
      `SELECT id, received_at FROM withdrawal_requests
       WHERE kind = ? AND email = ? AND received_at >= ?
       ORDER BY received_at DESC LIMIT 1`,
    )
    .bind(kind, email, duplicateSince)
    .first<ExistingRequestRow>();
  if (existing) {
    return json({ duplicate: true, kind, ok: true, receiptId: existing.id, receivedAt: existing.received_at });
  }

  const matched = await findManagedSubscription(context.env.DB, email);
  const userId = context.data.user?.id ?? matched?.user_id ?? null;
  const contractReference = providedReference || matched?.stripe_subscription_id || 'not provided';
  const receiptId = `${kind === 'cancellation' ? 'cx' : 'wd'}-${crypto.randomUUID()}`;
  const receivedAt = new Date().toISOString();

  await context.env.DB
    .prepare(
      `INSERT INTO withdrawal_requests (
         id, kind, name, email, contract_reference, received_at, status,
         user_id, matched_subscription_id, requested_effective_at, locale
       ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`,
    )
    .bind(
      receiptId,
      kind,
      name,
      email,
      contractReference,
      receivedAt,
      userId,
      matched?.stripe_subscription_id ?? null,
      requestedEffectiveAt,
      locale,
    )
    .run();

  try {
    await sendConsumerRequestReceiptEmails(context.env, {
      contractReference,
      email,
      kind,
      matchedPlanId: matched?.plan_id ?? null,
      matchedSubscriptionId: matched?.stripe_subscription_id ?? null,
      name,
      receiptId,
      receivedAt,
      requestedEffectiveAt,
    });
    await context.env.DB
      .prepare('UPDATE withdrawal_requests SET confirmation_email_sent_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), receiptId)
      .run();
  } catch (error) {
    console.error(`[legal] ${kind} receipt email failed for ${receiptId}`, error instanceof Error ? error.message : error);
    return json(
      {
        error: 'consumer_request_receipt_failed',
        kind,
        message: 'Your notice was recorded, but the email receipt could not be delivered yet. Keep this receipt number.',
        receiptId,
        receivedAt,
      },
      { status: 503 },
    );
  }

  return json({ kind, ok: true, receiptId, receivedAt });
}
