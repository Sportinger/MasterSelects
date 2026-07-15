import { describe, expect, it } from 'vitest';
import {
  CREDIT_CLAIM_HASH_CONTEXT,
  CREDIT_CLAIM_REDEEM_CODE_HASH_CONTEXT,
  CREDIT_CLAIM_LEDGER_SOURCE,
  FREE_CREDIT_CAMPAIGN,
  WEBSITE_FREE_CREDIT_CAMPAIGN,
  getCreditClaimLedgerSourceId,
  getCreditClaimStatus,
  hashCreditClaimToken,
  hashCreditClaimRedeemCode,
  isCreditClaimEmailEligible,
  isFreeCreditOffer,
  isWebsiteFreeCreditOffer,
  isValidClaimAmount,
  isValidClaimEmail,
  isValidCreditClaimToken,
  isValidCreditClaimRedeemCode,
  normalizeClaimEmail,
  redeemCreditClaim,
  toCreditClaimPublicStatus,
  type CreditClaimRow,
} from '../../functions/lib/creditClaims';
import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';
import type { Env } from '../../functions/lib/env';
import { readCookie, signStructuredValue, verifyCookieValue, verifyStructuredValue } from '../../functions/lib/auth';
import { hasMatchingWebsiteFreeCreditOfferCookie } from '../../functions/lib/websiteFreeCreditOffer';

interface CapturedStatement extends AppD1Statement {
  sql: string;
  values: unknown[];
}

function createClaim(overrides: Partial<CreditClaimRow> = {}): CreditClaimRow {
  return {
    amount: 3000,
    campaign: null,
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
    redeem_code_hash: null,
    revoked_at: null,
    title: 'Issue reward',
    token_hash: 'hash',
    ...overrides,
  };
}

function createClaimDb(): { batchStatements: CapturedStatement[]; db: AppD1Database } {
  let batchStatements: CapturedStatement[] = [];
  const db: AppD1Database = {
    batch: async (statements) => {
      batchStatements = statements as CapturedStatement[];
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
    exec: async () => undefined,
    prepare: (sql) => {
      const statement: CapturedStatement = {
        all: async () => ({ results: [] }),
        bind: (...values) => {
          statement.values = values;
          return statement;
        },
        first: async () => ({ balance: 0 } as never),
        raw: async () => [],
        run: async () => ({ meta: { changes: 1 } }),
        sql,
        values: [],
      };
      return statement;
    },
  };

  return {
    get batchStatements() {
      return batchStatements;
    },
    db,
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
    expect(isValidCreditClaimToken('000123')).toBe(false);
    expect(isValidCreditClaimRedeemCode('000123')).toBe(true);
    expect(isValidCreditClaimToken('12345')).toBe(false);
    expect(isValidCreditClaimRedeemCode('12345')).toBe(false);
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

  it('hashes six-digit redeem codes with a separate context', async () => {
    const hash = await hashCreditClaimRedeemCode('000123');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashCreditClaimRedeemCode('12345')).toBe('');
    expect(CREDIT_CLAIM_REDEEM_CODE_HASH_CONTEXT).toBe('masterselects:credit-redeem-code:v1:');
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
    expect(status.freeOffer).toBe(false);
    expect(status.claimable).toBe(false);
    expect(JSON.stringify(status)).not.toContain('user@example.com');
  });

  it('uses a dedicated ledger source namespace', () => {
    expect(CREDIT_CLAIM_LEDGER_SOURCE).toBe('manual:credit_claim');
    expect(getCreditClaimLedgerSourceId('claim_123')).toBe('credit-claim:claim_123');
  });

  it('identifies only free-offer claims for the one-at-a-time circuit breaker', () => {
    expect(isFreeCreditOffer(createClaim())).toBe(false);
    expect(isFreeCreditOffer(createClaim({ campaign: FREE_CREDIT_CAMPAIGN }))).toBe(true);
    expect(isFreeCreditOffer(createClaim({ campaign: WEBSITE_FREE_CREDIT_CAMPAIGN }))).toBe(true);
    expect(isWebsiteFreeCreditOffer(createClaim({ campaign: FREE_CREDIT_CAMPAIGN }))).toBe(false);
    expect(isWebsiteFreeCreditOffer(createClaim({ campaign: WEBSITE_FREE_CREDIT_CAMPAIGN }))).toBe(true);
  });

  it('requires the signed winning browser cookie for automatic website gifts', async () => {
    const env = { SESSION_SECRET: 'test-session-secret' } as Env;
    const code = '123456';
    const claim = createClaim({
      campaign: WEBSITE_FREE_CREDIT_CAMPAIGN,
      redeem_code_hash: await hashCreditClaimRedeemCode(code),
    });
    const signed = await signStructuredValue(env, {
      claimId: claim.id,
      expiresAt: '2099-01-01T00:00:00.000Z',
      redeemCode: code,
    });
    const request = new Request('https://www.masterselects.com/api/credits/claim', {
      headers: { Cookie: `__ms_website_free_credit=${encodeURIComponent(signed)}` },
    });

    expect(await signStructuredValue(env, {
      claimId: claim.id,
      expiresAt: '2099-01-01T00:00:00.000Z',
      redeemCode: code,
    })).toBe(signed);
    expect(readCookie(request, '__ms_website_free_credit')).toBe(signed);
    expect(await verifyCookieValue(env, signed)).not.toBeNull();
    expect(await verifyStructuredValue(env, readCookie(request, '__ms_website_free_credit'))).toEqual({
      claimId: claim.id,
      expiresAt: '2099-01-01T00:00:00.000Z',
      redeemCode: code,
    });
    expect(await hasMatchingWebsiteFreeCreditOfferCookie(env, request, claim)).toBe(true);
    expect(await hasMatchingWebsiteFreeCreditOfferCookie(
      env,
      request,
      { ...claim, id: 'another-claim' },
    )).toBe(false);
    expect(await hasMatchingWebsiteFreeCreditOfferCookie(env, request, createClaim())).toBe(true);
  });

  it('redeems a free offer through one transaction that also disarms its active campaign', async () => {
    const fake = createClaimDb();
    const result = await redeemCreditClaim(
      fake.db,
      createClaim({ campaign: WEBSITE_FREE_CREDIT_CAMPAIGN }),
      { email: 'user@example.com', id: 'user_1' },
      'user@example.com',
      new Date('2026-06-15T10:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    expect(fake.batchStatements).toHaveLength(3);
    expect(fake.batchStatements[0].sql).toContain('active_claim_id = ?');
    expect(fake.batchStatements[0].values).toContain(WEBSITE_FREE_CREDIT_CAMPAIGN);
    expect(fake.batchStatements[1].sql).toContain('SET is_armed = 0');
    expect(fake.batchStatements[2].sql).toContain('claimed_claim_id = ?');
  });
});
