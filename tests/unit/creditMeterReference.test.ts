import { describe, expect, it, vi } from 'vitest';
import { getCreditMeterReference } from '../../functions/lib/credits';

interface FakeResult {
  created_at?: string;
  high_water?: number;
}

function databaseReturning(resolve: (sql: string, bindings: unknown[]) => FakeResult | null) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...bindings: unknown[]) => ({
        first: async () => resolve(sql, bindings),
      }),
    })),
  };
}

describe('credit meter reference', () => {
  it('uses the current epoch grant high-water while excluding adjustment rows', async () => {
    const db = databaseReturning((sql) => {
      if (sql.includes('MAX(balance_after)')) return { high_water: 5_000 };
      return null;
    });

    const reference = await getCreditMeterReference(db as never, 'user-1', {
      balance: 430,
      epochStart: '2026-07-01T00:00:00.000Z',
      monthlyCredits: 1_000,
    });

    expect(reference).toBe(5_000);
    const highWaterSql = db.prepare.mock.calls[0]?.[0] ?? '';
    expect(highWaterSql).toContain("entry_type = 'grant'");
    expect(highWaterSql).not.toContain("entry_type = 'adjustment'");
  });

  it('never returns a reference below the exact balance or plan allowance', async () => {
    const db = databaseReturning(() => ({ high_water: 100 }));

    await expect(getCreditMeterReference(db as never, 'user-1', {
      balance: 6_000,
      epochStart: '2026-07-01T00:00:00.000Z',
      monthlyCredits: 1_000,
    })).resolves.toBe(6_000);

    await expect(getCreditMeterReference(db as never, 'user-1', {
      balance: 50,
      epochStart: '2026-07-01T00:00:00.000Z',
      monthlyCredits: 1_000,
    })).resolves.toBe(1_000);
  });

  it('falls back to the latest recurring grant and tolerates reference-query failure', async () => {
    const db = databaseReturning((sql) => {
      if (sql.includes("source IN")) return { created_at: '2026-07-15T00:00:00.000Z' };
      if (sql.includes('MAX(balance_after)')) return { high_water: 2_400 };
      return null;
    });
    await expect(getCreditMeterReference(db as never, 'user-1', {
      balance: 600,
      monthlyCredits: 1_000,
    })).resolves.toBe(2_400);

    const failingDb = {
      prepare: () => {
        throw new Error('D1 unavailable');
      },
    };
    await expect(getCreditMeterReference(failingDb as never, 'user-1', {
      balance: 600,
      monthlyCredits: 1_000,
    })).resolves.toBe(1_000);
  });
});
