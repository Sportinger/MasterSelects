import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_COOKIE,
  clearAdminLoginFailures,
  createAdminSession,
  getAdminLoginRetryAfter,
  hasAdminTrustedOrigin,
  hasValidAdminCsrf,
  isAdminConfigured,
  loadAdminSession,
  recordAdminLoginFailure,
  verifyAdminPassword,
} from '../../functions/lib/adminAuth';
import type { AppKVNamespace, Env } from '../../functions/lib/env';

const encoder = new TextEncoder();

function encodeBase64Url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createPasswordHash(password: string): Promise<string> {
  const salt = encoder.encode('admin-auth-test-salt');
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { hash: 'SHA-256', iterations: 10, name: 'PBKDF2', salt },
    keyMaterial,
    256,
  );
  return `pbkdf2-sha256$10$${encodeBase64Url(salt)}$${encodeBase64Url(hash)}`;
}

function createKv(): AppKVNamespace {
  const values = new Map<string, string>();
  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async <T = string>(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }) => {
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

describe('admin authentication', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      ADMIN_PASSWORD_HASH: await createPasswordHash('correct horse battery staple'),
      ADMIN_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
      DB: {} as Env['DB'],
      KV: createKv(),
      MEDIA: {} as Env['MEDIA'],
    };
  });

  it('verifies the PBKDF2 password without storing the plaintext password', async () => {
    expect(isAdminConfigured(env)).toBe(true);
    await expect(verifyAdminPassword(env, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyAdminPassword(env, 'wrong password')).resolves.toBe(false);
    expect(env.ADMIN_PASSWORD_HASH).not.toContain('correct horse battery staple');
  });

  it('accepts the transport-safe base64url hash secret', async () => {
    env.ADMIN_PASSWORD_HASH_B64 = encodeBase64Url(encoder.encode(env.ADMIN_PASSWORD_HASH!));
    delete env.ADMIN_PASSWORD_HASH;

    expect(isAdminConfigured(env)).toBe(true);
    await expect(verifyAdminPassword(env, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyAdminPassword(env, 'wrong password')).resolves.toBe(false);
  });

  it('creates a signed expiring session and rejects a modified cookie', async () => {
    const { cookieValue, session } = await createAdminSession(env, new Date('2026-07-30T10:00:00.000Z'));
    const request = new Request('https://www.masterselects.com/admin', {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookieValue}` },
    });

    await expect(loadAdminSession(request, env, new Date('2026-07-30T11:00:00.000Z')))
      .resolves.toMatchObject({ csrfToken: session.csrfToken, sessionId: session.sessionId });
    expect(hasValidAdminCsrf(new Request('https://www.masterselects.com/api/admin/claims', {
      headers: { 'x-masterselects-admin-csrf': session.csrfToken },
    }), session)).toBe(true);

    const tampered = new Request('https://www.masterselects.com/admin', {
      headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${cookieValue.slice(0, -1)}x` },
    });
    await expect(loadAdminSession(tampered, env)).resolves.toBeNull();
    await expect(loadAdminSession(request, env, new Date('2026-07-31T00:00:00.000Z'))).resolves.toBeNull();
  });

  it('requires an exact same-origin header for state-changing requests', () => {
    expect(hasAdminTrustedOrigin(new Request('https://www.masterselects.com/api/admin/login', {
      headers: { Origin: 'https://www.masterselects.com' },
    }))).toBe(true);
    expect(hasAdminTrustedOrigin(new Request('https://www.masterselects.com/api/admin/login', {
      headers: { Origin: 'https://evil.example' },
    }))).toBe(false);
    expect(hasAdminTrustedOrigin(new Request('https://www.masterselects.com/api/admin/login'))).toBe(false);
  });

  it('locks repeated login failures and clears the record after success', async () => {
    const request = new Request('https://www.masterselects.com/api/admin/login', {
      headers: { 'cf-connecting-ip': '203.0.113.8' },
    });
    const now = Date.parse('2026-07-30T10:00:00.000Z');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordAdminLoginFailure(request, env, now + attempt);
    }
    await expect(getAdminLoginRetryAfter(request, env, now + 10)).resolves.toBeGreaterThan(0);

    await clearAdminLoginFailures(request, env);
    await expect(getAdminLoginRetryAfter(request, env, now + 10)).resolves.toBe(0);
  });
});
