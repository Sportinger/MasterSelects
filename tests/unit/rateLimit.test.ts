import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppKVNamespace } from '../../functions/lib/env';
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIp,
  rateLimitedResponse,
} from '../../functions/lib/rateLimit';

function createKv(): { kv: AppKVNamespace; values: Map<string, string>; ttls: Map<string, number | undefined> } {
  const values = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const kv: AppKVNamespace = {
    delete: async (key) => {
      values.delete(key);
    },
    get: async <T = string>(key: string) => (values.get(key) ?? null) as T | null,
    list: async () => ({ keys: [], list_complete: true }),
    put: async (key, value, options) => {
      values.set(key, String(value));
      ttls.set(key, options?.expirationTtl);
    },
  };
  return { kv, ttls, values };
}

describe('KV rate limiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits up to the limit within a window and rejects the rest with a retry hint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'));
    const { kv, ttls } = createKv();
    const policy = { limit: 3, windowSeconds: 600 };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await consumeRateLimit(kv, 'rate-limit:test:abc', policy);
      expect(decision).toEqual({ allowed: true, count: attempt, retryAfterSeconds: 0 });
    }

    vi.setSystemTime(new Date('2026-09-02T10:04:00.000Z'));
    const rejected = await consumeRateLimit(kv, 'rate-limit:test:abc', policy);
    expect(rejected.allowed).toBe(false);
    expect(rejected.count).toBe(3);
    expect(rejected.retryAfterSeconds).toBe(360);
    expect(ttls.get('rate-limit:test:abc')).toBe(600);
  });

  it('starts a fresh window once the previous one has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'));
    const { kv } = createKv();
    const policy = { limit: 1, windowSeconds: 60 };

    expect((await consumeRateLimit(kv, 'k', policy)).allowed).toBe(true);
    expect((await consumeRateLimit(kv, 'k', policy)).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-09-02T10:01:01.000Z'));
    expect((await consumeRateLimit(kv, 'k', policy)).allowed).toBe(true);
  });

  it('tolerates legacy plain counters and never lets KV use a TTL under 60 seconds', async () => {
    const { kv, ttls, values } = createKv();
    values.set('legacy', '2');

    const decision = await consumeRateLimit(kv, 'legacy', { limit: 5, windowSeconds: 10 });
    expect(decision.allowed).toBe(true);
    expect(decision.count).toBe(3);
    expect(ttls.get('legacy')).toBe(60);
  });

  it('fails open by default and closed on request when KV is unavailable', async () => {
    const broken: AppKVNamespace = {
      delete: async () => {},
      get: async () => {
        throw new Error('kv down');
      },
      list: async () => ({ keys: [], list_complete: true }),
      put: async () => {},
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await consumeRateLimit(broken, 'k', { limit: 1, windowSeconds: 60 })).allowed).toBe(true);
    expect((await consumeRateLimit(broken, 'k', { limit: 1, windowSeconds: 60 }, { onError: 'deny' })).allowed).toBe(false);
    errorSpy.mockRestore();
  });

  it('hashes identities into opaque, secret-dependent keys', async () => {
    const withSecret = await buildRateLimitKey('auth-login:ip', '203.0.113.9', 'secret-a');
    const otherSecret = await buildRateLimitKey('auth-login:ip', '203.0.113.9', 'secret-b');
    const otherScope = await buildRateLimitKey('auth-login:email', '203.0.113.9', 'secret-a');

    expect(withSecret).toMatch(/^rate-limit:auth-login:ip:[a-f0-9]{24}$/);
    expect(withSecret).not.toContain('203.0.113.9');
    expect(withSecret).not.toBe(otherSecret);
    expect(withSecret).not.toBe(otherScope);
    expect(await buildRateLimitKey('auth-login:ip', '203.0.113.9', 'secret-a')).toBe(withSecret);
  });

  it('reads the edge client address only from CF-Connecting-IP', () => {
    expect(getClientIp(new Request('https://x.test', { headers: { 'CF-Connecting-IP': ' 2001:DB8::1 ' } }))).toBe('2001:db8::1');
    expect(getClientIp(new Request('https://x.test', { headers: { 'X-Forwarded-For': '203.0.113.9' } }))).toBeNull();
  });

  it('produces a generic 429 with a Retry-After header', async () => {
    const response = rateLimitedResponse({ allowed: false, count: 10, retryAfterSeconds: 42 }, { ok: false });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(await response.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests. Please try again later.',
      ok: false,
    });
  });
});
