import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/auth/callback';
import {
  attachLoginStateCookie,
  createLoginState,
  createMagicLinkToken,
} from '../../functions/lib/auth';
import type { AppContext, AppD1Database, AppD1Statement, AppKVNamespace, Env } from '../../functions/lib/env';

const exchangeGoogleCodeForProfile = vi.fn();

vi.mock('../../functions/lib/authProviders', () => ({
  exchangeGoogleCodeForProfile: (...args: unknown[]) => exchangeGoogleCodeForProfile(...args),
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

function createDb(statements: Array<{ sql: string; values: unknown[] }>): AppD1Database {
  return {
    batch: async () => [],
    exec: async () => ({}),
    prepare(sql: string): AppD1Statement {
      const statement: AppD1Statement = {
        all: async <T>() => ({ results: [] as T[] }),
        bind: (...values: unknown[]) => {
          statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
          return statement;
        },
        first: async () => null,
        raw: async () => [],
        run: async () => ({ meta: { changes: 1 } }),
      };
      return statement;
    },
  };
}

function makeEnv(): { env: Env; statements: Array<{ sql: string; values: unknown[] }> } {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  return {
    env: {
      DB: createDb(statements),
      ENVIRONMENT: 'production',
      KV: createKv(),
      SESSION_SECRET: 'test-session-secret-with-enough-entropy',
    } as unknown as Env,
    statements,
  };
}

async function startLogin(env: Env, provider: 'google' | 'magic_link', email: string) {
  const request = new Request('https://www.masterselects.com/api/auth/login', { method: 'POST' });
  const state = await createLoginState(env, request, { email, provider, redirectTo: '/' });
  const headers = new Headers();
  await attachLoginStateCookie(env, headers, request, state.stateId);
  return { cookie: headers.get('Set-Cookie')!.split(';')[0], state };
}

function callbackContext(env: Env, query: string, cookie?: string): AppContext {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return {
    data: { requestId: 'req-callback' },
    env,
    next: vi.fn(async () => new Response()),
    params: {},
    request: new Request(`https://www.masterselects.com/api/auth/callback?${query}`, { headers, method: 'GET' }),
    waitUntil: vi.fn(),
  } as unknown as AppContext;
}

describe('GET /api/auth/callback state binding', () => {
  afterEach(() => {
    exchangeGoogleCodeForProfile.mockReset();
  });

  it('rejects a Google callback that arrives without the login state cookie', async () => {
    const { env } = makeEnv();
    const { state } = await startLogin(env, 'google', '');

    const response = await onRequest(callbackContext(env, `state=${state.stateId}&code=auth-code`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'state_mismatch' });
    expect(exchangeGoogleCodeForProfile).not.toHaveBeenCalled();
  });

  it('rejects a Google callback whose cookie belongs to a different login', async () => {
    const { env } = makeEnv();
    const victim = await startLogin(env, 'google', '');
    const attacker = await startLogin(env, 'google', '');

    const response = await onRequest(callbackContext(env, `state=${attacker.state.stateId}&code=auth-code`, victim.cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'state_mismatch' });
    expect(exchangeGoogleCodeForProfile).not.toHaveBeenCalled();
  });

  it('proceeds with a matching cookie and hides upstream Google errors', async () => {
    const { env } = makeEnv();
    const { cookie, state } = await startLogin(env, 'google', '');
    exchangeGoogleCodeForProfile.mockRejectedValueOnce(new Error('invalid_grant from https://oauth2.googleapis.com/token'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await onRequest(callbackContext(env, `state=${state.stateId}&code=auth-code`, cookie));
    const payload = await response.json() as Record<string, unknown>;

    expect(exchangeGoogleCodeForProfile).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error: 'provider_exchange_failed',
      message: 'Google sign-in could not be completed. Please try again.',
      requestId: 'req-callback',
    });
    expect(JSON.stringify(payload)).not.toContain('invalid_grant');
    errorSpy.mockRestore();
  });

  it('lets a magic link complete on a device without the cookie and ignores identity hints in the query', async () => {
    const { env, statements } = makeEnv();
    const { state } = await startLogin(env, 'magic_link', 'person@example.com');
    const token = await createMagicLinkToken(env, {
      email: 'person@example.com',
      expiresAt: state.expiresAt,
      stateId: state.stateId,
    });

    const response = await onRequest(callbackContext(
      env,
      `state=${state.stateId}&token=${encodeURIComponent(token)}&sub=attacker-subject&provider_user_id=attacker`,
    ));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, nextStep: 'session_issued' });
    const identityInsert = statements.find((statement) => statement.sql.startsWith('INSERT INTO auth_identities'));
    expect(identityInsert?.values[2]).toBe('magic_link');
    expect(identityInsert?.values[3]).toBe('person@example.com');
    expect(JSON.stringify(statements)).not.toContain('attacker');
  });
});
