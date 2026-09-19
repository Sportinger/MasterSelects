import { productFailureDiagnosticTrafficSql } from './diagnosticTraffic';
import type { AppD1Database } from './env';

export interface DiagnosticBuildComparison {
  available: boolean;
  builds: Array<{ id: string; firstSeen: string; lastSeen: string; appSessions: number; errorSessions: number }>;
  errors: Array<{
    fingerprint: string; message: string | null; component: string | null;
    currentSessions: number; previousSessions: number;
    currentOccurrences: number; previousOccurrences: number;
  }>;
  legacyEvents: number;
}

const buildExpression = "json_extract(context_json, '$.context.buildId')";
const buildPattern = '????-??-??T??:??:??.???Z';

export async function loadDiagnosticBuildComparison(db: AppD1Database): Promise<DiagnosticBuildComparison> {
  try {
    const [builds, legacy] = await Promise.all([
      db.prepare(`WITH observations AS (
        SELECT json_extract(properties_json, '$.build_id') AS build_id,
               received_at, session_id AS app_session, NULL AS error_session
        FROM product_analytics_events
        WHERE event_name = 'app_opened' AND received_at >= ?
        UNION ALL
        SELECT ${buildExpression} AS build_id, received_at, NULL, session_id
        FROM app_diagnostic_events WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ?
      ) SELECT build_id AS id, MIN(received_at) AS firstSeen, MAX(received_at) AS lastSeen,
          COUNT(DISTINCT app_session) AS appSessions, COUNT(DISTINCT error_session) AS errorSessions
        FROM observations WHERE build_id GLOB ?
        GROUP BY build_id ORDER BY build_id DESC LIMIT 2`)
        .bind(since30d(), since30d(), buildPattern).all<DiagnosticBuildComparison['builds'][number]>(),
      db.prepare(`SELECT COUNT(*) AS count FROM app_diagnostic_events
        WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ?
          AND (${buildExpression} IS NULL OR ${buildExpression} NOT GLOB ?)`)
        .bind(since30d(), buildPattern).first<{ count: number }>(),
    ]);
    const result: DiagnosticBuildComparison = {
      available: true, builds: builds.results, errors: [], legacyEvents: Number(legacy?.count ?? 0),
    };
    if (builds.results.length < 2) return result;
    const current = builds.results[0].id;
    const previous = builds.results[1].id;
    const errors = await db.prepare(`WITH failures AS (
      SELECT fingerprint, message, component, session_id, COALESCE(repeat_count, 1) AS occurrences,
             ${buildExpression} AS build_id
      FROM app_diagnostic_events
      WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ? AND fingerprint IS NOT NULL
        AND ${buildExpression} IN (?, ?)
    ) SELECT fingerprint, MAX(message) AS message, MAX(component) AS component,
      COUNT(DISTINCT CASE WHEN build_id = ? THEN session_id END) AS currentSessions,
      COUNT(DISTINCT CASE WHEN build_id = ? THEN session_id END) AS previousSessions,
      SUM(CASE WHEN build_id = ? THEN occurrences ELSE 0 END) AS currentOccurrences,
      SUM(CASE WHEN build_id = ? THEN occurrences ELSE 0 END) AS previousOccurrences
    FROM failures GROUP BY fingerprint
    ORDER BY currentSessions DESC, previousSessions DESC, currentOccurrences DESC LIMIT 50`)
      .bind(since30d(), current, previous, current, previous, current, previous)
      .all<DiagnosticBuildComparison['errors'][number]>();
    result.errors = errors.results.map(row => ({ ...row, message: row.message?.slice(0, 600) ?? null }));
    return result;
  } catch {
    return { available: false, builds: [], errors: [], legacyEvents: 0 };
  }
}

function since30d(): string { return new Date(Date.now() - 30 * 86_400_000).toISOString(); }
