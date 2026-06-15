import { describe, expect, it } from 'vitest';
import {
  CREDIT_CLAIM_HASH_CONTEXT,
  CREDIT_CLAIM_LEDGER_SOURCE,
  getCreditClaimLedgerSourceId,
  getCreditClaimStatus,
  hashCreditClaimToken,
  isCreditClaimEmailEligible,
  isValidClaimAmount,
  isValidClaimEmail,
  isValidCreditClaimToken,
  normalizeClaimEmail,
  toCreditClaimPublicStatus,
  type CreditClaimRow,
} from '../../functions/lib/creditClaims';

function createClaim(overrides: Partial<CreditClaimRow> = {}): CreditClaimRow {
  return {
    amount: 3000,
    claimed_at: null,
    claimed_by_user_id: null,
    claimed_email: null,
    created_at: '2026-06-15T10:00:00.000Z',
    created_by: 'cloudflare-admin',
    description: 'Reward for reported issues',
    expected_email: 'user@example.com',
    expires_at: '2026-07-15T10:00:00.000Z',
    id: 'claim_1',
    metadata_json: null,
    revoked_at: null,
    title: 'Issue reward',
    token_hash: 'hash',
    ...overrides,
  };
}

describe('credit claims', () => {
  it('normalizes and validates public claim inputs', () => {
    expect(normalizeClaimEmail(' USER@Example.COM ')).toBe('user@example.com');
    expect(isValidClaimEmail('user@example.com')).toBe(true);
    expect(isValidClaimEmail('not-an-email')).toBe(false);
    expect(isValidClaimAmount(3000)).toBe(true);
    expect(isValidClaimAmount(0)).toBe(false);
    expect(isValidCreditClaimToken('a'.repeat(32))).toBe(true);
    expect(isValidCreditClaimToken('short')).toBe(false);
    expect(isValidCreditClaimToken(`${'a'.repeat(31)}!`)).toBe(false);
  });

  it('hashes claim codes with the claim-specific context', async () => {
    const token = 'abc123_ABC-xyz'.repeat(3);
    const first = await hashCreditClaimToken(token);
    const second = await hashCreditClaimToken(` ${token} `);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(token);
    expect(CREDIT_CLAIM_HASH_CONTEXT).toBe('masterselects:credit-claim:v1:');
  });

  it('derives claim status from server-side fields', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');

    expect(getCreditClaimStatus(createClaim(), now)).toBe('available');
    expect(getCreditClaimStatus(createClaim({ claimed_at: '2026-06-15T10:01:00.000Z' }), now)).toBe('claimed');
    expect(getCreditClaimStatus(createClaim({ expires_at: '2026-06-15T09:59:59.000Z' }), now)).toBe('expired');
    expect(getCreditClaimStatus(createClaim({ revoked_at: '2026-06-15T09:59:59.000Z' }), now)).toBe('revoked');
    expect(getCreditClaimStatus(createClaim({ amount: 0 }), now)).toBe('invalid');
  });

  it('requires the signed-in email for locked claims', () => {
    const claim = createClaim({ expected_email: 'user@example.com' });

    expect(isCreditClaimEmailEligible(claim, { email: 'USER@example.com', id: 'user_1' })).toBe(true);
    expect(isCreditClaimEmailEligible(claim, { email: 'other@example.com', id: 'user_2' })).toBe(false);
    expect(isCreditClaimEmailEligible(createClaim({ expected_email: null }), { email: 'other@example.com', id: 'user_2' })).toBe(true);
  });

  it('public status does not expose the locked email', () => {
    const status = toCreditClaimPublicStatus(
      createClaim({ expected_email: 'user@example.com' }),
      { email: 'other@example.com', id: 'user_2' },
      new Date('2026-06-15T10:00:00.000Z'),
    );

    expect(status.emailLocked).toBe(true);
    expect(status.claimable).toBe(false);
    expect(JSON.stringify(status)).not.toContain('user@example.com');
  });

  it('uses a dedicated ledger source namespace', () => {
    expect(CREDIT_CLAIM_LEDGER_SOURCE).toBe('manual:credit_claim');
    expect(getCreditClaimLedgerSourceId('claim_123')).toBe('credit-claim:claim_123');
  });
});
