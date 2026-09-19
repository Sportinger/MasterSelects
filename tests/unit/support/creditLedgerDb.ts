import type { AppD1Database, AppD1Statement } from '../../../functions/lib/env';
import type { CreditLedgerRow } from '../../../functions/lib/credits';

/**
 * In-memory stand-in for the D1 `credit_ledger` table used by the credit
 * tests. It understands exactly the statements `functions/lib/credits.ts`
 * issues, including the atomic conditional spend insert and the unique
 * (user_id, source, source_id) index, so concurrency and idempotency
 * behaviour can be exercised without a database.
 */
export interface LedgerDbOptions {
  /** When set, `run()` results omit `meta.changes` so callers must verify by reading back. */
  omitChanges?: boolean;
}

export function createCreditLedgerDb(rows: CreditLedgerRow[], options: LedgerDbOptions = {}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const balanceOf = (userId: unknown): number => rows
    .filter((row) => row.user_id === userId)
    .reduce((sum, row) => sum + row.amount, 0);
  const findBySource = (userId: unknown, source: unknown, sourceId: unknown): CreditLedgerRow | null => rows.find((row) => (
    row.user_id === userId && row.source === source && row.source_id === sourceId
  )) ?? null;
  const runResult = (changes: number): unknown => (options.omitChanges ? {} : { meta: { changes } });
  const insertRow = (row: CreditLedgerRow): void => {
    if (row.source_id !== null && findBySource(row.user_id, row.source, row.source_id)) {
      throw new Error('D1_ERROR: UNIQUE constraint failed: credit_ledger.user_id, credit_ledger.source, credit_ledger.source_id');
    }
    rows.push(row);
  };

  const db: AppD1Database = {
    async batch<T>(list: AppD1Statement[]): Promise<T[]> {
      for (const statement of list) await statement.run();
      return [];
    },
    async exec(): Promise<unknown> {
      return undefined;
    },
    prepare(rawSql: string): AppD1Statement {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      let bound: unknown[] = [];
      const statement: AppD1Statement = {
        bind(...values: unknown[]) {
          bound = values;
          statements.push({ sql, values });
          return statement;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('COALESCE(SUM(amount), 0) AS balance')) {
            return { balance: balanceOf(bound[0]) } as T;
          }
          if (sql.includes('WHERE user_id = ? AND source = ? AND source_id = ?')) {
            return findBySource(bound[0], bound[1], bound[2]) as T | null;
          }
          if (sql.includes("entry_type = 'spend'") && sql.includes('instr(')) {
            const [userId, taskId] = bound;
            return rows
              .filter((row) => row.user_id === userId
                && row.entry_type === 'spend'
                && row.amount < 0
                && (row.metadata_json ?? '').includes(String(taskId)))
              .at(-1) as T | null ?? null;
          }
          return null;
        },
        async raw<T>(): Promise<T[]> {
          return [];
        },
        async run(): Promise<unknown> {
          if (sql.startsWith('INSERT INTO credit_ledger') && sql.includes('SELECT ?, ?, \'spend\'')) {
            const [id, userId, amount, , debit, source, sourceId, description, metadataJson, createdAt, , required] = bound;
            const balance = balanceOf(userId);
            if (balance < Number(required)) return runResult(0);
            insertRow({
              amount: Number(amount),
              balance_after: balance - Number(debit),
              created_at: String(createdAt),
              description: description === null ? null : String(description),
              entry_type: 'spend',
              id: String(id),
              metadata_json: metadataJson === null ? null : String(metadataJson),
              source: String(source),
              source_id: sourceId === null ? null : String(sourceId),
              user_id: String(userId),
            });
            return runResult(1);
          }
          if (sql.startsWith('INSERT INTO credit_ledger')) {
            const [id, userId, entryType, amount, balanceAfter, source, sourceId, description, metadataJson, createdAt] = bound;
            insertRow({
              amount: Number(amount),
              balance_after: Number(balanceAfter),
              created_at: String(createdAt),
              description: description === null ? null : String(description),
              entry_type: entryType as CreditLedgerRow['entry_type'],
              id: String(id),
              metadata_json: metadataJson === null ? null : String(metadataJson),
              source: String(source),
              source_id: sourceId === null ? null : String(sourceId),
              user_id: String(userId),
            });
            return runResult(1);
          }
          if (sql.startsWith('UPDATE credit_ledger SET metadata_json = json_set')) {
            const [taskId, id] = bound;
            const row = rows.find((candidate) => candidate.id === id);
            if (!row) return runResult(0);
            row.metadata_json = JSON.stringify({ ...JSON.parse(row.metadata_json ?? '{}'), taskId });
            return runResult(1);
          }
          return runResult(0);
        },
      };
      return statement;
    },
  };

  return { db, rows, statements };
}

export function grantRow(userId: string, amount: number, id = `grant-${amount}`): CreditLedgerRow {
  return {
    amount,
    balance_after: amount,
    created_at: '2026-09-01T00:00:00.000Z',
    description: 'grant',
    entry_type: 'grant',
    id,
    metadata_json: null,
    source: 'test:grant',
    source_id: id,
    user_id: userId,
  };
}
