import type { AppD1Database } from './env';

export interface ExportRunAnalytics {
  available: boolean;
  started: number;
  completed: number;
  cancelled: number;
  failed: number;
  withoutOutcome: number;
  eventsWithoutRunId: number;
}

export async function loadExportRunAnalytics(db: AppD1Database): Promise<ExportRunAnalytics> {
  try {
    const row = await db.prepare(`WITH export_events AS (
      SELECT session_id, event_name, received_at, id,
             NULLIF(json_extract(properties_json, '$.run_id'), '') AS run_id
      FROM product_analytics_events
      WHERE event_name IN ('export_started', 'export_completed', 'export_failed', 'export_cancelled')
        AND julianday(received_at) >= julianday('now', '-7 days')
    ), starts AS (
      SELECT session_id, run_id, MIN(received_at) AS started_at
      FROM export_events WHERE event_name = 'export_started' AND run_id IS NOT NULL
      GROUP BY session_id, run_id
    ), outcomes AS (
      SELECT session_id, run_id, event_name,
             ROW_NUMBER() OVER (PARTITION BY session_id, run_id ORDER BY received_at DESC, id DESC) AS ordinal
      FROM export_events WHERE event_name != 'export_started' AND run_id IS NOT NULL
    ) SELECT COUNT(*) AS started,
      COALESCE(SUM(outcomes.event_name = 'export_completed'), 0) AS completed,
      COALESCE(SUM(outcomes.event_name = 'export_cancelled'), 0) AS cancelled,
      COALESCE(SUM(outcomes.event_name = 'export_failed'), 0) AS failed,
      COALESCE(SUM(outcomes.event_name IS NULL), 0) AS withoutOutcome,
      (SELECT COUNT(*) FROM export_events WHERE run_id IS NULL) AS eventsWithoutRunId
    FROM starts LEFT JOIN outcomes USING (session_id, run_id)
    WHERE outcomes.ordinal = 1 OR outcomes.ordinal IS NULL`).first<Omit<ExportRunAnalytics, 'available'>>();
    return {
      available: true,
      started: Number(row?.started ?? 0), completed: Number(row?.completed ?? 0),
      cancelled: Number(row?.cancelled ?? 0), failed: Number(row?.failed ?? 0),
      withoutOutcome: Number(row?.withoutOutcome ?? 0),
      eventsWithoutRunId: Number(row?.eventsWithoutRunId ?? 0),
    };
  } catch {
    return { available: false, started: 0, completed: 0, cancelled: 0, failed: 0, withoutOutcome: 0, eventsWithoutRunId: 0 };
  }
}
