import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/auth/reviewer';
import { loadUserFromSession } from '../../functions/lib/auth';
import { hashReviewerCredential } from '../../functions/lib/reviewerAccess';
import type { AppContext, Env } from '../../functions/lib/env';

async function fixture() {
  const code = 'c'.repeat(43);
  let account: unknown = { id: 'review', email: 'review@example.test', credential_hash: await hashReviewerCredential(code) };
  const values = new Map<string, string>();
  const env = {
    SESSION_SECRET: 'a-long-test-only-session-signing-secret',
    DB: { prepare: () => ({ bind: () => ({ first: async () => account }) }) },
    KV: {
      get: async (key: string, options?: { type?: string }) => {
        const value = values.get(key);
        return value === undefined ? null : options?.type === 'json' ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
    },
  } as unknown as Env;
  const request = (credential = code, origin = 'https://www.masterselects.com') => new Request('https://www.masterselects.com/api/auth/reviewer', {
    method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.4', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ account: 'review', credential }),
  });
  const context = (req: Request) => ({ env, request: req, data: {}, next: vi.fn(), waitUntil: vi.fn(), params: {} }) as AppContext;
  return { env, request, context, revoke: () => { account = null; }, expire: () => { values.clear(); } };
}

describe('reviewer login and revocation', () => {
  it('issues a scoped session repeatedly without email and revokes existing sessions', async () => {
    const f = await fixture();
    const response = await onRequest(f.context(f.request()));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/editor');
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const authenticated = new Request('https://www.masterselects.com/api/me', { headers: { Cookie: cookie } });
    expect(await loadUserFromSession(authenticated, f.env)).toMatchObject({ id: 'review', reviewer: true });
    expect(response.headers.get('Set-Cookie')).toContain('__ms_guest_access=');
    expect((await onRequest(f.context(f.request()))).status).toBe(303);
    f.revoke();
    await expect(loadUserFromSession(authenticated, f.env)).rejects.toThrow('Reviewer access revoked');
    expect((await onRequest(f.context(f.request()))).status).toBe(401);
  });
  it('rejects a valid reviewer cookie after the server-side session is gone', async () => {
    const f = await fixture();
    const response = await onRequest(f.context(f.request()));
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    f.expire();
    await expect(loadUserFromSession(new Request('https://www.masterselects.com/api/me', {
      headers: { Cookie: cookie },
    }), f.env)).rejects.toThrow('Reviewer access revoked');
  });
  it('rejects wrong credentials and cross-origin submissions', async () => {
    const f = await fixture();
    expect((await onRequest(f.context(f.request('d'.repeat(43))))).status).toBe(401);
    expect((await onRequest(f.context(f.request(undefined, 'https://foreign.example'))))).toHaveProperty('status', 403);
  });
});
