import {
  appendSetCookie,
  buildCookieOptions,
  isLocalDevelopmentRequest,
  readCookie,
  signStructuredValue,
  verifyStructuredValue,
} from './auth';
import { ensureWelcomeCredits } from './credits';
import type { AppUser, Env } from './env';
import { buildRateLimitKey, consumeRateLimit, getClientIp, type RateLimitPolicy } from './rateLimit';

export const GUEST_ACCESS_COOKIE_NAME = '__ms_guest_access';
export const GUEST_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;
export const GUEST_WELCOME_CREDIT_NETWORK_LIMIT = 3;
/** New guest identities one client address may mint per window. */
export const GUEST_MINT_RATE_LIMIT: RateLimitPolicy = { limit: 10, windowSeconds: 60 * 60 };

interface GuestAbuseIdentity {
  clientFingerprintHash: string;
  networkHash: string;
}

interface GuestAccessCookie {
  userId: string;
}

interface GuestUserRow {
  email: string;
  id: string;
}

interface GuestWelcomeCreditClaimRow {
  user_id: string;
}

export interface GuestAccessResult {
  setCookie: string | null;
  user: AppUser;
}

function isGuestUserId(value: unknown): value is string {
  return typeof value === 'string'
    && /^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function hashGuestIdentity(env: Env, value: string): Promise<string> {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Both hashes derive from the client address alone. Request headers such as
 * the User-Agent are attacker controlled and would let one address claim the
 * welcome grant once per header value; the address is the only signal the
 * edge vouches for.
 */
async function buildGuestAbuseIdentity(env: Env, clientIp: string): Promise<GuestAbuseIdentity> {
  const [clientFingerprintHash, networkHash] = await Promise.all([
    hashGuestIdentity(env, `guest-client-v2\n${clientIp}`),
    hashGuestIdentity(env, `guest-network-v1\n${clientIp}`),
  ]);
  return { clientFingerprintHash, networkHash };
}

async function loadGuestUser(env: Env, userId: string): Promise<AppUser | null> {
  const row = await env.DB
    .prepare(
      `SELECT users.id, users.email
       FROM guest_accounts
       JOIN users ON users.id = guest_accounts.user_id
       WHERE guest_accounts.user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<GuestUserRow>();

  return row ? { email: row.email, id: row.id } : null;
}

async function createGuestUser(env: Env): Promise<AppUser> {
  const uuid = crypto.randomUUID();
  const userId = `guest:${uuid}`;
  const email = `${uuid}@guest.masterselects.invalid`;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES (?, ?, 'Guest', NULL, ?, ?)`,
      )
      .bind(userId, email, now, now),
    env.DB
      .prepare(
        `INSERT INTO guest_accounts (user_id, created_at, last_seen_at)
         VALUES (?, ?, ?)`,
      )
      .bind(userId, now, now),
  ]);

  return { email, id: userId };
}

async function claimGuestWelcomeCredits(
  env: Env,
  identity: GuestAbuseIdentity,
  userId: string,
): Promise<boolean> {
  const existing = await env.DB
    .prepare(
      `SELECT user_id
       FROM guest_welcome_credit_claims
       WHERE client_fingerprint_hash = ?
       LIMIT 1`,
    )
    .bind(identity.clientFingerprintHash)
    .first<GuestWelcomeCreditClaimRow>();
  if (existing) return existing.user_id === userId;

  const networkClaimCount = await env.DB
    .prepare(
      `SELECT COUNT(*) AS claim_count
       FROM guest_welcome_credit_claims
       WHERE network_hash = ?`,
    )
    .bind(identity.networkHash)
    .first<{ claim_count: number }>('claim_count');
  if (Number(networkClaimCount ?? 0) >= GUEST_WELCOME_CREDIT_NETWORK_LIMIT) return false;

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO guest_welcome_credit_claims (
         client_fingerprint_hash,
         network_hash,
         user_id,
         claimed_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .bind(identity.clientFingerprintHash, identity.networkHash, userId, new Date().toISOString())
    .run();

  const owner = await env.DB
    .prepare(
      `SELECT user_id
       FROM guest_welcome_credit_claims
       WHERE client_fingerprint_hash = ?
       LIMIT 1`,
    )
    .bind(identity.clientFingerprintHash)
    .first<GuestWelcomeCreditClaimRow>();
  return owner?.user_id === userId;
}

async function buildGuestCookie(env: Env, request: Request, userId: string): Promise<string> {
  const signed = await signStructuredValue(env, { userId } satisfies GuestAccessCookie);
  const headers = new Headers();
  appendSetCookie(headers, GUEST_ACCESS_COOKIE_NAME, signed, buildCookieOptions(request, {
    maxAge: GUEST_ACCESS_TTL_SECONDS,
  }));
  return headers.get('Set-Cookie') ?? '';
}

async function touchGuestAccount(env: Env, userId: string): Promise<void> {
  await env.DB
    .prepare('UPDATE guest_accounts SET last_seen_at = ? WHERE user_id = ?')
    .bind(new Date().toISOString(), userId)
    .run();
}

/**
 * Resolves the guest identity for an anonymous request.
 *
 * Returns the existing guest when the signed cookie is valid. Otherwise mints
 * a new identity, which is the abuse surface (it creates rows and may grant
 * welcome credits): minting requires an attributable client address outside
 * loopback development, stays within a per-address budget, and the welcome
 * grant is claimed at most once per address. Returns `null` when no identity
 * may be minted; the request then proceeds as plain anonymous traffic.
 */
export async function ensureGuestAccess(env: Env, request: Request): Promise<GuestAccessResult | null> {
  const cookie = await verifyStructuredValue<GuestAccessCookie>(
    env,
    readCookie(request, GUEST_ACCESS_COOKIE_NAME),
  );
  const existingUser = isGuestUserId(cookie?.userId)
    ? await loadGuestUser(env, cookie.userId)
    : null;
  if (existingUser) {
    await touchGuestAccount(env, existingUser.id);
    return { setCookie: null, user: existingUser };
  }

  const clientIp = getClientIp(request);
  const localDevelopment = isLocalDevelopmentRequest(request, env);
  if (!clientIp && !localDevelopment) {
    return null;
  }

  const mintBudget = await consumeRateLimit(
    env.KV,
    await buildRateLimitKey('guest-mint', clientIp ?? 'local-development', env.SESSION_SECRET),
    GUEST_MINT_RATE_LIMIT,
    { onError: 'deny' },
  );
  if (!mintBudget.allowed) {
    return null;
  }

  const user = await createGuestUser(env);
  const mayReceiveWelcomeCredits = clientIp
    ? await claimGuestWelcomeCredits(env, await buildGuestAbuseIdentity(env, clientIp), user.id)
    : localDevelopment;
  if (mayReceiveWelcomeCredits) await ensureWelcomeCredits(env.DB, user.id);
  await touchGuestAccount(env, user.id);

  return {
    setCookie: await buildGuestCookie(env, request, user.id),
    user,
  };
}
