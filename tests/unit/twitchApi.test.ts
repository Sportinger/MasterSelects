import { describe, expect, it, vi } from 'vitest';

import {
  fetchTwitchChannelStats,
  getTwitchAppToken,
  isTwitchConfigured,
  type TwitchApiDeps,
  type TwitchTokenKv,
} from '../../functions/lib/twitchApi';

class MemoryKv implements TwitchTokenKv {
  readonly values = new Map<string, string>();
  readonly delete = vi.fn(async (key: string) => { this.values.delete(key); });
  readonly put = vi.fn(async (key: string, value: string) => { this.values.set(key, value); });

  async get<T = string>(key: string, options?: { type?: 'text' | 'json' }): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return (options?.type === 'json' ? JSON.parse(value) : value) as T;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deps(fetchImpl: typeof fetch, kv = new MemoryKv(), now = 1_000_000): TwitchApiDeps {
  return {
    clientId: 'client-id',
    clientSecret: 'top-secret-value',
    fetch: fetchImpl,
    kv,
    now: () => now,
  };
}

describe('Twitch API core', () => {
  it('detects configuration only when both credentials are non-empty', () => {
    expect(isTwitchConfigured({ TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret' })).toBe(true);
    expect(isTwitchConfigured({ TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: '  ' })).toBe(false);
    expect(isTwitchConfigured({})).toBe(false);
  });

  it('caches app tokens and refreshes them inside the five-minute buffer', async () => {
    const kv = new MemoryKv();
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'token-one', expires_in: 3_600 })) as unknown as typeof fetch;
    const requestDeps = deps(fetchMock, kv);

    expect(await getTwitchAppToken(requestDeps)).toBe('token-one');
    expect(await getTwitchAppToken(requestDeps)).toBe('token-one');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(kv.values.get('twitch:app-token') ?? '{}')).toEqual({
      token: 'token-one',
      expiresAtMs: 4_600_000,
    });

    kv.values.set('twitch:app-token', JSON.stringify({ token: 'nearly-expired', expiresAtMs: 1_240_000 }));
    expect(await getTwitchAppToken(requestDeps)).toBe('token-one');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates a rejected token and retries a Helix 401 exactly once', async () => {
    const kv = new MemoryKv();
    const responses = [
      jsonResponse({ access_token: 'old-token', expires_in: 3_600 }),
      jsonResponse({ message: 'invalid token' }, 401),
      jsonResponse({ access_token: 'fresh-token', expires_in: 3_600 }),
      jsonResponse({ data: [] }),
      jsonResponse({ data: [{ login: 'creator', display_name: 'Creator', profile_image_url: 'avatar' }] }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? jsonResponse({}, 500)) as unknown as typeof fetch;

    const result = await fetchTwitchChannelStats(deps(fetchMock, kv), 'Creator');

    expect(result).toMatchObject({ configured: true, channel: 'creator', live: false });
    expect(kv.delete).toHaveBeenCalledWith('twitch:app-token');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((fetchMock.mock.calls[3]?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
  });

  it('does not retry repeatedly when the fresh token also receives 401', async () => {
    const responses = [
      jsonResponse({ access_token: 'old-token', expires_in: 3_600 }),
      jsonResponse({}, 401),
      jsonResponse({ access_token: 'fresh-token', expires_in: 3_600 }),
      jsonResponse({}, 401),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? jsonResponse({}, 500)) as unknown as typeof fetch;

    const result = await fetchTwitchChannelStats(deps(fetchMock), 'creator');

    expect(result).toMatchObject({ error: 'twitch_unavailable', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('validates channel logins before making a request', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const result = await fetchTwitchChannelStats(deps(fetchMock), 'bad-channel!');
    expect(result).toMatchObject({ configured: true, error: 'invalid_channel' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps live and offline stats plus unknown users', async () => {
    const user = { login: 'creator', display_name: 'Creator', profile_image_url: 'https://avatar.test/image.png' };
    const liveFetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/users?')
      ? jsonResponse({ data: [user] })
      : jsonResponse({ data: [{ viewer_count: 321, title: 'Live title', game_name: 'Art', started_at: '2026-08-24T10:00:00Z' }] })) as unknown as typeof fetch;
    const offlineFetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/users?')
      ? jsonResponse({ data: [user] })
      : jsonResponse({ data: [] })) as unknown as typeof fetch;
    const missingFetch = vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch;
    const liveKv = new MemoryKv();
    const offlineKv = new MemoryKv();
    const missingKv = new MemoryKv();
    for (const kv of [liveKv, offlineKv, missingKv]) {
      kv.values.set('twitch:app-token', JSON.stringify({ token: 'cached', expiresAtMs: 10_000_000 }));
    }

    await expect(fetchTwitchChannelStats(deps(liveFetch, liveKv), 'creator')).resolves.toEqual({
      configured: true,
      channel: 'creator',
      displayName: 'Creator',
      profileImageUrl: 'https://avatar.test/image.png',
      live: true,
      viewerCount: 321,
      title: 'Live title',
      gameName: 'Art',
      startedAt: '2026-08-24T10:00:00Z',
    });
    await expect(fetchTwitchChannelStats(deps(offlineFetch, offlineKv), 'creator')).resolves.toMatchObject({
      live: false,
      viewerCount: 0,
      title: null,
      gameName: null,
      startedAt: null,
    });
    await expect(fetchTwitchChannelStats(deps(missingFetch, missingKv), 'creator')).resolves.toMatchObject({
      configured: true,
      channel: 'creator',
      error: 'not_found',
    });
  });

  it('never includes Twitch response bodies or the client secret in returned failures', async () => {
    const secret = 'top-secret-value';
    const fetchMock = vi.fn(async () => jsonResponse({ message: `rejected ${secret}` }, 400)) as unknown as typeof fetch;
    const result = await fetchTwitchChannelStats(deps(fetchMock), 'creator');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('rejected');
    expect(result).toMatchObject({ error: 'twitch_unavailable', status: 400 });
  });
});
