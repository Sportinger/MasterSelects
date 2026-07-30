import {
  buildCookieOptions,
  clearCookie,
  readCookie,
  serializeCookie,
} from './auth';
import type { AppContext, Env } from './env';

export const ADMIN_SESSION_COOKIE = '__ms_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60;
const ADMIN_LOGIN_LOCK_SECONDS = 30 * 60;
const ADMIN_LOGIN_MAX_FAILURES = 5;
const PASSWORD_HASH_PREFIX = 'pbkdf2-sha256';
const encoder = new TextEncoder();

export interface AdminSession {
  csrfToken: string;
  expiresAt: string;
  issuedAt: string;
  sessionId: string;
  version: 1;
}

interface AdminLoginRateRecord {
  failures: number;
  lockedUntil?: number;
  windowStartedAt: number;
}

function encodeBase64Url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomToken(bytes = 24): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function adminSessionSecret(env: Env): string {
  const secret = env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('ADMIN_SESSION_SECRET is not configured securely.');
  return secret;
}

function adminPasswordHash(env: Env): string {
  const encoded = env.ADMIN_PASSWORD_HASH_B64?.trim();
  if (encoded) {
    try {
      return new TextDecoder().decode(decodeBase64Url(encoded));
    } catch {
      return '';
    }
  }
  return env.ADMIN_PASSWORD_HASH?.trim() ?? '';
}

async function importAdminHmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(adminSessionSecret(env)),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  );
}

async function signAdminPayload(env: Env, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await importAdminHmacKey(env), encoder.encode(payload));
  return encodeBase64Url(signature);
}

async function verifyAdminPayloadSignature(env: Env, payload: string, signature: string): Promise<boolean> {
  try {
    return crypto.subtle.verify(
      'HMAC',
      await importAdminHmacKey(env),
      decodeBase64Url(signature),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}

export function isAdminConfigured(env: Env): boolean {
  return Boolean(
    adminPasswordHash(env).startsWith(`${PASSWORD_HASH_PREFIX}$`)
    && (env.ADMIN_SESSION_SECRET?.trim().length ?? 0) >= 32,
  );
}

export async function verifyAdminPassword(env: Env, password: unknown): Promise<boolean> {
  const candidate = typeof password === 'string' ? password : '';
  if (!candidate || candidate.length > 512) return false;

  const [algorithm, iterationsText, saltText, expectedText] = adminPasswordHash(env).split('$');
  const iterations = Number(iterationsText);
  if (
    algorithm !== PASSWORD_HASH_PREFIX
    || !Number.isInteger(iterations)
    || iterations < 1
    || !saltText
    || !expectedText
  ) {
    return false;
  }

  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(candidate),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const expected = decodeBase64Url(expectedText);
    const derived = await crypto.subtle.deriveBits(
      {
        hash: 'SHA-256',
        iterations,
        name: 'PBKDF2',
        salt: decodeBase64Url(saltText),
      },
      keyMaterial,
      expected.byteLength * 8,
    );

    let difference = 0;
    const actual = new Uint8Array(derived);
    for (let index = 0; index < expected.length; index += 1) {
      difference |= actual[index]! ^ expected[index]!;
    }
    return difference === 0;
  } catch {
    return false;
  }
}

export async function createAdminSession(env: Env, now = new Date()): Promise<{
  cookieValue: string;
  session: AdminSession;
}> {
  const session: AdminSession = {
    csrfToken: randomToken(),
    expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString(),
    issuedAt: now.toISOString(),
    sessionId: crypto.randomUUID(),
    version: 1,
  };
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(session)));
  const signature = await signAdminPayload(env, payload);
  return { cookieValue: `v1.${payload}.${signature}`, session };
}

export async function loadAdminSession(request: Request, env: Env, now = new Date()): Promise<AdminSession | null> {
  const cookie = readCookie(request, ADMIN_SESSION_COOKIE);
  const [version, payload, signature] = cookie?.split('.') ?? [];
  if (version !== 'v1' || !payload || !signature) return null;
  if (!await verifyAdminPayloadSignature(env, payload, signature)) return null;

  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(payload));
    const session = JSON.parse(decoded) as AdminSession;
    if (
      session.version !== 1
      || !session.sessionId
      || !session.csrfToken
      || Date.parse(session.expiresAt) <= now.getTime()
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function buildAdminSessionCookie(request: Request, value: string): string {
  return serializeCookie(
    ADMIN_SESSION_COOKIE,
    value,
    buildCookieOptions(request, {
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      sameSite: 'Strict',
    }),
  );
}

export function clearAdminSessionCookie(headers: Headers, request: Request): void {
  clearCookie(headers, ADMIN_SESSION_COOKIE, request, { sameSite: 'Strict' });
}

export function hasAdminTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function requireAdminSession(context: AppContext): Promise<AdminSession | null> {
  if (!isAdminConfigured(context.env)) return null;
  return loadAdminSession(context.request, context.env);
}

export function hasValidAdminCsrf(request: Request, session: AdminSession): boolean {
  const supplied = request.headers.get('x-masterselects-admin-csrf') ?? '';
  if (supplied.length !== session.csrfToken.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ session.csrfToken.charCodeAt(index);
  }
  return difference === 0;
}

async function adminLoginRateKey(request: Request, env: Env): Promise<string> {
  const clientAddress = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? 'unknown';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`masterselects:admin-login:v1:${adminSessionSecret(env)}:${clientAddress.trim()}`),
  );
  return `admin:login:${encodeBase64Url(digest).slice(0, 32)}`;
}

export async function getAdminLoginRetryAfter(request: Request, env: Env, now = Date.now()): Promise<number> {
  const record = await env.KV.get<AdminLoginRateRecord>(await adminLoginRateKey(request, env), { type: 'json' });
  if (!record?.lockedUntil || record.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
}

export async function recordAdminLoginFailure(request: Request, env: Env, now = Date.now()): Promise<number> {
  const key = await adminLoginRateKey(request, env);
  const current = await env.KV.get<AdminLoginRateRecord>(key, { type: 'json' });
  const withinWindow = Boolean(current && now - current.windowStartedAt < ADMIN_LOGIN_WINDOW_SECONDS * 1000);
  const failures = (withinWindow ? current?.failures ?? 0 : 0) + 1;
  const record: AdminLoginRateRecord = {
    failures,
    windowStartedAt: withinWindow ? current!.windowStartedAt : now,
    ...(failures >= ADMIN_LOGIN_MAX_FAILURES ? { lockedUntil: now + ADMIN_LOGIN_LOCK_SECONDS * 1000 } : {}),
  };
  await env.KV.put(key, JSON.stringify(record), { expirationTtl: ADMIN_LOGIN_LOCK_SECONDS });
  return record.lockedUntil ? ADMIN_LOGIN_LOCK_SECONDS : 0;
}

export async function clearAdminLoginFailures(request: Request, env: Env): Promise<void> {
  await env.KV.delete(await adminLoginRateKey(request, env));
}
