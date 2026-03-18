import type { AppD1Database } from './env';

export type CreditLedgerEntryType = 'grant' | 'spend' | 'adjustment';

export interface CreditLedgerRow {
  amount: number;
  balance_after: number;
  created_at: string;
  description: string | null;
  entry_type: CreditLedgerEntryType;
  id: string;
  metadata_json: string | null;
  source: string;
  source_id: string | null;
  user_id: string;
}

export interface CreditLedgerEntryInput {
  amount: number;
  description?: string | null;
  entryType: CreditLedgerEntryType;
  metadata?: Record<string, unknown> | null;
  source: string;
  sourceId?: string | null;
  userId: string;
}

export interface CreditBalanceSummary {
  balance: number;
  recentEntries: CreditLedgerRow[];
}

export interface SpendCreditsResult {
  balance: number;
  charged: boolean;
  entry: CreditLedgerRow | null;
  insufficient: boolean;
}

export const FREE_PLAN_MONTHLY_CREDITS = 25;
export const FREE_PLAN_MONTHLY_SOURCE = 'system:free_plan_monthly_grant';

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}

export async function getCreditBalance(db: AppD1Database, userId: string): Promise<number> {
  try {
    const result = await db
      .prepare(
        `
          SELECT COALESCE(SUM(amount), 0) AS balance
          FROM credit_ledger
          WHERE user_id = ?
      `,
      )
      .bind(userId)
      .first<{ balance: number }>();

    return Number(result?.balance ?? 0);
  } catch {
    return 0;
  }
}

export async function listCreditEntries(
  db: AppD1Database,
  userId: string,
  limit = 10,
): Promise<CreditLedgerRow[]> {
  try {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 10;
    const result = await db
      .prepare(
        `
          SELECT id, user_id, entry_type, amount, balance_after, source, source_id, description, metadata_json, created_at
          FROM credit_ledger
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .bind(userId, safeLimit)
      .all<CreditLedgerRow>();

    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function getCreditSummary(
  db: AppD1Database,
  userId: string,
  limit = 10,
): Promise<CreditBalanceSummary> {
  const [balance, recentEntries] = await Promise.all([getCreditBalance(db, userId), listCreditEntries(db, userId, limit)]);

  return {
    balance,
    recentEntries,
  };
}

export async function getCreditLedgerEntryBySource(
  db: AppD1Database,
  userId: string,
  source: string,
  sourceId: string | null | undefined,
): Promise<CreditLedgerRow | null> {
  const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : '';

  if (!normalizedSourceId) {
    return null;
  }

  try {
    return await db
      .prepare(
        `
          SELECT id, user_id, entry_type, amount, balance_after, source, source_id, description, metadata_json, created_at
          FROM credit_ledger
          WHERE user_id = ? AND source = ? AND source_id = ?
          LIMIT 1
      `,
      )
      .bind(userId, source, normalizedSourceId)
      .first<CreditLedgerRow>();
  } catch {
    return null;
  }
}

export async function appendCreditLedgerEntry(
  db: AppD1Database,
  input: CreditLedgerEntryInput,
): Promise<CreditLedgerRow | null> {
  const existing = await getCreditLedgerEntryBySource(db, input.userId, input.source, input.sourceId);

  if (existing) {
    return null;
  }

  const balanceBefore = await getCreditBalance(db, input.userId);
  const balanceAfter = balanceBefore + input.amount;
  const row: CreditLedgerRow = {
    amount: input.amount,
    balance_after: balanceAfter,
    created_at: new Date().toISOString(),
    description: input.description ?? null,
    entry_type: input.entryType,
    id: crypto.randomUUID(),
    metadata_json: toJson(input.metadata),
    source: input.source,
    source_id: input.sourceId ?? null,
    user_id: input.userId,
  };

  try {
    await db
      .prepare(
        `
          INSERT INTO credit_ledger (
            id,
            user_id,
            entry_type,
            amount,
            balance_after,
            source,
            source_id,
            description,
            metadata_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        row.id,
        row.user_id,
        row.entry_type,
        row.amount,
        row.balance_after,
        row.source,
        row.source_id,
        row.description,
        row.metadata_json,
        row.created_at,
      )
      .run();
  } catch {
    if (!input.sourceId) {
      throw new Error('Failed to append credit ledger entry');
    }

    return null;
  }

  return row;
}

export async function grantPlanCredits(
  db: AppD1Database,
  userId: string,
  amount: number,
  source: string,
  sourceId: string,
  metadata?: Record<string, unknown> | null,
): Promise<CreditLedgerRow | null> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return appendCreditLedgerEntry(db, {
    amount,
    description: 'Subscription credit grant',
    entryType: 'grant',
    metadata: metadata ?? null,
    source,
    sourceId,
    userId,
  });
}

export async function spendCredits(
  db: AppD1Database,
  userId: string,
  amount: number,
  source: string,
  sourceId: string,
  description: string,
  metadata?: Record<string, unknown> | null,
): Promise<SpendCreditsResult> {
  const safeAmount = Math.max(0, Math.floor(amount));
  const currentBalance = await getCreditBalance(db, userId);

  const existingEntry = await getCreditLedgerEntryBySource(db, userId, source, sourceId);
  if (existingEntry) {
    return {
      balance: currentBalance,
      charged: false,
      entry: existingEntry,
      insufficient: false,
    };
  }

  if (safeAmount <= 0) {
    return {
      balance: currentBalance,
      charged: false,
      entry: null,
      insufficient: false,
    };
  }

  if (currentBalance < safeAmount) {
    return {
      balance: currentBalance,
      charged: false,
      entry: null,
      insufficient: true,
    };
  }

  const entry = await appendCreditLedgerEntry(db, {
    amount: -safeAmount,
    description,
    entryType: 'spend',
    metadata: metadata ?? null,
    source,
    sourceId,
    userId,
  });

  if (!entry) {
    const duplicateEntry = await getCreditLedgerEntryBySource(db, userId, source, sourceId);

    if (duplicateEntry) {
      return {
        balance: await getCreditBalance(db, userId),
        charged: false,
        entry: duplicateEntry,
        insufficient: false,
      };
    }

    throw new Error('Failed to append credit ledger entry');
  }

  return {
    balance: entry.balance_after,
    charged: true,
    entry,
    insufficient: false,
  };
}

export async function ensureFreePlanCredits(
  db: AppD1Database,
  userId: string,
): Promise<CreditLedgerRow | null> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  return appendCreditLedgerEntry(db, {
    amount: FREE_PLAN_MONTHLY_CREDITS,
    description: 'Free plan monthly credits',
    entryType: 'grant',
    metadata: {
      grant_type: 'monthly',
      grant_month: monthKey,
      plan_id: 'free',
    },
    source: FREE_PLAN_MONTHLY_SOURCE,
    sourceId: `free-plan:${monthKey}`,
    userId,
  });
}
