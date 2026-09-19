import { json } from './db';
import type { AppKVNamespace } from './env';

/**
 * Fixed-window request counters on Workers KV.
 *
 * KV is eventually consistent, so a counter is a best-effort budget rather
 * than an exact gate: two edge locations can each admit the last request of a
 * window. That is acceptable for abuse throttling; anything that must be
 * exact (credit spends, webhook dedupe) is enforced in D1 instead.
 */
export interface RateLimitPolicy {
  /** Requests admitted per window. */
  limit: number;
  /** Window length; KV enforces a 60 second minimum TTL. */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests counted in the current window after this call. */
  count: number;
  /** Seconds until the window resets; 0 when the request was admitted. */
  retryAfterSeconds: number;
}

interface RateLimitRecord {
  count: number;
  windowStartedAt: number;
}

export interface RateLimitOptions {
  /**
   * What to do when KV itself fails. Abuse throttles on telemetry and login
   * fail open (an outage must not lock people out); budgets that guard a
   * grant (guest minting) fail closed.
   */
  onError?: 'allow' | 'deny';
}

export function getClientIp(request: Request): string | null {
  const value = request.headers.get('CF-Connecting-IP')?.trim();
  return value ? value.toLowerCase() : null;
}

/**
 * Derives an opaque KV key for a scope + identity pair. Identities (client
 * addresses, email addresses) are hashed with a server secret so KV never
 * stores them in the clear.
 */
export async function buildRateLimitKey(
  scope: string,
  identity: string,
  secret?: string | null,
): Promise<string> {
  const pepper = secret?.trim() || 'masterselects-rate-limit';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${pepper}:${scope}:${identity}`),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
  return `rate-limit:${scope}:${hash}`;
}

function parseRecord(raw: string | null): RateLimitRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) {
      return { count: Math.max(0, Math.floor(parsed)), windowStartedAt: Date.now() };
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Partial<RateLimitRecord>;
      if (typeof record.count === 'number' && typeof record.windowStartedAt === 'number') {
        return { count: record.count, windowStartedAt: record.windowStartedAt };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Counts one request against `key` and reports whether it fits the policy.
 * Rejected requests are not written, so a flood cannot extend its own window.
 */
export async function consumeRateLimit(
  kv: AppKVNamespace,
  key: string,
  policy: RateLimitPolicy,
  options: RateLimitOptions = {},
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowMs = policy.windowSeconds * 1000;
  try {
    const record = parseRecord(await kv.get(key));
    const inWindow = record !== null && now - record.windowStartedAt < windowMs;
    const windowStartedAt = inWindow ? record.windowStartedAt : now;
    const count = (inWindow ? record.count : 0) + 1;

    if (count > policy.limit) {
      return {
        allowed: false,
        count: count - 1,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + windowMs - now) / 1000)),
      };
    }

    await kv.put(key, JSON.stringify({ count, windowStartedAt } satisfies RateLimitRecord), {
      expirationTtl: Math.max(60, policy.windowSeconds),
    });
    return { allowed: true, count, retryAfterSeconds: 0 };
  } catch (error) {
    console.error('[rate-limit] KV failure', key.split(':')[1] ?? key, error instanceof Error ? error.message : error);
    const allowed = options.onError !== 'deny';
    return { allowed, count: 0, retryAfterSeconds: allowed ? 0 : Math.max(1, policy.windowSeconds) };
  }
}

/** Generic 429 that reveals nothing about which budget was exhausted. */
export function rateLimitedResponse(
  decision: RateLimitDecision,
  extra: Record<string, unknown> = {},
): Response {
  return json(
    { error: 'rate_limited', message: 'Too many requests. Please try again later.', ...extra },
    {
      headers: { 'Retry-After': String(Math.max(1, decision.retryAfterSeconds)) },
      status: 429,
    },
  );
}
