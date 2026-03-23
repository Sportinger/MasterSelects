import type { AppUser, Env } from './env';

export const AUTH_STATE_COOKIE_NAME = '__ms_auth_state';
export const SESSION_COOKIE_NAME = '__ms_session';
export const AUTH_STATE_KV_PREFIX = 'auth:state:';
export const SESSION_KV_PREFIX = 'auth:session:';
export const AUTH_STATE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type AuthProvider = 'google' | 'magic_link' | string;

export interface CookieOptions {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
}

export interface LoginState {
  createdAt: string;
  email: string;
  expiresAt: string;
  provider: AuthProvider;
  redirectTo: string;
  stateId: string;
}

export interface SessionRecord {
  createdAt: string;
  email: string;
  expiresAt: string;
  plan: string;
  provider: AuthProvider;
  providerUserId: string;
  redirectTo: string;
  sessionId: string;
  userId: string;
}

export interface AuthenticatedUser extends AppUser {
  avatarUrl?: string | null;
  displayName: string;
}

export interface UserLookupResult {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  id: string;
}

interface UserRow {
  avatar_url: string | null;
  display_name: string;
  email: string;
  id: string;
}

interface ProviderAuthUrlInput {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
}

export interface MagicLinkTokenPayload {
  email: string;
  expiresAt: string;
  provider: 'magic_link';
  stateId: string;
}

const textEncoder = new TextEncoder();

function toBase64Url(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeProvider(provider?: string | null): AuthProvider {
  const candidate = (provider ?? 'magic_link').trim().toLowerCase();

  if (candidate === 'google' || candidate === 'magic_link') {
    return candidate;
  }

  return candidate || 'magic_link';
}

function normalizeDisplayName(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  const label = localPart.replace(/[._-]+/g, ' ').trim();

  if (!label) {
    return email;
  }

  return label
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fallbackDisplayName(email: string, displayName?: string | null): string {
  const candidate = displayName?.trim();

  if (candidate) {
    return candidate;
  }

  return normalizeDisplayName(email);
}

function safeRedirectTo(request: Request, redirectTo?: string | null): string {
  if (!redirectTo) {
    return '/';
  }

  try {
    const url = new URL(redirectTo, request.url);

    if (url.origin !== new URL(request.url).origin) {
      return '/';
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function getSessionSecret(env: Env): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.trim()) {
    return env.SESSION_SECRET;
  }

  if ((env.ENVIRONMENT ?? '').toLowerCase() === 'development') {
    return 'masterselects-dev-session-secret';
  }

  throw new Error('SESSION_SECRET is not configured');
}

async function createHmacSignature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));

  return toBase64Url(signature);
}

export async function signCookieValue(env: Env, value: string): Promise<string> {
  const secret = getSessionSecret(env);
  const signature = await createHmacSignature(secret, value);

  return `v1.${value}.${signature}`;
}

export async function verifyCookieValue(env: Env, signedValue: string | null | undefined): Promise<string | null> {
  if (!signedValue) {
    return null;
  }

  const [version, value, signature] = signedValue.split('.');

  if (version !== 'v1' || !value || !signature) {
    return null;
  }

  const expectedSignature = await createHmacSignature(getSessionSecret(env), value);

  if (signature !== expectedSignature) {
    return null;
  }

  return value;
}

export async function signStructuredValue<T>(env: Env, payload: T): Promise<string> {
  const encoded = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  return signCookieValue(env, encoded);
}

export async function verifyStructuredValue<T>(env: Env, signedValue: string | null | undefined): Promise<T | null> {
  const encoded = await verifyCookieValue(env, signedValue);

  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(encoded)) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');

  for (const entry of cookies) {
    const [rawName, ...rawValue] = entry.trim().split('=');

    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? '/'}`);

  if (typeof options.domain === 'string' && options.domain.trim()) {
    parts.push(`Domain=${options.domain.trim()}`);
  }

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);

  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function appendSetCookie(headers: Headers, name: string, value: string, options: CookieOptions = {}): void {
  headers.append('Set-Cookie', serializeCookie(name, value, options));
}

export function clearCookie(headers: Headers, name: string, request: Request, options: CookieOptions = {}): void {
  appendSetCookie(headers, name, '', {
    expires: new Date(0),
    httpOnly: options.httpOnly ?? true,
    path: options.path ?? '/',
    sameSite: options.sameSite ?? 'Lax',
    secure: options.secure ?? isSecureRequest(request),
  });
}

export function buildCookieOptions(request: Request, overrides: CookieOptions = {}): CookieOptions {
  return {
    httpOnly: overrides.httpOnly ?? true,
    path: overrides.path ?? '/',
    sameSite: overrides.sameSite ?? 'Lax',
    secure: overrides.secure ?? isSecureRequest(request),
    ...overrides,
  };
}

export async function createLoginState(
  env: Env,
  request: Request,
  input: { email: string; provider: AuthProvider; redirectTo?: string | null },
): Promise<LoginState> {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + AUTH_STATE_TTL_SECONDS * 1000);
  const state: LoginState = {
    createdAt: createdAt.toISOString(),
    email: normalizeEmail(input.email),
    expiresAt: expiresAt.toISOString(),
    provider: normalizeProvider(input.provider),
    redirectTo: safeRedirectTo(request, input.redirectTo),
    stateId: crypto.randomUUID(),
  };

  await env.KV.put(`${AUTH_STATE_KV_PREFIX}${state.stateId}`, JSON.stringify(state), {
    expirationTtl: AUTH_STATE_TTL_SECONDS,
  });

  return state;
}

export async function loadLoginState(env: Env, stateId: string): Promise<LoginState | null> {
  if (!stateId) {
    return null;
  }

  const state = await env.KV.get<LoginState>(`${AUTH_STATE_KV_PREFIX}${stateId}`, { type: 'json' });

  if (!state) {
    return null;
  }

  if (Date.parse(state.expiresAt) <= Date.now()) {
    await env.KV.delete(`${AUTH_STATE_KV_PREFIX}${stateId}`);
    return null;
  }

  return state;
}

export async function deleteLoginState(env: Env, stateId: string): Promise<void> {
  if (!stateId) {
    return;
  }

  await env.KV.delete(`${AUTH_STATE_KV_PREFIX}${stateId}`);
}

export async function createSession(
  env: Env,
  input: {
    email: string;
    plan?: string;
    provider: AuthProvider;
    providerUserId: string;
    redirectTo?: string | null;
    userId: string;
  },
): Promise<SessionRecord> {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
  const session: SessionRecord = {
    createdAt: createdAt.toISOString(),
    email: normalizeEmail(input.email),
    expiresAt: expiresAt.toISOString(),
    plan: input.plan ?? 'free',
    provider: normalizeProvider(input.provider),
    providerUserId: input.providerUserId,
    redirectTo: input.redirectTo ?? '/',
    sessionId: crypto.randomUUID(),
    userId: input.userId,
  };

  await env.KV.put(`${SESSION_KV_PREFIX}${session.sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return session;
}

export async function loadSession(env: Env, sessionId: string): Promise<SessionRecord | null> {
  if (!sessionId) {
    return null;
  }

  const session = await env.KV.get<SessionRecord>(`${SESSION_KV_PREFIX}${sessionId}`, { type: 'json' });

  if (!session) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    await env.KV.delete(`${SESSION_KV_PREFIX}${sessionId}`);
    return null;
  }

  return session;
}

export async function loadSessionFromRequest(request: Request, env: Env): Promise<SessionRecord | null> {
  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  const sessionId = await verifyCookieValue(env, cookieValue);

  if (!sessionId) {
    return null;
  }

  return loadSession(env, sessionId);
}

export async function loadUserFromSession(request: Request, env: Env): Promise<AppUser | null> {
  const session = await loadSessionFromRequest(request, env);

  if (!session) {
    return null;
  }

  return {
    email: session.email,
    id: session.userId,
  };
}

export async function loadCurrentAuthState(
  request: Request,
  env: Env,
): Promise<{ loginState: LoginState | null; session: SessionRecord | null; user: AppUser | null }> {
  const [loginState, session, user] = await Promise.all([
    loadLoginStateFromRequest(request, env),
    loadSessionFromRequest(request, env),
    loadUserFromSession(request, env),
  ]);

  return { loginState, session, user };
}

export async function loadLoginStateFromRequest(request: Request, env: Env): Promise<LoginState | null> {
  const signedState = readCookie(request, AUTH_STATE_COOKIE_NAME);
  const stateId = await verifyCookieValue(env, signedState);

  if (!stateId) {
    return null;
  }

  return loadLoginState(env, stateId);
}

export async function ensureUserRecord(
  env: Env,
  input: {
    appVersion?: string | null;
    avatarUrl?: string | null;
    displayName?: string | null;
    email: string;
    provider: AuthProvider;
    providerUserId: string;
  },
): Promise<UserLookupResult> {
  const email = normalizeEmail(input.email);
  const displayName = fallbackDisplayName(email, input.displayName);
  const avatarUrl = input.avatarUrl ?? null;
  const appVersion = input.appVersion ?? null;
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  const existingUser = await env.DB.prepare(
    'SELECT id, email, display_name, avatar_url FROM users WHERE email = ? LIMIT 1',
  )
    .bind(email)
    .first<UserRow>();

  if (existingUser) {
    const existingUserId = existingUser.id;

    await env.DB.prepare(
      `UPDATE users
       SET display_name = CASE
         WHEN ? != '' THEN ?
         ELSE display_name
       END,
       avatar_url = COALESCE(?, avatar_url),
       last_app_version = COALESCE(?, last_app_version),
       last_login_at = ?,
       updated_at = ?
       WHERE id = ?`,
    )
      .bind(displayName, displayName, avatarUrl, appVersion, now, now, existingUserId)
      .run();

    await env.DB.prepare(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET
         user_id = excluded.user_id,
         email = excluded.email`,
    )
      .bind(crypto.randomUUID(), existingUserId, normalizeProvider(input.provider), input.providerUserId, email)
      .run();

    return {
      avatarUrl: avatarUrl ?? existingUser.avatar_url,
      displayName,
      email: existingUser.email,
      id: existingUser.id,
    };
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, last_app_version, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, email, displayName, avatarUrl, appVersion, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, normalizeProvider(input.provider), input.providerUserId, email)
    .run();

  return {
    avatarUrl,
    displayName,
    email,
    id: userId,
  };
}

export async function issueSessionCookie(
  env: Env,
  headers: Headers,
  request: Request,
  input: {
    email: string;
    plan?: string;
    provider: AuthProvider;
    providerUserId: string;
    redirectTo?: string | null;
    userId: string;
  },
): Promise<SessionRecord> {
  const session = await createSession(env, input);
  const signedSessionId = await signCookieValue(env, session.sessionId);

  appendSetCookie(headers, SESSION_COOKIE_NAME, signedSessionId, buildCookieOptions(request, { maxAge: SESSION_TTL_SECONDS }));

  return session;
}

export async function clearAuthCookies(headers: Headers, request: Request): Promise<void> {
  clearCookie(headers, SESSION_COOKIE_NAME, request);
  clearCookie(headers, AUTH_STATE_COOKIE_NAME, request);
}

export function buildGoogleAuthorizationUrl(input: ProviderAuthUrlInput): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scope ?? 'openid email profile');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', input.state);
  url.searchParams.set('prompt', 'select_account');

  return url.toString();
}

export function buildAuthCallbackUrl(request: Request, stateId: string, token?: string): string {
  const url = new URL('/api/auth/callback', request.url);
  url.searchParams.set('state', stateId);

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}

export function buildStateCookieValue(env: Env, stateId: string): Promise<string> {
  return signCookieValue(env, stateId);
}

export async function attachLoginStateCookie(
  env: Env,
  headers: Headers,
  request: Request,
  stateId: string,
): Promise<void> {
  const signedStateId = await buildStateCookieValue(env, stateId);

  appendSetCookie(headers, AUTH_STATE_COOKIE_NAME, signedStateId, buildCookieOptions(request, { maxAge: AUTH_STATE_TTL_SECONDS }));
}

export async function createMagicLinkToken(
  env: Env,
  input: {
    email: string;
    expiresAt: string;
    stateId: string;
  },
): Promise<string> {
  const payload: MagicLinkTokenPayload = {
    email: normalizeEmail(input.email),
    expiresAt: input.expiresAt,
    provider: 'magic_link',
    stateId: input.stateId,
  };

  return signStructuredValue(env, payload);
}

export async function verifyMagicLinkToken(
  env: Env,
  token: string | null | undefined,
): Promise<MagicLinkTokenPayload | null> {
  const payload = await verifyStructuredValue<MagicLinkTokenPayload>(env, token);

  if (!payload || payload.provider !== 'magic_link' || !payload.stateId || !payload.email) {
    return null;
  }

  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return null;
  }

  return payload;
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  await env.KV.delete(`${SESSION_KV_PREFIX}${sessionId}`);
}

export async function revokeSessionFromRequest(request: Request, env: Env): Promise<SessionRecord | null> {
  const session = await loadSessionFromRequest(request, env);

  if (!session) {
    return null;
  }

  await revokeSession(env, session.sessionId);
  return session;
}
