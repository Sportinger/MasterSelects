import type { AppD1Database } from './env';

interface OperationGroup {
  operation: string; stage: string; outcome: string; signal: string; failureCode: string;
  appVersion: string; operations: number; sessions: number; averageElapsedMs: number;
}
export interface ProductOperationAnalytics {
  available: boolean; groups: OperationGroup[]; groupsTruncated: boolean;
}

/** A missing terminal event is incomplete evidence, never a proven user cancellation. */
export async function loadProductOperationAnalytics(db: AppD1Database): Promise<ProductOperationAnalytics> {
  try {
    const rows = await db.prepare(`WITH ranked AS (
      SELECT session_id, app_version,
        json_extract(properties_json, '$.operation') AS operation,
        json_extract(properties_json, '$.stage') AS stage,
        json_extract(properties_json, '$.state') AS state,
        COALESCE(json_extract(properties_json, '$.signal'), 'not_observed') AS signal,
        COALESCE(json_extract(properties_json, '$.failure_code'), 'not_observed') AS failureCode,
        COALESCE(json_extract(properties_json, '$.elapsed_ms'), 0) AS elapsed,
        ROW_NUMBER() OVER (
          PARTITION BY session_id, json_extract(properties_json, '$.operation_id')
          ORDER BY (json_extract(properties_json, '$.state') IN ('completed', 'cancelled', 'failed')) DESC,
            json_extract(properties_json, '$.elapsed_ms') DESC,
            (json_extract(properties_json, '$.state') = 'interrupted') DESC, occurred_at DESC, id DESC
        ) AS ordinal
      FROM product_analytics_events
      WHERE event_name = 'workflow_operation'
        AND julianday(received_at) >= julianday('now', '-7 days')
        AND json_extract(properties_json, '$.operation_id') IS NOT NULL
    ) SELECT operation, stage,
      CASE WHEN state IN ('completed', 'cancelled', 'failed') THEN state ELSE 'incomplete' END AS outcome,
      signal, failureCode, app_version AS appVersion, COUNT(*) AS operations,
      COUNT(DISTINCT session_id) AS sessions, ROUND(AVG(elapsed)) AS averageElapsedMs
      FROM ranked WHERE ordinal = 1
      GROUP BY operation, stage, outcome, signal, failureCode, app_version
      ORDER BY operations DESC, operation, stage, outcome, signal, failureCode, app_version LIMIT 51`).all<OperationGroup>();
    return { available: true, groups: rows.results.slice(0, 50), groupsTruncated: rows.results.length > 50 };
  } catch {
    return { available: false, groups: [], groupsTruncated: false };
  }
}
