import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_EMAIL_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  onRequest,
} from '../../functions/api/auth/login';
import type { AppContext, AppKVNamespace, Env } from '../../functions/lib/env';

const sendMagicLinkEmail = vi.fn(async () => undefined);

vi.mock('../../functions/lib/authProviders', () => ({
  sendMagicLinkEmail: (...args: unknown[]) => sendMagicLinkEmail(...args),
}));

function createKv(): AppKVNamespace {
  const values = new Map<string, string>();
  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async <T = string>(key: string, options?: { type?: string }) => {
      const value = values.get(key);
      if (value === undefined) return null;
      return (options?.type === 'json' ? JSON.parse(value) : value) as T;
    },
    list: async () => ({ keys: [], list_complete: true }),
    put: async (key, value) => {
      values.set(key, String(value));
    },
  };
}

function createEnv(): Env {
  return {
    AUTH_EMAIL_FROM: 'MasterSelects <noreply@masterselects.com>',
    ENVIRONMENT: 'production',
    KV: createKv(),
    RESEND_API_KEY: 're_test',
    SESSION_SECRET: 'test-session-secret-with-enough-entropy',
  } as unknown as Env;
}

function loginRequest(input: { email: string; ip?: string; origin?: string | null }): AppContext['request'] {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.origin !== null) headers.Origin = input.origin ?? 'https://www.masterselects.com';
  if (input.ip) headers['CF-Connecting-IP'] = input.ip;
  return new Request('https://www.masterselects.com/api/auth/login', {
    body: JSON.stringify({ email: input.email, provider: 'magic_link' }),
    headers,
    method: 'POST',
  });
}

function makeContext(env: Env, request: Request): AppContext {
  return {
    data: { requestId: 'req-test' },
    env,
    next: vi.fn(async () => new Response()),
    params: {},
    request,
    waitUntil: vi.fn(),
  } as unknown as AppContext;
}

describe('POST /api/auth/login abuse controls', () => {
  afterEach(() => {
    sendMagicLinkEmail.mockClear();
  });

  it('requires a same-origin Origin header', async () => {
    const env = createEnv();

    const missing = await onRequest(makeContext(env, loginRequest({ email: 'a@example.com', origin: null })));
    const foreign = await onRequest(makeContext(env, loginRequest({ email: 'a@example.com', origin: 'https://evil.example' })));

    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it('caps magic-link requests per email address', async () => {
    const env = createEnv();

    for (let attempt = 0; attempt < LOGIN_EMAIL_RATE_LIMIT.limit; attempt += 1) {
      const response = await onRequest(makeContext(env, loginRequest({ email: 'Victim@Example.com', ip: `203.0.113.${attempt + 1}` })));
      expect(response.status).toBe(202);
    }

    const blocked = await onRequest(makeContext(env, loginRequest({ email: 'victim@example.com', ip: '203.0.113.99' })));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(await blocked.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests. Please try again later.',
    });
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(LOGIN_EMAIL_RATE_LIMIT.limit);
  });

  it('caps login bootstraps per client address across different emails', async () => {
    const env = createEnv();

    for (let attempt = 0; attempt < LOGIN_IP_RATE_LIMIT.limit; attempt += 1) {
      const response = await onRequest(makeContext(env, loginRequest({ email: `user${attempt}@example.com`, ip: '198.51.100.5' })));
      expect(response.status).toBe(202);
    }

    const blocked = await onRequest(makeContext(env, loginRequest({ email: 'fresh@example.com', ip: '198.51.100.5' })));
    expect(blocked.status).toBe(429);
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(LOGIN_IP_RATE_LIMIT.limit);
  });

  it('returns a fixed message when the email provider fails', async () => {
    const env = createEnv();
    sendMagicLinkEmail.mockRejectedValueOnce(new Error('Resend said: API key re_test is invalid for domain example'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await onRequest(makeContext(env, loginRequest({ email: 'a@example.com', ip: '203.0.113.1' })));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: 'magic_link_send_failed',
      message: 'The sign-in email could not be sent. Please try again in a moment.',
      requestId: 'req-test',
    });
    expect(JSON.stringify(payload)).not.toContain('re_test');
    errorSpy.mockRestore();
  });
});
