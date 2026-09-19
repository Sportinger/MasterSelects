import type { AppD1Database } from './env';
import { loadExportRunAnalytics, type ExportRunAnalytics } from './exportRunAnalytics';

interface SummaryRow {
  app_opens_7d: number;
  events_7d: number;
  export_completed_7d: number;
  export_failed_7d: number;
  export_started_7d: number;
  identities_7d: number;
  sessions_7d: number;
  signed_users_7d: number;
  tutorial_completed_7d: number;
}
interface CountRow {
  count: number;
  value: string;
}

interface DailyRow {
  count: number;
  day: string;
}

interface FunnelRow {
  count: number;
  step: string;
}

interface FunnelSummaryRow {
  app_opened: number;
  export_completed: number;
  export_started: number;
  landing_option_selected: number;
  landing_viewed: number;
  media_import_completed: number;
  timeline_edit_committed: number;
}

interface TutorialRow {
  completed: number;
  started: number;
  tutorial_id: string;
}

interface FeatureEngagementRow {
  feature: string;
  interactions: number;
  interactors: number;
  viewers: number;
  views: number;
}

interface ActivityRow {
  display_name: string | null;
  email: string | null;
  event_name: string;
  properties_json: string;
  received_at: string;
  session_id: string;
  user_id: string | null;
}

interface SessionRow {
  app_opened: number;
  device: string | null;
  display_name: string | null;
  edit_count: number;
  email: string | null;
  event_count: number;
  experience: string | null;
  export_completed: number;
  export_started: number;
  first_seen: string;
  import_completed: number;
  last_seen: string;
  platform: string | null;
  playback_started: number;
  session_id: string;
  tutorial_completed: number;
  user_id: string | null;
}

type ActivityProperty = boolean | number | string;

export interface ProductAnalyticsActivityEntry {
  accountEmail: string | null;
  actorLabel: string;
  actorType: 'account' | 'anonymous';
  eventName: string;
  occurredAt: string;
  properties: Record<string, ActivityProperty>;
  sessionKey: string;
}

export interface ProductAnalyticsSessionEntry {
  accountEmail: string | null;
  actorLabel: string;
  actorType: 'account' | 'anonymous';
  appOpened: boolean;
  device: string | null;
  editCount: number;
  eventCount: number;
  experience: string | null;
  exportCompleted: boolean;
  exportStarted: boolean;
  firstSeen: string;
  importCompleted: boolean;
  lastSeen: string;
  observedSeconds: number;
  platform: string | null;
  playbackStarted: boolean;
  sessionKey: string;
  tutorialCompleted: boolean;
}

export interface ProductAnalyticsAdminSnapshot {
  available: boolean;
  exportRuns7d?: ExportRunAnalytics;
  breakdowns: {
    acquisitionCampaigns: Array<{ count: number; value: string }>;
    acquisitionContent: Array<{ count: number; value: string }>;
    acquisitionSources: Array<{ count: number; value: string }>;
    controls: Array<{ count: number; value: string }>;
    editActions: Array<{ count: number; value: string }>;
    editOperations: Array<{ count: number; value: string }>;
    effectItems: Array<{ count: number; value: string }>;
    exportKinds: Array<{ count: number; value: string }>;
    failureCodes: Array<{ count: number; value: string }>;
    failureStages: Array<{ count: number; value: string }>;
    panels: Array<{ count: number; value: string }>;
    surfaces: Array<{ count: number; value: string }>;
    tutorials: Array<{ completed: number; started: number; tutorialId: string }>;
  };
  dailyActive14d: Array<{ count: number; day: string }>;
  featureEngagement7d: Array<{
    feature: string;
    interactionRate: number;
    interactions: number;
    interactors: number;
    viewers: number;
    views: number;
  }>;
  funnel30d: Array<{
    conversionFromStart: number;
    count: number;
    dropoffFromPrevious: number;
    step: string;
  }>;
  stats: {
    activeIdentities7d: number;
    appOpens7d: number;
    averageEventsPerSession7d: number;
    events7d: number;
    exportSuccessRate7d: number;
    exportsCompleted7d: number;
    exportsFailed7d: number;
    exportsStarted7d: number;
    returningIdentities30d: number;
    sessions7d: number;
    signedUsers7d: number;
    tutorialCompletions7d: number;
  };
  recentActivity: ProductAnalyticsActivityEntry[];
  recentSessions: ProductAnalyticsSessionEntry[];
  topEvents7d: Array<{ count: number; value: string }>;
}

const EMPTY_PRODUCT_ANALYTICS: ProductAnalyticsAdminSnapshot = {
  available: false,
  breakdowns: {
    acquisitionCampaigns: [],
    acquisitionContent: [],
    acquisitionSources: [],
    controls: [],
    editActions: [],
    editOperations: [],
    effectItems: [],
    exportKinds: [],
    failureCodes: [],
    failureStages: [],
    panels: [],
    surfaces: [],
    tutorials: [],
  },
  dailyActive14d: [],
  featureEngagement7d: [],
  funnel30d: [],
  recentActivity: [],
  recentSessions: [],
  stats: {
    activeIdentities7d: 0,
    appOpens7d: 0,
    averageEventsPerSession7d: 0,
    events7d: 0,
    exportSuccessRate7d: 0,
    exportsCompleted7d: 0,
    exportsFailed7d: 0,
    exportsStarted7d: 0,
    returningIdentities30d: 0,
    sessions7d: 0,
    signedUsers7d: 0,
    tutorialCompletions7d: 0,
  },
  topEvents7d: [],
};

const identitySql = "COALESCE('user:' || user_id, 'session:' || session_id)";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countRows(rows: CountRow[]): Array<{ count: number; value: string }> {
  return rows.map((row) => ({ count: numberValue(row.count), value: row.value }));
}

function sessionKey(sessionId: string): string {
  return sessionId.replace(/^session:/, '').replaceAll('-', '').slice(-8) || 'unknown';
}

function actorIdentity(row: {
  display_name: string | null;
  email: string | null;
  session_id: string;
  user_id: string | null;
}) {
  if (row.user_id && row.email) {
    return {
      accountEmail: row.email,
      actorLabel: row.display_name?.trim() || row.email,
      actorType: 'account' as const,
    };
  }
  const key = sessionKey(row.session_id);
  return {
    accountEmail: null,
    actorLabel: `Anonymous ${key}`,
    actorType: 'anonymous' as const,
  };
}

function parseActivityProperties(value: string): Record<string, ActivityProperty> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ActivityProperty] => {
      const property = entry[1];
      return typeof property === 'boolean' || typeof property === 'number' || typeof property === 'string';
    }));
  } catch {
    return {};
  }
}

async function loadDimension(
  db: AppD1Database,
  eventNames: readonly string[],
  property: string,
): Promise<CountRow[]> {
  const placeholders = eventNames.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT COALESCE(json_extract(properties_json, ?), 'unknown') AS value, COUNT(*) AS count
     FROM product_analytics_events
     WHERE event_name IN (${placeholders})
       AND julianday(received_at) >= julianday('now', '-7 days')
     GROUP BY value
     ORDER BY count DESC, value ASC
     LIMIT 8`
  )
    .bind(`$.${property}`, ...eventNames)
    .all<CountRow>();
  return result.results ?? [];
}

async function loadAttributedDimension(
  db: AppD1Database,
  property: 'acquisition_campaign' | 'acquisition_content' | 'acquisition_source',
): Promise<CountRow[]> {
  const result = await db.prepare(
    `SELECT json_extract(properties_json, ?) AS value, COUNT(*) AS count
     FROM product_analytics_events
     WHERE event_name = 'app_opened'
       AND json_extract(properties_json, ?) IS NOT NULL
       AND julianday(received_at) >= julianday('now', '-30 days')
     GROUP BY value
     ORDER BY count DESC, value ASC
     LIMIT 12`
  )
    .bind(`$.${property}`, `$.${property}`)
    .all<CountRow>();
  return result.results ?? [];
}

const FAILED_PRODUCT_EVENTS = [
  'checkout_failed',
  'export_failed',
  'media_import_failed',
  'project_action_failed',
] as const;

export async function getProductAnalyticsAdminSnapshot(
  db: AppD1Database,
): Promise<ProductAnalyticsAdminSnapshot> {
  try {
    const [
      summary,
      returning,
      topEvents,
      dailyActive,
      funnel,
      panels,
      controls,
      effectItems,
      surfaces,
      editActions,
      edits,
      exportKinds,
      failureCodes,
      failureStages,
      tutorials,
      recentActivity,
      recentSessions,
      featureEngagement,
      acquisitionSources,
      acquisitionCampaigns,
      acquisitionContent,
      exportRuns7d,
    ] = await Promise.all([
      db.prepare(
        `SELECT
           COUNT(*) AS events_7d,
           COUNT(DISTINCT session_id) AS sessions_7d,
           COUNT(DISTINCT ${identitySql}) AS identities_7d,
           COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS signed_users_7d,
           SUM(CASE WHEN event_name = 'app_opened' THEN 1 ELSE 0 END) AS app_opens_7d,
           SUM(CASE WHEN event_name = 'export_started' THEN 1 ELSE 0 END) AS export_started_7d,
           SUM(CASE WHEN event_name = 'export_completed' THEN 1 ELSE 0 END) AS export_completed_7d,
           SUM(CASE WHEN event_name = 'export_failed' THEN 1 ELSE 0 END) AS export_failed_7d,
           SUM(CASE WHEN event_name = 'tutorial_completed' THEN 1 ELSE 0 END) AS tutorial_completed_7d
         FROM product_analytics_events
         WHERE julianday(received_at) >= julianday('now', '-7 days')`
      ).first<SummaryRow>(),
      db.prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT ${identitySql} AS identity
           FROM product_analytics_events
           WHERE julianday(received_at) >= julianday('now', '-30 days')
           GROUP BY identity
           HAVING COUNT(DISTINCT substr(received_at, 1, 10)) >= 2
         )`
      ).first<{ count: number }>(),
      db.prepare(
        `SELECT event_name AS value, COUNT(*) AS count
         FROM product_analytics_events
         WHERE julianday(received_at) >= julianday('now', '-7 days')
         GROUP BY event_name
         ORDER BY count DESC, event_name ASC
         LIMIT 12`
      ).all<CountRow>(),
      db.prepare(
        `SELECT substr(received_at, 1, 10) AS day,
                COUNT(DISTINCT ${identitySql}) AS count
         FROM product_analytics_events
         WHERE julianday(received_at) >= julianday('now', '-14 days')
         GROUP BY day
         ORDER BY day ASC`
      ).all<DailyRow>(),
      db.prepare(
        `WITH base AS (
           SELECT ${identitySql} AS identity, event_name, received_at
           FROM product_analytics_events
           WHERE julianday(received_at) >= julianday('now', '-30 days')
         ),
         landing AS (
           SELECT identity, MIN(received_at) AS at FROM base
           WHERE event_name = 'landing_viewed' GROUP BY identity
         ),
         selected AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN landing ON landing.identity = base.identity AND base.received_at >= landing.at
           WHERE base.event_name = 'landing_option_selected' GROUP BY base.identity
         ),
         app AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN selected ON selected.identity = base.identity AND base.received_at >= selected.at
           WHERE base.event_name = 'app_opened' GROUP BY base.identity
         ),
         imported AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN app ON app.identity = base.identity AND base.received_at >= app.at
           WHERE base.event_name = 'media_import_completed' GROUP BY base.identity
         ),
         edited AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN imported ON imported.identity = base.identity AND base.received_at >= imported.at
           WHERE base.event_name = 'timeline_edit_committed' GROUP BY base.identity
         ),
         export_started AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN edited ON edited.identity = base.identity AND base.received_at >= edited.at
           WHERE base.event_name = 'export_started' GROUP BY base.identity
         ),
         export_completed AS (
           SELECT base.identity, MIN(base.received_at) AS at FROM base
           JOIN export_started ON export_started.identity = base.identity
             AND base.received_at >= export_started.at
           WHERE base.event_name = 'export_completed' GROUP BY base.identity
         )
         SELECT
           (SELECT COUNT(*) FROM landing) AS landing_viewed,
           (SELECT COUNT(*) FROM selected) AS landing_option_selected,
           (SELECT COUNT(*) FROM app) AS app_opened,
           (SELECT COUNT(*) FROM imported) AS media_import_completed,
           (SELECT COUNT(*) FROM edited) AS timeline_edit_committed,
           (SELECT COUNT(*) FROM export_started) AS export_started,
           (SELECT COUNT(*) FROM export_completed) AS export_completed`
      ).first<FunnelSummaryRow>(),
      loadDimension(db, ['panel_opened'], 'panel'),
      loadDimension(db, ['editor_control_committed'], 'control_id'),
      loadDimension(db, ['editor_control_committed'], 'item_id'),
      loadDimension(db, ['editor_surface_viewed'], 'surface'),
      loadDimension(db, ['timeline_edit_committed'], 'action'),
      loadDimension(db, ['timeline_edit_committed'], 'operation'),
      loadDimension(db, ['export_completed'], 'kind'),
      loadDimension(db, FAILED_PRODUCT_EVENTS, 'failure_code'),
      loadDimension(db, FAILED_PRODUCT_EVENTS, 'failure_stage'),
      db.prepare(
        `SELECT COALESCE(json_extract(properties_json, '$.tutorial_id'), 'unknown') AS tutorial_id,
                SUM(CASE WHEN event_name = 'tutorial_started' THEN 1 ELSE 0 END) AS started,
                SUM(CASE WHEN event_name = 'tutorial_completed' THEN 1 ELSE 0 END) AS completed
         FROM product_analytics_events
         WHERE event_name IN ('tutorial_started', 'tutorial_completed')
           AND julianday(received_at) >= julianday('now', '-30 days')
         GROUP BY tutorial_id
         ORDER BY started DESC, tutorial_id ASC
         LIMIT 10`
      ).all<TutorialRow>(),
      db.prepare(
        `SELECT
           e.event_name,
           e.received_at,
           e.session_id,
           e.user_id,
           e.properties_json,
           u.email,
           u.display_name
         FROM product_analytics_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE julianday(e.received_at) >= julianday('now', '-7 days')
         ORDER BY e.received_at DESC
         LIMIT 100`
      ).all<ActivityRow>(),
      db.prepare(
        `WITH session_rollup AS (
           SELECT
             session_id,
             MAX(user_id) AS user_id,
             MIN(received_at) AS first_seen,
             MAX(received_at) AS last_seen,
             COUNT(*) AS event_count,
             SUM(CASE WHEN event_name = 'timeline_edit_committed' THEN 1 ELSE 0 END) AS edit_count,
             MAX(CASE WHEN event_name = 'app_opened' THEN 1 ELSE 0 END) AS app_opened,
             MAX(CASE WHEN event_name = 'media_import_completed' THEN 1 ELSE 0 END) AS import_completed,
             MAX(CASE WHEN event_name = 'playback_started' THEN 1 ELSE 0 END) AS playback_started,
             MAX(CASE WHEN event_name = 'tutorial_completed' THEN 1 ELSE 0 END) AS tutorial_completed,
             MAX(CASE WHEN event_name = 'export_started' THEN 1 ELSE 0 END) AS export_started,
             MAX(CASE WHEN event_name = 'export_completed' THEN 1 ELSE 0 END) AS export_completed,
             MAX(CASE WHEN event_name = 'app_opened' THEN json_extract(properties_json, '$.device_class') END) AS device,
             MAX(CASE WHEN event_name = 'app_opened' THEN json_extract(properties_json, '$.platform') END) AS platform,
             MAX(CASE WHEN event_name = 'app_opened' THEN json_extract(properties_json, '$.experience') END) AS experience
           FROM product_analytics_events
           WHERE julianday(received_at) >= julianday('now', '-30 days')
           GROUP BY session_id
         )
         SELECT session_rollup.*, users.email, users.display_name
         FROM session_rollup
         LEFT JOIN users ON users.id = session_rollup.user_id
         ORDER BY last_seen DESC
         LIMIT 30`
      ).all<SessionRow>(),
      db.prepare(
        `WITH engagement AS (
           SELECT
             json_extract(properties_json, '$.surface') AS feature,
             ${identitySql} AS identity,
             1 AS viewed,
             0 AS interacted
           FROM product_analytics_events
           WHERE event_name = 'editor_surface_viewed'
             AND julianday(received_at) >= julianday('now', '-7 days')
           UNION ALL
           SELECT
             CASE json_extract(properties_json, '$.area')
               WHEN 'effect' THEN 'effects'
               WHEN 'mask' THEN 'masks'
               ELSE json_extract(properties_json, '$.area')
             END AS feature,
             ${identitySql} AS identity,
             0 AS viewed,
             1 AS interacted
           FROM product_analytics_events
           WHERE event_name = 'editor_control_committed'
             AND julianday(received_at) >= julianday('now', '-7 days')
         )
         SELECT
           feature,
           SUM(viewed) AS views,
           SUM(interacted) AS interactions,
           COUNT(DISTINCT CASE WHEN viewed = 1 THEN identity END) AS viewers,
           COUNT(DISTINCT CASE WHEN interacted = 1 THEN identity END) AS interactors
         FROM engagement
         WHERE feature IS NOT NULL
         GROUP BY feature
         ORDER BY interactors DESC, viewers DESC, feature ASC
         LIMIT 20`
      ).all<FeatureEngagementRow>(),
      loadAttributedDimension(db, 'acquisition_source'),
      loadAttributedDimension(db, 'acquisition_campaign'),
      loadAttributedDimension(db, 'acquisition_content'),
      loadExportRunAnalytics(db),
    ]);

    const events7d = numberValue(summary?.events_7d);
    const sessions7d = numberValue(summary?.sessions_7d);
    const exportsStarted7d = numberValue(summary?.export_started_7d);
    const exportsCompleted7d = numberValue(summary?.export_completed_7d);
    const funnelRows: FunnelRow[] = [
      { count: numberValue(funnel?.landing_viewed), step: 'landing_viewed' },
      { count: numberValue(funnel?.landing_option_selected), step: 'landing_option_selected' },
      { count: numberValue(funnel?.app_opened), step: 'app_opened' },
      { count: numberValue(funnel?.media_import_completed), step: 'media_import_completed' },
      { count: numberValue(funnel?.timeline_edit_committed), step: 'timeline_edit_committed' },
      { count: numberValue(funnel?.export_started), step: 'export_started' },
      { count: numberValue(funnel?.export_completed), step: 'export_completed' },
    ];
    const funnelStart = numberValue(funnelRows[0]?.count);

    return {
      available: true,
      exportRuns7d,
      breakdowns: {
        acquisitionCampaigns: countRows(acquisitionCampaigns),
        acquisitionContent: countRows(acquisitionContent),
        acquisitionSources: countRows(acquisitionSources),
        controls: countRows(controls),
        editActions: countRows(editActions),
        editOperations: countRows(edits),
        effectItems: countRows(effectItems),
        exportKinds: countRows(exportKinds),
        failureCodes: countRows(failureCodes),
        failureStages: countRows(failureStages),
        panels: countRows(panels),
        surfaces: countRows(surfaces),
        tutorials: (tutorials.results ?? []).map((row) => ({
          completed: numberValue(row.completed),
          started: numberValue(row.started),
          tutorialId: row.tutorial_id,
        })),
      },
      dailyActive14d: (dailyActive.results ?? []).map((row) => ({
        count: numberValue(row.count),
        day: row.day,
      })),
      featureEngagement7d: (featureEngagement.results ?? []).map((row) => {
        const viewers = numberValue(row.viewers);
        const interactors = numberValue(row.interactors);
        return {
          feature: row.feature,
          interactionRate: viewers > 0 ? Math.min(1, interactors / viewers) : 0,
          interactions: numberValue(row.interactions),
          interactors,
          viewers,
          views: numberValue(row.views),
        };
      }),
      funnel30d: funnelRows.map((row, index) => {
        const count = numberValue(row.count);
        const previous = index === 0 ? count : numberValue(funnelRows[index - 1]?.count);
        return {
          conversionFromStart: funnelStart > 0 ? count / funnelStart : 0,
          count,
          dropoffFromPrevious: previous > 0 ? Math.max(0, 1 - count / previous) : 0,
          step: row.step,
        };
      }),
      stats: {
        activeIdentities7d: numberValue(summary?.identities_7d),
        appOpens7d: numberValue(summary?.app_opens_7d),
        averageEventsPerSession7d: sessions7d > 0 ? events7d / sessions7d : 0,
        events7d,
        exportSuccessRate7d: exportsStarted7d > 0 ? exportsCompleted7d / exportsStarted7d : 0,
        exportsCompleted7d,
        exportsFailed7d: numberValue(summary?.export_failed_7d),
        exportsStarted7d,
        returningIdentities30d: numberValue(returning?.count),
        sessions7d,
        signedUsers7d: numberValue(summary?.signed_users_7d),
        tutorialCompletions7d: numberValue(summary?.tutorial_completed_7d),
      },
      recentActivity: (recentActivity.results ?? []).map((row) => ({
        ...actorIdentity(row),
        eventName: row.event_name,
        occurredAt: row.received_at,
        properties: parseActivityProperties(row.properties_json),
        sessionKey: sessionKey(row.session_id),
      })),
      recentSessions: (recentSessions.results ?? []).map((row) => ({
        ...actorIdentity(row),
        appOpened: numberValue(row.app_opened) > 0,
        device: row.device,
        editCount: numberValue(row.edit_count),
        eventCount: numberValue(row.event_count),
        experience: row.experience,
        exportCompleted: numberValue(row.export_completed) > 0,
        exportStarted: numberValue(row.export_started) > 0,
        firstSeen: row.first_seen,
        importCompleted: numberValue(row.import_completed) > 0,
        lastSeen: row.last_seen,
        observedSeconds: Math.max(0, (Date.parse(row.last_seen) - Date.parse(row.first_seen)) / 1_000),
        platform: row.platform,
        playbackStarted: numberValue(row.playback_started) > 0,
        sessionKey: sessionKey(row.session_id),
        tutorialCompleted: numberValue(row.tutorial_completed) > 0,
      })),
      topEvents7d: countRows(topEvents.results ?? []),
    };
  } catch {
    return EMPTY_PRODUCT_ANALYTICS;
  }
}
