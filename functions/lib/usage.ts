import type { AppD1Database } from './env';

export type UsageStatus = 'pending' | 'completed' | 'failed';

export interface UsageEventRow {
  completed_at: string | null;
  created_at: string;
  credit_cost: number;
  feature: string;
  id: string;
  idempotency_key: string;
  ledger_entry_id: string | null;
  metadata_json: string | null;
  model: string | null;
  provider: string;
  request_units: string | null;
  status: UsageStatus;
  user_id: string;
}

export interface UsageEventInput {
  creditCost?: number;
  feature: string;
  idempotencyKey: string;
  ledgerEntryId?: string | null;
  metadata?: Record<string, unknown> | null;
  model?: string | null;
  provider: string;
  requestUnits?: string | null;
  userId: string;
}

export interface UsageFeatureSummary {
  completedCount: number;
  creditCost: number;
  feature: string;
  failedCount: number;
  pendingCount: number;
}

export interface UsageSummary {
  byFeature: UsageFeatureSummary[];
  completedCount: number;
  creditCost: number;
  failedCount: number;
  pendingCount: number;
  since: string;
}

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}

export async function createUsageEvent(
  db: AppD1Database,
  input: UsageEventInput,
): Promise<UsageEventRow | null> {
  const existing = await db
    .prepare(
      `
        SELECT id, user_id, feature, provider, model, request_units, credit_cost, status, ledger_entry_id, idempotency_key, metadata_json, created_at, completed_at
        FROM usage_events
        WHERE idempotency_key = ?
        LIMIT 1
    `,
    )
    .bind(input.idempotencyKey)
    .first<UsageEventRow>();

  if (existing) {
    return existing;
  }

  const row: UsageEventRow = {
    completed_at: null,
    created_at: new Date().toISOString(),
    credit_cost: input.creditCost ?? 0,
    feature: input.feature,
    id: crypto.randomUUID(),
    idempotency_key: input.idempotencyKey,
    ledger_entry_id: input.ledgerEntryId ?? null,
    metadata_json: toJson(input.metadata),
    model: input.model ?? null,
    provider: input.provider,
    request_units: input.requestUnits ?? null,
    status: 'pending',
    user_id: input.userId,
  };

  await db
    .prepare(
      `
        INSERT INTO usage_events (
          id,
          user_id,
          feature,
          provider,
          model,
          request_units,
          credit_cost,
          status,
          ledger_entry_id,
          idempotency_key,
          metadata_json,
          created_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      row.id,
      row.user_id,
      row.feature,
      row.provider,
      row.model,
      row.request_units,
      row.credit_cost,
      row.status,
      row.ledger_entry_id,
      row.idempotency_key,
      row.metadata_json,
      row.created_at,
      row.completed_at,
    )
    .run();

  return row;
}

export async function completeUsageEvent(
  db: AppD1Database,
  idempotencyKey: string,
  updates: { creditCost?: number | null; ledgerEntryId?: string | null; status?: UsageStatus } = {},
): Promise<void> {
  const completedAt = new Date().toISOString();

  await db
    .prepare(
      `
        UPDATE usage_events
        SET status = COALESCE(?, status),
            ledger_entry_id = COALESCE(?, ledger_entry_id),
            credit_cost = COALESCE(?, credit_cost),
            completed_at = ?
        WHERE idempotency_key = ?
      `,
    )
    .bind(updates.status ?? 'completed', updates.ledgerEntryId ?? null, updates.creditCost ?? null, completedAt, idempotencyKey)
    .run();
}

export async function getUsageSummary(
  db: AppD1Database,
  userId: string,
  windowDays = 30,
): Promise<UsageSummary> {
  const safeWindowDays = Number.isFinite(windowDays) ? Math.max(1, Math.min(365, Math.floor(windowDays))) : 30;
  const since = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db
      .prepare(
        `
          SELECT
            feature,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            COALESCE(SUM(credit_cost), 0) AS credit_cost
          FROM usage_events
          WHERE user_id = ? AND created_at >= ?
          GROUP BY feature
          ORDER BY feature ASC
        `,
      )
      .bind(userId, since)
      .all<{
        completed_count: number;
        credit_cost: number;
        feature: string;
        failed_count: number;
        pending_count: number;
      }>();

    const byFeature = (result.results ?? []).map((row) => ({
      completedCount: Number(row.completed_count ?? 0),
      creditCost: Number(row.credit_cost ?? 0),
      feature: row.feature,
      failedCount: Number(row.failed_count ?? 0),
      pendingCount: Number(row.pending_count ?? 0),
    }));

    return byFeature.reduce<UsageSummary>(
      (summary, row) => {
        summary.byFeature.push(row);
        summary.completedCount += row.completedCount;
        summary.creditCost += row.creditCost;
        summary.failedCount += row.failedCount;
        summary.pendingCount += row.pendingCount;
        return summary;
      },
      {
        byFeature: [],
        completedCount: 0,
        creditCost: 0,
        failedCount: 0,
        pendingCount: 0,
        since,
      },
    );
  } catch {
    return {
      byFeature: [],
      completedCount: 0,
      creditCost: 0,
      failedCount: 0,
      pendingCount: 0,
      since,
    };
  }
}
