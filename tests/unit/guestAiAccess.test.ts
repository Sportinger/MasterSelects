import { describe, expect, it } from 'vitest';
import {
  ensureGuestAccess,
  GUEST_ACCESS_COOKIE_NAME,
  GUEST_MINT_RATE_LIMIT,
} from '../../functions/lib/guestAccess';
import type { AppD1Database, AppD1Statement, AppKVNamespace, Env } from '../../functions/lib/env';

interface GuestState {
  claims: Map<string, { networkHash: string; userId: string }>;
  guests: Set<string>;
  ledger: Array<{
    amount: number;
    balance_after: number;
    id: string;
    source: string;
    source_id: string | null;
    user_id: string;
  }>;
  users: Map<string, string>;
}

class GuestStatement implements AppD1Statement {
  values: unknown[] = [];

  constructor(readonly sql: string, private readonly state: GuestState) {}

  bind(...values: unknown[]): AppD1Statement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async first<T>(columnName?: string): Promise<T | null> {
    if (this.sql.includes('FROM guest_welcome_credit_claims') && this.sql.includes('client_fingerprint_hash = ?')) {
      const claim = this.state.claims.get(String(this.values[0]));
      return (claim ? { user_id: claim.userId } : null) as T | null;
    }
    if (this.sql.includes('COUNT(*) AS claim_count')) {
      const networkHash = String(this.values[0]);
      const count = Array.from(this.state.claims.values())
        .filter((claim) => claim.networkHash === networkHash).length;
      return (columnName ? count : { claim_count: count }) as T;
    }
    if (this.sql.includes('FROM guest_accounts')) {
      const userId = String(this.values[0]);
      const email = this.state.users.get(userId);
      return email && this.state.guests.has(userId) ? { email, id: userId } as T : null;
    }
    if (this.sql.includes('COALESCE(SUM(amount), 0)')) {
      const userId = String(this.values[0]);
      const balance = this.state.ledger
        .filter((entry) => entry.user_id === userId)
        .reduce((total, entry) => total + entry.amount, 0);
      return (columnName ? balance : { balance }) as T;
    }
    if (this.sql.includes('FROM credit_ledger') && this.sql.includes('source_id = ?')) {
      const [userId, source, sourceId] = this.values.map(String);
      return (this.state.ledger.find((entry) => (
        entry.user_id === userId && entry.source === source && entry.source_id === sourceId
      )) ?? null) as T | null;
    }
    return null;
  }

  async raw<T>(): Promise<T[]> {
    return [];
  }

  async run(): Promise<unknown> {
    if (this.sql.startsWith('INSERT OR IGNORE INTO guest_welcome_credit_claims')) {
      const [clientFingerprintHash, networkHash, userId] = this.values.map(String);
      if (!this.state.claims.has(clientFingerprintHash)) {
        this.state.claims.set(clientFingerprintHash, { networkHash, userId });
      }
    } else if (this.sql.startsWith('INSERT INTO users')) {
      this.state.users.set(String(this.values[0]), String(this.values[1]));
    } else if (this.sql.startsWith('INSERT INTO guest_accounts')) {
      this.state.guests.add(String(this.values[0]));
    } else if (this.sql.includes('INSERT INTO credit_ledger')) {
      this.state.ledger.push({
        amount: Number(this.values[3]),
        balance_after: Number(this.values[4]),
        id: String(this.values[0]),
        source: String(this.values[5]),
        source_id: this.values[6] == null ? null : String(this.values[6]),
        user_id: String(this.values[1]),
      });
    }
    return { meta: { changes: 1 } };
  }
}

function createKv(): AppKVNamespace {
  const values = new Map<string, string>();
  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async <T = string>(key: string) => (values.get(key) ?? null) as T | null,
    list: async () => ({ keys: [], list_complete: true }),
    put: async (key, value) => {
      values.set(key, String(value));
    },
  };
}

function createEnv(overrides: Partial<Env> = {}): { env: Env; state: GuestState } {
  const state: GuestState = { claims: new Map(), guests: new Set(), ledger: [], users: new Map() };
  const db: AppD1Database = {
    async batch<T>(statements: AppD1Statement[]): Promise<T[]> {
      for (const statement of statements) await statement.run();
      return [];
    },
    async exec(): Promise<unknown> {
      return undefined;
    },
    prepare(sql: string): AppD1Statement {
      return new GuestStatement(sql.trim(), state);
    },
  };
  return {
    env: { DB: db, KV: createKv(), SESSION_SECRET: 'guest-access-test-secret', ...overrides } as Env,
    state,
  };
}

function guestRequest(ip: string, headers: Record<string, string> = {}): Request {
  return new Request('https://masterselects.test/api/me', {
    headers: { 'CF-Connecting-IP': ip, ...headers },
  });
}

describe('guest AI access', () => {
  it('issues one durable guest identity with exactly 400 welcome credits', async () => {
    const { env, state } = createEnv();
    const first = await ensureGuestAccess(env, guestRequest('203.0.113.7'));

    expect(first).not.toBeNull();
    expect(first!.user.id).toMatch(/^guest:/);
    expect(first!.setCookie).toContain(`${GUEST_ACCESS_COOKIE_NAME}=`);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({
      amount: 400,
      balance_after: 400,
      source: 'system:welcome_credit_grant',
      user_id: first!.user.id,
    });

    const second = await ensureGuestAccess(
      env,
      guestRequest('203.0.113.7', { Cookie: first!.setCookie!.split(';')[0] }),
    );

    expect(second!.user.id).toBe(first!.user.id);
    expect(second!.setCookie).toBeNull();
    expect(state.ledger).toHaveLength(1);
  });

  it('refuses to mint a guest without an attributable client address outside local development', async () => {
    const { env, state } = createEnv();

    const result = await ensureGuestAccess(env, new Request('https://masterselects.test/api/me'));

    expect(result).toBeNull();
    expect(state.guests.size).toBe(0);
    expect(state.ledger).toHaveLength(0);
  });

  it('still mints a credited guest for loopback development requests without an address', async () => {
    const { env, state } = createEnv({ ENVIRONMENT: 'development' });

    const result = await ensureGuestAccess(env, new Request('http://localhost:8788/api/me'));

    expect(result).not.toBeNull();
    expect(state.guests.size).toBe(1);
    expect(state.ledger).toHaveLength(1);
  });

  it('caps the number of new guest identities one address may mint per window', async () => {
    const { env, state } = createEnv();
    const results: Array<Awaited<ReturnType<typeof ensureGuestAccess>>> = [];

    for (let index = 0; index <= GUEST_MINT_RATE_LIMIT.limit; index += 1) {
      results.push(await ensureGuestAccess(env, guestRequest('198.51.100.20')));
    }

    expect(results.slice(0, GUEST_MINT_RATE_LIMIT.limit).every((result) => result !== null)).toBe(true);
    expect(results.at(-1)).toBeNull();
    expect(state.guests.size).toBe(GUEST_MINT_RATE_LIMIT.limit);
  });

  it('does not issue fresh credits after the same client deletes its guest cookie', async () => {
    const { env, state } = createEnv();
    const request = () => new Request('https://masterselects.test/api/me', {
      headers: {
        'CF-Connecting-IP': '203.0.113.42',
        'User-Agent': 'MasterSelects Test Browser',
      },
    });

    const first = await ensureGuestAccess(env, request());
    const afterCookieDeletion = await ensureGuestAccess(env, request());

    expect(afterCookieDeletion!.user.id).not.toBe(first!.user.id);
    expect(afterCookieDeletion!.setCookie).toContain(`${GUEST_ACCESS_COOKIE_NAME}=`);
    expect(state.claims.size).toBe(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].user_id).toBe(first!.user.id);
    expect(Array.from(state.claims.keys()).join(' ')).not.toContain('203.0.113.42');

    // The refused guest does not pick the grant up on a later visit either.
    await ensureGuestAccess(
      env,
      guestRequest('203.0.113.42', { Cookie: afterCookieDeletion!.setCookie!.split(';')[0] }),
    );
    expect(state.ledger).toHaveLength(1);
  });

  it('grants the welcome credits once per client address regardless of the User-Agent', async () => {
    const { env, state } = createEnv();

    for (let index = 0; index < 4; index += 1) {
      await ensureGuestAccess(env, guestRequest('198.51.100.9', { 'User-Agent': `Rotating Browser ${index}` }));
    }

    expect(state.claims.size).toBe(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.guests.size).toBe(4);
  });
});
