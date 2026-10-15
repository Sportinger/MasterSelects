import type { AppD1Database } from './env';

export interface ProductFunnelStep {
  step: string;
  count: number;
  conversionFromStart: number;
  dropoffFromPrevious: number;
}

// Acquisition and activation have different entry points. A direct editor visit
// must not require landing-page telemetry. Use occurrence time: events delivered
// in the same batch share received_at, but may have happened in the wrong order.
export async function loadProductFunnels(db: AppD1Database): Promise<{
  editor: ProductFunnelStep[];
  landing: ProductFunnelStep[];
}> {
  const row = await db.prepare(`WITH base AS (
    SELECT COALESCE('user:' || user_id, 'session:' || session_id) AS identity,
           event_name, julianday(occurred_at) AS at
    FROM product_analytics_events
    WHERE julianday(received_at) >= julianday('now', '-30 days')
  ), landing AS (
    SELECT identity, MIN(at) AS at FROM base WHERE event_name = 'landing_viewed' GROUP BY identity
  ), selected AS (
    SELECT base.identity, MIN(base.at) AS at FROM base
    JOIN landing ON landing.identity = base.identity AND base.at >= landing.at
    WHERE event_name = 'landing_option_selected' GROUP BY base.identity
  ), app AS (
    SELECT identity, MIN(at) AS at FROM base WHERE event_name = 'app_opened' GROUP BY identity
  ), imported AS (
    SELECT base.identity, MIN(base.at) AS at FROM base
    JOIN app ON app.identity = base.identity AND base.at >= app.at
    WHERE event_name = 'media_import_completed' GROUP BY base.identity
  ), edited AS (
    SELECT base.identity, MIN(base.at) AS at FROM base
    JOIN imported ON imported.identity = base.identity AND base.at >= imported.at
    WHERE event_name = 'timeline_edit_committed' GROUP BY base.identity
  ), started AS (
    SELECT base.identity, MIN(base.at) AS at FROM base
    JOIN edited ON edited.identity = base.identity AND base.at >= edited.at
    WHERE event_name = 'export_started' GROUP BY base.identity
  ), completed AS (
    SELECT base.identity, MIN(base.at) AS at FROM base
    JOIN started ON started.identity = base.identity AND base.at >= started.at
    WHERE event_name = 'export_completed' GROUP BY base.identity
  ) SELECT
    (SELECT COUNT(*) FROM landing) AS landing_viewed,
    (SELECT COUNT(*) FROM selected) AS landing_option_selected,
    (SELECT COUNT(*) FROM app) AS app_opened,
    (SELECT COUNT(*) FROM imported) AS media_import_completed,
    (SELECT COUNT(*) FROM edited) AS timeline_edit_committed,
    (SELECT COUNT(*) FROM started) AS export_started,
    (SELECT COUNT(*) FROM completed) AS export_completed`).first<Record<string, number>>();

  function steps(names: string[]): ProductFunnelStep[] {
    const start = Number(row?.[names[0]] ?? 0);
    return names.map((step, index) => {
      const count = Number(row?.[step] ?? 0);
      const previous = index === 0 ? count : Number(row?.[names[index - 1]] ?? 0);
      return {
        step, count,
        conversionFromStart: start > 0 ? count / start : 0,
        dropoffFromPrevious: previous > 0 ? Math.max(0, 1 - count / previous) : 0,
      };
    });
  }
  return {
    editor: steps(['app_opened', 'media_import_completed', 'timeline_edit_committed', 'export_started', 'export_completed']),
    landing: steps(['landing_viewed', 'landing_option_selected']),
  };
}
