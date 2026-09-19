import { automatedDiagnosticTrafficSql, productFailureDiagnosticTrafficSql } from './diagnosticTraffic';
import type { AppD1Database } from './env';
import { loadDiagnosticBuildComparison, type DiagnosticBuildComparison } from './diagnosticBuildComparison';

interface CountRow {
  count: number;
  value: string;
}

interface AiSummaryRow {
  accepted_7d: number;
  blocked_7d: number;
  submission_failed_7d: number;
}

interface LifecycleSummaryRow {
  download_failed_7d: number;
  import_failed_7d: number;
  import_succeeded_7d: number;
  provider_failed_7d: number;
  provider_succeeded_7d: number;
}

interface KernelSummaryRow {
  active_30d: number;
  avg_duration_ms_30d: number;
  cancelled_30d: number;
  completed_30d: number;
  provider_failed_30d: number;
  stale_active: number;
  total_30d: number;
}

interface RuntimeSummaryRow {
  affected_users_7d: number;
  anonymous_events_7d: number;
  devices_7d: number;
  events_24h: number;
  events_7d: number;
  occurrences_7d: number;
  sessions_7d: number;
}

interface AiDailyRow {
  day: string;
  failed: number;
  tasks: number;
}

interface RuntimeDailyRow {
  day: string;
  events: number;
  sessions: number;
}

interface KernelDailyRow {
  cancelled: number;
  completed: number;
  day: string;
  provider_failed: number;
  total: number;
}

interface RecentErrorRow {
  app_version: string | null;
  browser: string;
  component: string | null;
  context_json: string | null;
  country: string | null;
  device_class: string;
  error_name: string | null;
  failure_code: string | null;
  fingerprint: string | null;
  id: string;
  message: string | null;
  occurred_at: string;
  page_path: string | null;
  platform: string;
  received_at: string;
  repeat_count: number;
  session_id: string | null;
  stack: string | null;
  stage: string;
  user_id: string | null;
}

interface TopErrorRow {
  component: string | null;
  error_name: string | null;
  events: number;
  failure_code: string | null;
  fingerprint: string;
  first_seen: string;
  last_seen: string;
  message: string | null;
  occurrences: number;
  platforms: string | null;
  sessions: number;
  stage: string;
  users: number;
}

export interface DiagnosticBreadcrumb {
  level: string;
  message: string;
  source: string;
  t: string;
}

export interface DiagnosticRecentError {
  appVersion: string | null;
  breadcrumbs: DiagnosticBreadcrumb[];
  browser: string;
  component: string | null;
  context: Record<string, unknown> | null;
  country: string | null;
  deviceClass: string;
  errorName: string | null;
  failureCode: string | null;
  fingerprint: string | null;
  id: string;
  message: string | null;
  occurredAt: string;
  pagePath: string | null;
  platform: string;
  receivedAt: string;
  repeatCount: number;
  sessionId: string | null;
  signedIn: boolean;
  stack: string | null;
  stage: string;
}

export interface DiagnosticTopError {
  component: string | null;
  errorName: string | null;
  events: number;
  failureCode: string | null;
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
  message: string | null;
  occurrences: number;
  platforms: string[];
  sessions: number;
  stage: string;
  users: number;
}

export interface DiagnosticsAdminSnapshot {
  aiGeneration: {
    available: boolean;
    breakdowns: {
      failureCodes: CountRow[];
      failureStages: CountRow[];
      models: CountRow[];
      platforms: CountRow[];
      providers: CountRow[];
    };
    daily14d: Array<{ day: string; failed: number; tasks: number }>;
    stats: {
      accepted7d: number;
      blocked7d: number;
      downloadFailed7d: number;
      importFailed7d: number;
      importSucceeded7d: number;
      providerFailed7d: number;
      providerSucceeded7d: number;
      submissionFailed7d: number;
    };
  };
  clientRuntime: {
    available: boolean;
    buildComparison?: DiagnosticBuildComparison;
    breakdowns: {
      browsers: CountRow[];
      builds: CountRow[];
      components: CountRow[];
      failureCodes: CountRow[];
      pages: CountRow[];
      platforms: CountRow[];
      sources: CountRow[];
    };
    daily14d: Array<{ day: string; events: number; sessions: number }>;
    recentErrors: DiagnosticRecentError[];
    stats: {
      excludedAutomatedEvents7d?: number;
      excludedAutomatedSessions7d?: number;
      affectedUsers7d: number;
      anonymousEvents7d: number;
      devices7d: number;
      events24h: number;
      events7d: number;
      occurrences7d: number;
      sessions7d: number;
    };
    topErrors7d: DiagnosticTopError[];
  };
  kernel: {
    available: boolean;
    breakdowns: {
      executionProfiles: CountRow[];
      models: CountRow[];
      modes: CountRow[];
      statuses: CountRow[];
    };
    daily14d: Array<{
      cancelled: number;
      completed: number;
      day: string;
      providerFailed: number;
      total: number;
    }>;
    stats: {
      active30d: number;
      averageDurationMs30d: number;
      cancelled30d: number;
      completed30d: number;
      providerFailed30d: number;
      staleActive: number;
      total30d: number;
    };
  };
}

const RECENT_ERROR_LIMIT = 30;
const TOP_ERROR_LIMIT = 50;
const RECENT_MESSAGE_LENGTH = 600;
const RECENT_STACK_LENGTH = 1_500;
const RECENT_BREADCRUMBS = 12;
const RECENT_BREADCRUMB_LENGTH = 160;

const EMPTY: DiagnosticsAdminSnapshot = {
  aiGeneration: {
    available: false,
    breakdowns: { failureCodes: [], failureStages: [], models: [], platforms: [], providers: [] },
    daily14d: [],
    stats: {
      accepted7d: 0,
      blocked7d: 0,
      downloadFailed7d: 0,
      importFailed7d: 0,
      importSucceeded7d: 0,
      providerFailed7d: 0,
      providerSucceeded7d: 0,
      submissionFailed7d: 0,
    },
  },
  clientRuntime: {
    available: false,
    breakdowns: { browsers: [], builds: [], components: [], failureCodes: [], pages: [], platforms: [], sources: [] },
    daily14d: [],
    recentErrors: [],
    stats: {
      affectedUsers7d: 0,
      anonymousEvents7d: 0,
      devices7d: 0,
      events24h: 0,
      events7d: 0,
      occurrences7d: 0,
      sessions7d: 0,
    },
    topErrors7d: [],
  },
  kernel: {
    available: false,
    breakdowns: { executionProfiles: [], models: [], modes: [], statuses: [] },
    daily14d: [],
    stats: {
      active30d: 0,
      averageDurationMs30d: 0,
      cancelled30d: 0,
      completed30d: 0,
      providerFailed30d: 0,
      staleActive: 0,
      total30d: 0,
    },
  },
};

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function counts(rows: CountRow[]): CountRow[] {
  return rows.map((row) => ({ count: asNumber(row.count), value: row.value || 'unknown' }));
}

function clip(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/**
 * `received_at` is stored as an ISO string with a `T` separator, so the cutoff
 * must be an ISO string too. SQLite's `datetime('now')` uses a space and
 * compares one day too coarsely against ISO values.
 */
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseContext(contextJson: string | null): {
  breadcrumbs: DiagnosticBreadcrumb[];
  context: Record<string, unknown> | null;
} {
  if (!contextJson) return { breadcrumbs: [], context: null };
  try {
    const parsed = JSON.parse(contextJson) as { breadcrumbs?: unknown; context?: unknown };
    const breadcrumbs = Array.isArray(parsed.breadcrumbs)
      ? parsed.breadcrumbs
        .slice(-RECENT_BREADCRUMBS)
        .map((crumb) => {
          const record = (crumb ?? {}) as Record<string, unknown>;
          return {
            level: typeof record.level === 'string' ? record.level : 'INFO',
            message: clip(typeof record.message === 'string' ? record.message : '', RECENT_BREADCRUMB_LENGTH) ?? '',
            source: typeof record.source === 'string' ? record.source : 'console',
            t: typeof record.t === 'string' ? record.t : '',
          };
        })
      : [];
    const context = parsed.context && typeof parsed.context === 'object' && !Array.isArray(parsed.context)
      ? parsed.context as Record<string, unknown>
      : null;
    return { breadcrumbs, context };
  } catch {
    return { breadcrumbs: [], context: null };
  }
}

async function loadAiGeneration(db: AppD1Database): Promise<DiagnosticsAdminSnapshot['aiGeneration']> {
  const since7d = sinceIso(7);
  const since14d = sinceIso(14);
  const auditSummary = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_7d,
       SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_7d,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS submission_failed_7d
     FROM ai_audit_events
     WHERE created_at >= datetime('now', '-7 days')`,
  ).first<AiSummaryRow>();
  const [lifecycle, daily, failureCodes, failureStages, platforms, providers, models] = await Promise.all([
    db.prepare(
      `SELECT
         SUM(CASE WHEN stage = 'provider_result' AND outcome = 'succeeded' THEN 1 ELSE 0 END) AS provider_succeeded_7d,
         SUM(CASE WHEN stage = 'provider_result' AND outcome = 'failed' THEN 1 ELSE 0 END) AS provider_failed_7d,
         SUM(CASE WHEN stage = 'download' AND outcome = 'failed' THEN 1 ELSE 0 END) AS download_failed_7d,
         SUM(CASE WHEN stage = 'import' AND outcome = 'succeeded' THEN 1 ELSE 0 END) AS import_succeeded_7d,
         SUM(CASE WHEN stage = 'import' AND outcome = 'failed' THEN 1 ELSE 0 END) AS import_failed_7d
       FROM app_diagnostic_events
       WHERE kind = 'ai_generation' AND received_at >= ?`,
    ).bind(since7d).first<LifecycleSummaryRow>(),
    db.prepare(
      `SELECT substr(received_at, 1, 10) AS day,
              COUNT(DISTINCT provider_task_id) AS tasks,
              COUNT(DISTINCT CASE WHEN outcome = 'failed' THEN provider_task_id END) AS failed
       FROM app_diagnostic_events
       WHERE kind = 'ai_generation' AND received_at >= ?
       GROUP BY substr(received_at, 1, 10) ORDER BY day ASC`,
    ).bind(since14d).all<AiDailyRow>(),
    db.prepare(
      `SELECT COALESCE(failure_code, 'unknown') AS value, COUNT(*) AS count
       FROM app_diagnostic_events
       WHERE kind = 'ai_generation' AND outcome = 'failed' AND received_at >= ?
       GROUP BY failure_code ORDER BY count DESC LIMIT 10`,
    ).bind(since7d).all<CountRow>(),
    db.prepare(
      `SELECT stage AS value, COUNT(*) AS count FROM app_diagnostic_events
       WHERE kind = 'ai_generation' AND outcome = 'failed' AND received_at >= ?
       GROUP BY stage ORDER BY count DESC`,
    ).bind(since7d).all<CountRow>(),
    db.prepare(
      `SELECT platform AS value, COUNT(DISTINCT provider_task_id) AS count FROM app_diagnostic_events
       WHERE kind = 'ai_generation' AND received_at >= ?
       GROUP BY platform ORDER BY count DESC`,
    ).bind(since7d).all<CountRow>(),
    db.prepare(
      `SELECT provider AS value, COUNT(*) AS count FROM ai_audit_events
       WHERE status = 'accepted' AND created_at >= datetime('now', '-7 days')
       GROUP BY provider ORDER BY count DESC LIMIT 10`,
    ).all<CountRow>(),
    db.prepare(
      `SELECT COALESCE(model, 'unknown') AS value, COUNT(*) AS count FROM ai_audit_events
       WHERE status = 'accepted' AND created_at >= datetime('now', '-7 days')
       GROUP BY model ORDER BY count DESC LIMIT 10`,
    ).all<CountRow>(),
  ]);
  return {
    available: true,
    breakdowns: {
      failureCodes: counts(failureCodes.results),
      failureStages: counts(failureStages.results),
      models: counts(models.results),
      platforms: counts(platforms.results),
      providers: counts(providers.results),
    },
    daily14d: daily.results.map((row) => ({ day: row.day, failed: asNumber(row.failed), tasks: asNumber(row.tasks) })),
    stats: {
      accepted7d: asNumber(auditSummary?.accepted_7d),
      blocked7d: asNumber(auditSummary?.blocked_7d),
      downloadFailed7d: asNumber(lifecycle?.download_failed_7d),
      importFailed7d: asNumber(lifecycle?.import_failed_7d),
      importSucceeded7d: asNumber(lifecycle?.import_succeeded_7d),
      providerFailed7d: asNumber(lifecycle?.provider_failed_7d),
      providerSucceeded7d: asNumber(lifecycle?.provider_succeeded_7d),
      submissionFailed7d: asNumber(auditSummary?.submission_failed_7d),
    },
  };
}

function runtimeBreakdown(db: AppD1Database, since: string, expression: string, limit: number) {
  return db.prepare(
    `SELECT ${expression} AS value, COUNT(*) AS count FROM app_diagnostic_events
     WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ?
     GROUP BY value ORDER BY count DESC LIMIT ${limit}`,
  ).bind(since).all<CountRow>();
}

async function loadClientRuntime(db: AppD1Database): Promise<DiagnosticsAdminSnapshot['clientRuntime']> {
  const since24h = sinceIso(1);
  const since7d = sinceIso(7);
  const since14d = sinceIso(14);
  const [automated, summary, daily, sources, failureCodes, platforms, browsers, builds, components, pages, recent, top, buildComparison] =
    await Promise.all([
      db.prepare(`SELECT COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions
        FROM app_diagnostic_events WHERE kind = 'client_runtime' AND received_at >= ?
          AND ${automatedDiagnosticTrafficSql}`)
        .bind(since7d).first<{ events: number; sessions: number }>(),
      db.prepare(
        `SELECT COUNT(*) AS events_7d,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS events_24h,
                SUM(COALESCE(repeat_count, 1)) AS occurrences_7d,
                COUNT(DISTINCT user_id) AS affected_users_7d,
                SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS anonymous_events_7d,
                COUNT(DISTINCT session_id) AS sessions_7d,
                COUNT(DISTINCT device_id) AS devices_7d
         FROM app_diagnostic_events
         WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ?`,
      ).bind(since24h, since7d).first<RuntimeSummaryRow>(),
      db.prepare(
        `SELECT substr(received_at, 1, 10) AS day, COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions
         FROM app_diagnostic_events
         WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND received_at >= ?
         GROUP BY substr(received_at, 1, 10) ORDER BY day ASC`,
      ).bind(since14d).all<RuntimeDailyRow>(),
      runtimeBreakdown(db, since7d, 'stage', 12),
      runtimeBreakdown(db, since7d, "COALESCE(failure_code, 'unknown')", 12),
      runtimeBreakdown(db, since7d, 'platform', 10),
      runtimeBreakdown(db, since7d, 'browser', 10),
      runtimeBreakdown(db, since7d, "COALESCE(app_version, 'unknown')", 10),
      runtimeBreakdown(db, since7d, "COALESCE(component, 'unknown')", 12),
      runtimeBreakdown(db, since7d, "COALESCE(page_path, 'unknown')", 10),
      db.prepare(
        `SELECT id, stage, failure_code, component, error_name, message, stack, fingerprint,
                COALESCE(repeat_count, 1) AS repeat_count, page_path, session_id, user_id,
                platform, device_class, browser, app_version, country, occurred_at, received_at, context_json
         FROM app_diagnostic_events
         WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql}
         ORDER BY received_at DESC LIMIT ${RECENT_ERROR_LIMIT}`,
      ).all<RecentErrorRow>(),
      db.prepare(
        `SELECT fingerprint,
                COUNT(*) AS events,
                SUM(COALESCE(repeat_count, 1)) AS occurrences,
                COUNT(DISTINCT session_id) AS sessions,
                COUNT(DISTINCT user_id) AS users,
                MIN(received_at) AS first_seen,
                MAX(received_at) AS last_seen,
                MAX(stage) AS stage,
                MAX(failure_code) AS failure_code,
                MAX(component) AS component,
                MAX(error_name) AS error_name,
                MAX(message) AS message,
                GROUP_CONCAT(DISTINCT platform) AS platforms
         FROM app_diagnostic_events
         WHERE kind = 'client_runtime' AND ${productFailureDiagnosticTrafficSql} AND fingerprint IS NOT NULL AND received_at >= ?
         GROUP BY fingerprint ORDER BY sessions DESC, occurrences DESC, last_seen DESC LIMIT ${TOP_ERROR_LIMIT}`,
      ).bind(since7d).all<TopErrorRow>(),
      loadDiagnosticBuildComparison(db),
    ]);
  return {
    available: true,
    breakdowns: {
      browsers: counts(browsers.results),
      builds: counts(builds.results),
      components: counts(components.results),
      failureCodes: counts(failureCodes.results),
      pages: counts(pages.results),
      platforms: counts(platforms.results),
      sources: counts(sources.results),
    },
    daily14d: daily.results.map((row) => ({
      day: row.day,
      events: asNumber(row.events),
      sessions: asNumber(row.sessions),
    })),
    recentErrors: recent.results.map((row) => {
      const parsed = parseContext(row.context_json);
      return {
        appVersion: row.app_version,
        breadcrumbs: parsed.breadcrumbs,
        browser: row.browser,
        component: row.component,
        context: parsed.context,
        country: row.country,
        deviceClass: row.device_class,
        errorName: row.error_name,
        failureCode: row.failure_code,
        fingerprint: row.fingerprint,
        id: row.id,
        message: clip(row.message, RECENT_MESSAGE_LENGTH),
        occurredAt: row.occurred_at,
        pagePath: row.page_path,
        platform: row.platform,
        receivedAt: row.received_at,
        repeatCount: asNumber(row.repeat_count) || 1,
        sessionId: row.session_id,
        signedIn: row.user_id !== null,
        stack: clip(row.stack, RECENT_STACK_LENGTH),
        stage: row.stage,
      };
    }),
    buildComparison,
    stats: {
      excludedAutomatedEvents7d: asNumber(automated?.events),
      excludedAutomatedSessions7d: asNumber(automated?.sessions),
      affectedUsers7d: asNumber(summary?.affected_users_7d),
      anonymousEvents7d: asNumber(summary?.anonymous_events_7d),
      devices7d: asNumber(summary?.devices_7d),
      events24h: asNumber(summary?.events_24h),
      events7d: asNumber(summary?.events_7d),
      occurrences7d: asNumber(summary?.occurrences_7d),
      sessions7d: asNumber(summary?.sessions_7d),
    },
    topErrors7d: top.results.map((row) => ({
      component: row.component,
      errorName: row.error_name,
      events: asNumber(row.events),
      failureCode: row.failure_code,
      fingerprint: row.fingerprint,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      message: clip(row.message, RECENT_MESSAGE_LENGTH),
      occurrences: asNumber(row.occurrences),
      platforms: row.platforms ? row.platforms.split(',').filter(Boolean) : [],
      sessions: asNumber(row.sessions),
      stage: row.stage,
      users: asNumber(row.users),
    })),
  };
}

async function loadKernel(db: AppD1Database): Promise<DiagnosticsAdminSnapshot['kernel']> {
  const [summary, daily, statuses, models, modes, profiles] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total_30d,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_30d,
              SUM(CASE WHEN status = 'provider_failed' THEN 1 ELSE 0 END) AS provider_failed_30d,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_30d,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_30d,
              SUM(CASE WHEN status = 'active' AND updated_at < datetime('now', '-15 minutes') THEN 1 ELSE 0 END) AS stale_active,
              AVG(CASE WHEN completed_at IS NOT NULL
                  THEN (julianday(completed_at) - julianday(created_at)) * 86400000 END) AS avg_duration_ms_30d
       FROM hosted_agent_k0_turns WHERE created_at >= datetime('now', '-30 days')`,
    ).first<KernelSummaryRow>(),
    db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'provider_failed' THEN 1 ELSE 0 END) AS provider_failed,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM hosted_agent_k0_turns WHERE created_at >= datetime('now', '-14 days')
       GROUP BY substr(created_at, 1, 10) ORDER BY day ASC`,
    ).all<KernelDailyRow>(),
    db.prepare(
      `SELECT status AS value, COUNT(*) AS count FROM hosted_agent_k0_turns
       WHERE created_at >= datetime('now', '-30 days') GROUP BY status ORDER BY count DESC`,
    ).all<CountRow>(),
    db.prepare(
      `SELECT model AS value, COUNT(*) AS count FROM hosted_agent_k0_turns
       WHERE created_at >= datetime('now', '-30 days') GROUP BY model ORDER BY count DESC LIMIT 10`,
    ).all<CountRow>(),
    db.prepare(
      `SELECT tool_execution_mode AS value, COUNT(*) AS count FROM hosted_agent_k0_turns
       WHERE created_at >= datetime('now', '-30 days') GROUP BY tool_execution_mode ORDER BY count DESC`,
    ).all<CountRow>(),
    db.prepare(
      `SELECT b.execution_profile AS value, COUNT(*) AS count
       FROM hosted_agent_fast_v2_bindings b JOIN hosted_agent_k0_turns t ON t.turn_id = b.turn_id
       WHERE t.created_at >= datetime('now', '-30 days')
       GROUP BY b.execution_profile ORDER BY count DESC`,
    ).all<CountRow>(),
  ]);
  return {
    available: true,
    breakdowns: {
      executionProfiles: counts(profiles.results),
      models: counts(models.results),
      modes: counts(modes.results),
      statuses: counts(statuses.results),
    },
    daily14d: daily.results.map((row) => ({
      cancelled: asNumber(row.cancelled),
      completed: asNumber(row.completed),
      day: row.day,
      providerFailed: asNumber(row.provider_failed),
      total: asNumber(row.total),
    })),
    stats: {
      active30d: asNumber(summary?.active_30d),
      averageDurationMs30d: asNumber(summary?.avg_duration_ms_30d),
      cancelled30d: asNumber(summary?.cancelled_30d),
      completed30d: asNumber(summary?.completed_30d),
      providerFailed30d: asNumber(summary?.provider_failed_30d),
      staleActive: asNumber(summary?.stale_active),
      total30d: asNumber(summary?.total_30d),
    },
  };
}

export async function getDiagnosticsAdminSnapshot(db: AppD1Database): Promise<DiagnosticsAdminSnapshot> {
  const [aiGeneration, clientRuntime, kernel] = await Promise.all([
    loadAiGeneration(db).catch(() => EMPTY.aiGeneration),
    loadClientRuntime(db).catch(() => EMPTY.clientRuntime),
    loadKernel(db).catch(() => EMPTY.kernel),
  ]);
  return { aiGeneration, clientRuntime, kernel };
}
