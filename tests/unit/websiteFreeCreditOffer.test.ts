import { describe, expect, it } from 'vitest';
import { acquireWebsiteFreeCreditOffer } from '../../functions/lib/websiteFreeCreditOffer';
import type { AppD1Database, AppD1Statement, Env } from '../../functions/lib/env';

interface StoredClaim {
  claimedAt: string | null;
  expiresAt: string;
  id: string;
  revokedAt: string | null;
}

class FakeStatement implements AppD1Statement {
  values: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly state: { activeClaimId: string | null; armed: boolean; claims: Map<string, StoredClaim> },
  ) {}

  bind(...values: unknown[]): AppD1Statement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async first<T>(columnName?: string): Promise<T | null> {
    if (this.sql.includes('CASE WHEN active.id IS NOT NULL')) {
      const now = String(this.values[0]);
      const active = this.state.activeClaimId ? this.state.claims.get(this.state.activeClaimId) : null;
      return {
        active_claim_id: this.state.activeClaimId,
        active_is_available: active
          && !active.claimedAt
          && !active.revokedAt
          && active.expiresAt > now ? 1 : 0,
        is_armed: this.state.armed ? 1 : 0,
      } as T;
    }

    if (this.sql.startsWith('SELECT active_claim_id')) {
      return (columnName ? this.state.activeClaimId : { active_claim_id: this.state.activeClaimId }) as T | null;
    }

    return null;
  }

  async raw<T>(): Promise<T[]> {
    return [];
  }

  async run(): Promise<unknown> {
    if (this.sql.startsWith('UPDATE credit_claims SET revoked_at')) {
      const claim = this.state.claims.get(String(this.values[1]));
      if (claim) claim.revokedAt = String(this.values[0]);
    }
    return { meta: { changes: 1 } };
  }
}

function createFakeEnv(): { env: Env; state: { activeClaimId: string | null; armed: boolean; claims: Map<string, StoredClaim> } } {
  const state = { activeClaimId: null as string | null, armed: true, claims: new Map<string, StoredClaim>() };
  const db: AppD1Database = {
    async batch<T>(statements: AppD1Statement[]): Promise<T[]> {
      const [insert, activate] = statements as FakeStatement[];
      const claimId = String(insert.values[0]);
      state.claims.set(claimId, {
        claimedAt: null,
        expiresAt: String(insert.values[5]),
        id: claimId,
        revokedAt: null,
      });

      const now = String(activate.values[4]);
      const current = state.activeClaimId ? state.claims.get(state.activeClaimId) : null;
      const currentAvailable = current
        && !current.claimedAt
        && !current.revokedAt
        && current.expiresAt > now;
      if (state.armed && !currentAvailable) state.activeClaimId = claimId;
      return [];
    },
    async exec(): Promise<unknown> {
      return undefined;
    },
    prepare(sql: string): AppD1Statement {
      return new FakeStatement(sql.trim(), state);
    },
  };

  return {
    env: { DB: db, SESSION_SECRET: 'test-session-secret' } as Env,
    state,
  };
}

describe('automatic website free offer', () => {
  it('allows one active browser at a time and releases an expired reservation', async () => {
    const fake = createFakeEnv();
    const request = new Request('https://www.masterselects.com/api/credits/free-offer');
    const start = new Date('2026-07-14T12:00:00.000Z');

    const first = await acquireWebsiteFreeCreditOffer(fake.env, request, start);
    const blocked = await acquireWebsiteFreeCreditOffer(fake.env, request, new Date(start.getTime() + 30_000));
    const afterExpiry = await acquireWebsiteFreeCreditOffer(fake.env, request, new Date(start.getTime() + 61 * 60_000));

    expect(first).toMatchObject({ amount: 3000 });
    expect(first?.redeemCode).toMatch(/^\d{6}$/);
    expect(blocked).toBeNull();
    expect(afterExpiry).toMatchObject({ amount: 3000 });
    expect(fake.state.activeClaimId).not.toBeNull();
  });
});
