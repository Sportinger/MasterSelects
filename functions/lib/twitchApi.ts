const TOKEN_CACHE_KEY = 'twitch:app-token';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1_000;
const OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_API_ORIGIN = 'https://api.twitch.tv';

export interface TwitchConfiguration {
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
}

export interface TwitchTokenKv {
  delete(key: string): Promise<void>;
  get<T = string>(key: string, options?: { type?: 'text' | 'json' }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface TwitchApiDeps {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  kv: TwitchTokenKv;
  now?: () => number;
}

export interface TwitchChannelStatsData {
  configured: true;
  channel: string;
  displayName: string;
  profileImageUrl: string;
  live: boolean;
  viewerCount: number;
  title: string | null;
  gameName: string | null;
  startedAt: string | null;
}

export interface TwitchInvalidChannelResult {
  configured: true;
  error: 'invalid_channel';
  message: string;
}

export interface TwitchChannelNotFoundResult {
  configured: true;
  channel: string;
  error: 'not_found';
  message: string;
}

export interface TwitchApiFailureResult {
  configured: true;
  error: 'twitch_unavailable';
  message: string;
  status: number | null;
}

export type TwitchChannelStatsResult =
  | TwitchChannelStatsData
  | TwitchInvalidChannelResult
  | TwitchChannelNotFoundResult
  | TwitchApiFailureResult;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface HelixUser {
  display_name?: unknown;
  login?: unknown;
  profile_image_url?: unknown;
}

interface HelixStream {
  game_name?: unknown;
  started_at?: unknown;
  title?: unknown;
  viewer_count?: unknown;
}

interface HelixListResponse<T> {
  data?: T[];
}

class SafeTwitchError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'SafeTwitchError';
    this.status = status;
  }
}

export function isTwitchConfigured(env: TwitchConfiguration): boolean {
  return Boolean(env.TWITCH_CLIENT_ID?.trim() && env.TWITCH_CLIENT_SECRET?.trim());
}

export async function getTwitchAppToken(deps: TwitchApiDeps): Promise<string> {
  const nowMs = (deps.now ?? Date.now)();
  const cached = await readCachedToken(deps.kv);
  if (cached && cached.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > nowMs) {
    return cached.token;
  }

  const response = await (deps.fetch ?? fetch)(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
      grant_type: 'client_credentials',
    }),
  }).catch(() => {
    throw new SafeTwitchError('Twitch authentication failed: network error.', null);
  });

  if (!response.ok) {
    throw safeHttpError('authentication', response.status);
  }

  const payload = await readJson<OAuthTokenResponse>(response, 'authentication');
  if (typeof payload.access_token !== 'string' || !payload.access_token
    || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in)) {
    throw new SafeTwitchError('Twitch authentication failed: invalid response.', response.status);
  }

  const expiresInSeconds = Math.max(0, Math.floor(payload.expires_in));
  const token: CachedToken = {
    token: payload.access_token,
    expiresAtMs: nowMs + expiresInSeconds * 1_000,
  };
  await deps.kv.put(TOKEN_CACHE_KEY, JSON.stringify(token), {
    expirationTtl: Math.max(60, expiresInSeconds),
  });
  return token.token;
}

export async function fetchTwitchChannelStats(
  deps: TwitchApiDeps,
  channelLogin: string,
): Promise<TwitchChannelStatsResult> {
  const channel = channelLogin.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(channel)) {
    return {
      configured: true,
      error: 'invalid_channel',
      message: 'Enter a valid Twitch channel login (3-25 letters, numbers, or underscores).',
    };
  }

  try {
    const streams = await fetchHelixList<HelixStream>(
      deps,
      `/helix/streams?user_login=${encodeURIComponent(channel)}`,
    );
    const users = await fetchHelixList<HelixUser>(deps, `/helix/users?login=${encodeURIComponent(channel)}`);
    const user = users[0];
    if (!user) {
      return {
        configured: true,
        channel,
        error: 'not_found',
        message: 'Twitch channel not found.',
      };
    }

    const stream = streams[0];
    return {
      configured: true,
      channel: stringValue(user.login) || channel,
      displayName: stringValue(user.display_name) || channel,
      profileImageUrl: stringValue(user.profile_image_url),
      live: Boolean(stream),
      viewerCount: stream ? nonNegativeInteger(stream.viewer_count) : 0,
      title: stream ? nullableString(stream.title) : null,
      gameName: stream ? nullableString(stream.game_name) : null,
      startedAt: stream ? nullableString(stream.started_at) : null,
    };
  } catch (error) {
    const safeError = error instanceof SafeTwitchError
      ? error
      : new SafeTwitchError('Twitch API request failed: unexpected error.', null);
    return {
      configured: true,
      error: 'twitch_unavailable',
      message: safeError.message,
      status: safeError.status,
    };
  }
}

async function fetchHelixList<T>(deps: TwitchApiDeps, path: string): Promise<T[]> {
  let token = await getTwitchAppToken(deps);
  let response = await requestHelix(deps, path, token);
  if (response.status === 401) {
    await deps.kv.delete(TOKEN_CACHE_KEY);
    token = await getTwitchAppToken(deps);
    response = await requestHelix(deps, path, token);
  }
  if (!response.ok) {
    throw safeHttpError('API request', response.status);
  }

  const payload = await readJson<HelixListResponse<T>>(response, 'API request');
  if (!Array.isArray(payload.data)) {
    throw new SafeTwitchError('Twitch API request failed: invalid response.', response.status);
  }
  return payload.data;
}

function requestHelix(deps: TwitchApiDeps, path: string, token: string): Promise<Response> {
  return (deps.fetch ?? fetch)(`${HELIX_API_ORIGIN}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': deps.clientId,
    },
  }).catch(() => {
    throw new SafeTwitchError('Twitch API request failed: network error.', null);
  });
}

async function readCachedToken(kv: TwitchTokenKv): Promise<CachedToken | null> {
  const cached = await kv.get<unknown>(TOKEN_CACHE_KEY, { type: 'json' }).catch(() => null);
  if (!cached || typeof cached !== 'object') return null;
  const candidate = cached as Partial<CachedToken>;
  if (typeof candidate.token !== 'string' || !candidate.token
    || typeof candidate.expiresAtMs !== 'number' || !Number.isFinite(candidate.expiresAtMs)) {
    return null;
  }
  return { token: candidate.token, expiresAtMs: candidate.expiresAtMs };
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new SafeTwitchError(`Twitch ${operation} failed: invalid response.`, response.status);
  }
}

function safeHttpError(operation: string, status: number): SafeTwitchError {
  let reason = 'request failed';
  if (status === 401 || status === 403) reason = 'authentication rejected';
  else if (status === 429) reason = 'rate limited';
  else if (status >= 500) reason = 'service unavailable';
  return new SafeTwitchError(`Twitch ${operation} failed (${status}): ${reason}.`, status);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
