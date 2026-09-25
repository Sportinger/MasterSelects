import { describe, expect, it, vi } from 'vitest';
import { hashReviewerCredential, verifyReviewerCredential } from '../../functions/lib/reviewerAccess';
import { reserveReviewerCost } from '../../functions/lib/reviewerBudget';
import { reviewerSignInPage } from '../../functions/lib/reviewerSignInPage';
import type { AppD1Database } from '../../functions/lib/env';

function dbWithRow(row: unknown, insertError?: Error) {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
    run: insertError ? vi.fn().mockRejectedValue(insertError) : vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  };
  return { db: { prepare: vi.fn().mockReturnValue(statement) } as unknown as AppD1Database, statement };
}

describe('dedicated reviewer credentials', () => {
  const credential = 'a'.repeat(43);
  it('accepts only the provisioned account and a matching high-entropy-format credential', async () => {
    const account = { id: 'reviewer', email: 'review@example.test', credential_hash: await hashReviewerCredential(credential) };
    const { db } = dbWithRow(account);
    expect(await verifyReviewerCredential(db, 'reviewer', credential)).toEqual(account);
    expect(await verifyReviewerCredential(db, 'reviewer', 'b'.repeat(43))).toBeNull();
    expect(await verifyReviewerCredential(db, 'reviewer', 'password')).toBeNull();
    expect(await verifyReviewerCredential(dbWithRow(null).db, 'missing', credential)).toBeNull();
  });
  it('never embeds credentials in the login URL and prevents external resources', async () => {
    const response = reviewerSignInPage();
    const html = await response.text();
    expect(html).toContain('method="post" action="/api/auth/reviewer"');
    expect(html).toContain('type="password"');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('reviewer cost admission', () => {
  const bound = { euroMicros: 100_000, operationDigest: 'a'.repeat(64) };
  it('blocks missing, invalid or over-budget bounds without touching the database', async () => {
    const { db } = dbWithRow(null);
    for (const input of [null, { ...bound, euroMicros: NaN }, { ...bound, euroMicros: 5_000_001 }, { ...bound, euroMicros: 0 }]) {
      expect(await reserveReviewerCost(db, 'r', 'request', input)).toBe('blocked');
    }
    expect(db.prepare).not.toHaveBeenCalled();
  });
  it('grants upstream execution only after the unique insert succeeds', async () => {
    expect(await reserveReviewerCost(dbWithRow(null).db, 'r', 'request', bound)).toBe('reserved');
    const existing = { operation_digest: bound.operationDigest, upper_bound_eur_micros: bound.euroMicros };
    expect(await reserveReviewerCost(dbWithRow(existing, new Error('duplicate')).db, 'r', 'request', bound)).toBe('replay');
    expect(await reserveReviewerCost(dbWithRow({ ...existing, operation_digest: 'b'.repeat(64) }, new Error('duplicate')).db, 'r', 'request', bound)).toBe('blocked');
  });
  it('fails closed on storage failures', async () => {
    const { db, statement } = dbWithRow(null, new Error('database unavailable'));
    statement.first.mockRejectedValue(new Error('database unavailable'));
    expect(await reserveReviewerCost(db, 'r', 'request', bound)).toBe('blocked');
  });
});
