import { describe, expect, it } from 'vitest';
import {
  decryptAdminCreditClaimToken,
  encryptAdminCreditClaimToken,
  generateAdminCreditClaimToken,
} from '../../functions/lib/adminCreditClaims';
import type { Env } from '../../functions/lib/env';

function createEnv(secret = 'test-admin-secret-that-is-longer-than-thirty-two-characters'): Env {
  return {
    ADMIN_SESSION_SECRET: secret,
    DB: {} as Env['DB'],
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
  };
}

describe('admin credit-link token storage', () => {
  it('generates a high-entropy URL-safe token', () => {
    const first = generateAdminCreditClaimToken();
    const second = generateAdminCreditClaimToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first).not.toBe(second);
  });

  it('encrypts a token at rest and binds it to the claim id', async () => {
    const env = createEnv();
    const token = generateAdminCreditClaimToken();
    const encrypted = await encryptAdminCreditClaimToken(env, 'claim-a', token);

    expect(encrypted.ciphertext).not.toContain(token);
    await expect(decryptAdminCreditClaimToken(env, 'claim-a', encrypted.ciphertext, encrypted.iv))
      .resolves.toBe(token);
    await expect(decryptAdminCreditClaimToken(env, 'claim-b', encrypted.ciphertext, encrypted.iv))
      .resolves.toBeNull();
    await expect(decryptAdminCreditClaimToken(
      createEnv('a-different-admin-secret-with-more-than-thirty-two-characters'),
      'claim-a',
      encrypted.ciphertext,
      encrypted.iv,
    )).resolves.toBeNull();
  });
});
