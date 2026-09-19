import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/auth/login';
import type { AppContext, Env } from '../../functions/lib/env';

const sendMagicLinkEmail = vi.fn(async () => undefined);

vi.mock('../../functions/lib/authProviders', () => ({
  sendMagicLinkEmail: (...args: unknown[]) => sendMagicLinkEmail(...args),
}));

interface FixtureOptions {
  environment?: string;
  mailConfigured?: boolean;
  url?: string;
}

function makeContext(options: FixtureOptions = {}): AppContext {
  const kv = new Map<string, string>();
  const env = {
    AUTH_EMAIL_FROM: options.mailConfigured === false ? undefined : 'MasterSelects <noreply@masterselects.com>',
    ENVIRONMENT: options.environment ?? 'production',
    KV: {
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      list: vi.fn(async () => ({ cursor: undefined, keys: [], list_complete: true })),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
    },
    RESEND_API_KEY: options.mailConfigured === false ? undefined : 're_test',
    SESSION_SECRET: 'test-session-secret-with-enough-entropy',
  } as unknown as Env;
  const url = options.url ?? 'https://www.masterselects.com/api/auth/login';
  return {
    data: {},
    env,
    next: vi.fn(async () => new Response()),
    params: {},
    request: new Request(url, {
      body: JSON.stringify({ email: 'Victim@Example.com', provider: 'magic_link' }),
      headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin },
      method: 'POST',
    }),
    waitUntil: vi.fn(),
  } as unknown as AppContext;
}

describe('POST /api/auth/login (magic link)', () => {
  afterEach(() => {
    sendMagicLinkEmail.mockClear();
  });

  it('never returns the signed callback URL to the caller when the link is emailed', async () => {
    const response = await onRequest(makeContext());
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(payload.delivery).toBe('email_sent');
    expect(payload.nextStep).toBe('check_email');
    expect(payload).not.toHaveProperty('verificationUrl');
    expect(JSON.stringify(payload)).not.toContain('token=');

    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1);
    const mail = sendMagicLinkEmail.mock.calls[0]?.[1] as { callbackUrl: string; email: string };
    expect(mail.email).toBe('victim@example.com');
    expect(mail.callbackUrl).toContain('/api/auth/callback?');
    expect(mail.callbackUrl).toContain('token=');
  });

  it('refuses to fall back to a debug link on a production host without mail delivery', async () => {
    const response = await onRequest(makeContext({ mailConfigured: false }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(payload.error).toBe('provider_not_configured');
    expect(payload).not.toHaveProperty('verificationUrl');
  });

  it('returns the debug link only for loopback development requests', async () => {
    const response = await onRequest(makeContext({
      environment: 'development',
      mailConfigured: false,
      url: 'http://localhost:5173/api/auth/login',
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(payload.delivery).toBe('debug_link');
    expect(String(payload.verificationUrl)).toContain('http://localhost:5173/api/auth/callback?');
    expect(sendMagicLinkEmail).not.toHaveBeenCalled();
  });
});
