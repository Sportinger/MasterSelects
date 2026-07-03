import { describe, expect, it } from 'vitest';
import { refundCreditsForFailedTask, type CreditLedgerRow } from '../../functions/lib/credits';

function createLedgerDb(rows: CreditLedgerRow[]) {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          bound = args;
          return this;
        },
        async first<T>() {
          if (sql.includes('COALESCE(SUM(amount)')) {
            const [userId] = bound;
            const balance = rows
              .filter((row) => row.user_id === userId)
              .reduce((sum, row) => sum + row.amount, 0);
            return { balance } as T;
          }

          if (sql.includes('WHERE user_id = ? AND source = ? AND source_id = ?')) {
            const [userId, source, sourceId] = bound;
            return rows.find((row) =>
              row.user_id === userId && row.source === source && row.source_id === sourceId
            ) as T | null;
          }

          if (sql.includes("entry_type = 'spend'")) {
            const [userId, taskId] = bound;
            return rows
              .filter((row) =>
                row.user_id === userId
                && row.entry_type === 'spend'
                && row.amount < 0
                && (row.metadata_json ?? '').includes(String(taskId))
              )
              .at(-1) as T | null;
          }

          return null;
        },
        async run() {
          const [
            id,
            userId,
            entryType,
            amount,
            balanceAfter,
            source,
            sourceId,
            description,
            metadataJson,
            createdAt,
          ] = bound;

          rows.push({
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

          return {};
        },
      };
    },
  };
}

describe('refundCreditsForFailedTask', () => {
  it('refunds a failed hosted task once', async () => {
    const rows: CreditLedgerRow[] = [
      {
        amount: 20,
        balance_after: 20,
        created_at: '2026-06-24T10:00:00.000Z',
        description: 'grant',
        entry_type: 'grant',
        id: 'grant-1',
        metadata_json: null,
        source: 'test:grant',
        source_id: 'grant-1',
        user_id: 'user-1',
      },
      {
        amount: -6,
        balance_after: 14,
        created_at: '2026-06-24T10:01:00.000Z',
        description: 'Hosted generation',
        entry_type: 'spend',
        id: 'spend-1',
        metadata_json: JSON.stringify({ taskId: 'task-abc' }),
        source: 'hosted:kling_generation',
        source_id: 'idem-1',
        user_id: 'user-1',
      },
    ];
    const db = createLedgerDb(rows);

    const first = await refundCreditsForFailedTask(db as never, 'user-1', 'task-abc');
    const second = await refundCreditsForFailedTask(db as never, 'user-1', 'task-abc');

    expect(first).toMatchObject({
      creditBalance: 20,
      credits: 6,
      idempotencyKey: 'idem-1',
      jobId: 'task-abc',
      refunded: true,
    });
    expect(second).toMatchObject({
      creditBalance: 20,
      credits: 6,
      refunded: false,
    });
    expect(rows.filter((row) => row.source === 'refund:hosted:kling_generation')).toHaveLength(1);
  });
});
