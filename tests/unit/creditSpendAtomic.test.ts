import { describe, expect, it } from 'vitest';
import { spendCredits } from '../../functions/lib/credits';
import { createCreditLedgerDb, grantRow } from './support/creditLedgerDb';

describe('spendCredits (atomic conditional debit)', () => {
  it('debits inside one conditional statement and reports the exact balance after', async () => {
    const { db, rows, statements } = createCreditLedgerDb([grantRow('user-1', 100)]);

    const result = await spendCredits(db, 'user-1', 30, 'hosted:test', 'idem-1', 'test spend', { requestId: 'r1' });

    expect(result).toMatchObject({ balance: 70, charged: true, insufficient: false });
    expect(result.entry).toMatchObject({ amount: -30, balance_after: 70, source: 'hosted:test', source_id: 'idem-1' });
    expect(rows).toHaveLength(2);
    const insert = statements.find((statement) => statement.sql.startsWith('INSERT INTO credit_ledger'));
    expect(insert?.sql).toContain('WHERE (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = ?) >= ?');
  });

  it('never overdraws when parallel spends race for the same balance', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => spendCredits(db, 'user-1', 30, 'hosted:test', `idem-${index}`, 'race')),
    );

    expect(results.filter((result) => result.charged)).toHaveLength(3);
    expect(results.filter((result) => result.insufficient)).toHaveLength(3);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(10);
  });

  it('reports insufficient balance without writing a row', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 10)]);

    const result = await spendCredits(db, 'user-1', 30, 'hosted:test', 'idem-1', 'too much');

    expect(result).toEqual({ balance: 10, charged: false, entry: null, insufficient: true });
    expect(rows).toHaveLength(1);
  });

  it('treats a repeat of the same source id as already charged, even when the balance is now insufficient', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 40)]);

    const first = await spendCredits(db, 'user-1', 30, 'hosted:test', 'idem-1', 'first');
    const repeat = await spendCredits(db, 'user-1', 30, 'hosted:test', 'idem-1', 'repeat');

    expect(first.charged).toBe(true);
    expect(repeat).toMatchObject({ balance: 10, charged: false, insufficient: false });
    expect(repeat.entry?.id).toBe(first.entry?.id);
    expect(rows).toHaveLength(2);
  });

  it('recovers when the statement result carries no change count', async () => {
    const { db } = createCreditLedgerDb([grantRow('user-1', 100)], { omitChanges: true });

    const charged = await spendCredits(db, 'user-1', 30, 'hosted:test', 'idem-1', 'no meta');
    const insufficient = await spendCredits(db, 'user-1', 500, 'hosted:test', 'idem-2', 'no meta');

    expect(charged).toMatchObject({ balance: 70, charged: true, insufficient: false });
    expect(insufficient).toMatchObject({ charged: false, entry: null, insufficient: true });
  });

  it('does not charge non-positive amounts', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);

    const result = await spendCredits(db, 'user-1', 0, 'hosted:test', 'idem-zero', 'free');

    expect(result).toEqual({ balance: 100, charged: false, entry: null, insufficient: false });
    expect(rows).toHaveLength(1);
  });
});
