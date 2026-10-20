import type { AppD1Database } from './env';
import { loadProductOperationAnalytics, type ProductOperationAnalytics } from './productOperationAnalytics';
import { loadGpuStartupAnalytics, type GpuStartupAnalytics } from './gpuStartupAnalytics';

interface ProjectIssueGroup {
  action: string;
  outcome: 'cancelled' | 'failed';
  failureCode: string;
  failureStage: string;
  backend: string;
  appVersion: string;
  buildId: string;
  platform: string;
  events: number;
  sessions: number;
}

interface PreviewHealthGroup {
  appVersion: string;
  buildId: string;
  platform: string;
  decoder: string;
  renderer: string;
  windows: number;
  sessions: number;
  samples: number;
  sampleWeightedFps: number | null;
  minimumFps: number | null;
  comparableWindows: number;
  lowFpsWindows: number;
  lowFpsSessions: number;
  emptyLayerWindows: number;
  drops: number;
  comparedSamples: number;
  slowSamples: number;
  idleSamples: number;
}

export interface ProductReliabilityAnalytics {
  operations: ProductOperationAnalytics;
  /** 30-day window, unlike the 7-day sections: startup outcomes are sparse. */
  gpuStartup: GpuStartupAnalytics;
  projectActions: {
    available: boolean;
    events: number;
    sessions: number;
    cancelled: number;
    failed: number;
    failedSessions: number;
    unclassified: number;
    groups: ProjectIssueGroup[];
    groupsTruncated: boolean;
  };
  previewHealth: {
    available: boolean;
    windows: number;
    sessions: number;
    instrumentedWindows: number;
    invalidWindows: number;
    groups: PreviewHealthGroup[];
    groupsTruncated: boolean;
  };
}

// Exactly one context per analytics session avoids multiplying health/failure
// rows when the editor emits more than one app-open event. Never expose IDs.
const CONTEXT = `WITH opens AS (
  SELECT session_id, properties_json,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY received_at, id) AS ordinal
  FROM product_analytics_events
  WHERE event_name = 'app_opened' AND julianday(received_at) >= julianday('now', '-30 days')
), events AS (
  SELECT e.*, COALESCE(json_extract(e.properties_json, '$.build_id'),
      json_extract(o.properties_json, '$.build_id'), 'unknown') AS buildId,
    COALESCE(json_extract(o.properties_json, '$.platform'), 'unknown') AS platform,
    COALESCE(e.app_version, 'unknown') AS appVersion
  FROM product_analytics_events e
  LEFT JOIN opens o ON o.session_id = e.session_id AND o.ordinal = 1
  WHERE julianday(e.received_at) >= julianday('now', '-7 days')
)`;

const PROJECT = `${CONTEXT}, issues AS (
  SELECT *, CASE WHEN event_name = 'project_action_cancelled'
      OR json_extract(properties_json, '$.reason') = 'cancelled'
      OR json_extract(properties_json, '$.failure_code') = 'cancelled'
    THEN 'cancelled' ELSE 'failed' END AS outcome,
    COALESCE(json_extract(properties_json, '$.failure_code'), 'unknown') AS failureCode,
    COALESCE(json_extract(properties_json, '$.failure_stage'), 'unknown') AS failureStage,
    COALESCE(json_extract(properties_json, '$.action'), 'unknown') AS action,
    COALESCE(json_extract(properties_json, '$.backend'), 'unknown') AS backend
  FROM events WHERE event_name IN ('project_action_failed', 'project_action_cancelled')
)`;

const PREVIEW = `${CONTEXT}, windows AS (
  SELECT *, json_extract(properties_json, '$.samples') AS samples,
    json_extract(properties_json, '$.fps_avg') AS fps,
    json_extract(properties_json, '$.fps_min') AS minimum,
    json_extract(properties_json, '$.fps_target') AS target,
    json_extract(properties_json, '$.layers') AS layers,
    COALESCE(json_extract(properties_json, '$.decoder'), 'unknown') AS decoder,
    COALESCE(json_extract(properties_json, '$.renderer'), 'unknown') AS renderer,
    json_extract(properties_json, '$.telemetry_version') AS telemetryVersion
  FROM events WHERE event_name = 'preview_health' AND json_extract(properties_json, '$.kind') = 'window'
), health AS (
  SELECT *, CASE WHEN samples > 0 AND fps >= 0 THEN 1 ELSE 0 END AS valid,
    CASE WHEN samples > 0 AND fps >= 0 AND target > 0 AND layers > 0 THEN 1 ELSE 0 END AS comparable
  FROM windows
)`;

async function loadProjectActions(db: AppD1Database): Promise<ProductReliabilityAnalytics['projectActions']> {
  try {
    const [summary, groups] = await Promise.all([
      db.prepare(`${PROJECT} SELECT COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions,
        COALESCE(SUM(outcome = 'cancelled'), 0) AS cancelled,
        COALESCE(SUM(outcome = 'failed'), 0) AS failed,
        COUNT(DISTINCT CASE WHEN outcome = 'failed' THEN session_id END) AS failedSessions,
        COALESCE(SUM(outcome = 'failed' AND failureCode = 'unknown'), 0) AS unclassified
        FROM issues`).first<Omit<ProductReliabilityAnalytics['projectActions'], 'available' | 'groups' | 'groupsTruncated'>>(),
      db.prepare(`${PROJECT} SELECT action, outcome, failureCode, failureStage, backend, appVersion, buildId, platform,
        COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions
        FROM issues GROUP BY action, outcome, failureCode, failureStage, backend, appVersion, buildId, platform
        ORDER BY (outcome = 'failed') DESC, sessions DESC, events DESC, action, failureCode, failureStage,
          backend, appVersion, buildId, platform LIMIT 51`).all<ProjectIssueGroup>(),
    ]);
    return {
      available: true, events: 0, sessions: 0, cancelled: 0, failed: 0, failedSessions: 0, unclassified: 0,
      ...summary, groups: (groups.results ?? []).slice(0, 50), groupsTruncated: groups.results.length > 50,
    };
  } catch {
    return { available: false, events: 0, sessions: 0, cancelled: 0, failed: 0, failedSessions: 0,
      unclassified: 0, groups: [], groupsTruncated: false };
  }
}

async function loadPreviewHealth(db: AppD1Database): Promise<ProductReliabilityAnalytics['previewHealth']> {
  try {
    const [summary, groups] = await Promise.all([
      db.prepare(`${PREVIEW} SELECT COUNT(*) AS windows, COUNT(DISTINCT session_id) AS sessions,
        COALESCE(SUM(telemetryVersion >= 2), 0) AS instrumentedWindows,
        COALESCE(SUM(valid = 0), 0) AS invalidWindows FROM health`)
        .first<Omit<ProductReliabilityAnalytics['previewHealth'], 'available' | 'groups' | 'groupsTruncated'>>(),
      db.prepare(`${PREVIEW} SELECT appVersion, buildId, platform, decoder, renderer,
        COUNT(*) AS windows, COUNT(DISTINCT session_id) AS sessions,
        COALESCE(SUM(CASE WHEN valid = 1 THEN samples ELSE 0 END), 0) AS samples,
        ROUND(1.0 * SUM(CASE WHEN valid = 1 THEN fps * samples END)
          / NULLIF(SUM(CASE WHEN valid = 1 THEN samples END), 0), 1) AS sampleWeightedFps,
        MIN(CASE WHEN valid = 1 THEN minimum END) AS minimumFps,
        SUM(comparable) AS comparableWindows,
        SUM(CASE WHEN comparable = 1 AND fps < 0.8 * target THEN 1 ELSE 0 END) AS lowFpsWindows,
        COUNT(DISTINCT CASE WHEN comparable = 1 AND fps < 0.8 * target THEN session_id END) AS lowFpsSessions,
        SUM(CASE WHEN layers = 0 THEN 1 ELSE 0 END) AS emptyLayerWindows,
        COALESCE(SUM(json_extract(properties_json, '$.drops')), 0) AS drops,
        COALESCE(SUM(json_extract(properties_json, '$.compared_samples')), 0) AS comparedSamples,
        COALESCE(SUM(json_extract(properties_json, '$.slow_samples')), 0) AS slowSamples,
        COALESCE(SUM(json_extract(properties_json, '$.idle_samples')), 0) AS idleSamples
        FROM health GROUP BY appVersion, buildId, platform, decoder, renderer
        ORDER BY lowFpsSessions DESC, sessions DESC, windows DESC, appVersion, buildId, platform, decoder, renderer
        LIMIT 51`).all<PreviewHealthGroup>(),
    ]);
    return { available: true, windows: 0, sessions: 0, instrumentedWindows: 0, invalidWindows: 0,
      ...summary, groups: (groups.results ?? []).slice(0, 50), groupsTruncated: groups.results.length > 50 };
  } catch {
    return { available: false, windows: 0, sessions: 0, instrumentedWindows: 0, invalidWindows: 0,
      groups: [], groupsTruncated: false };
  }
}

export async function loadProductReliabilityAnalytics(db: AppD1Database): Promise<ProductReliabilityAnalytics> {
  const [projectActions, previewHealth, operations, gpuStartup] = await Promise.all([
    loadProjectActions(db), loadPreviewHealth(db), loadProductOperationAnalytics(db), loadGpuStartupAnalytics(db),
  ]);
  return { projectActions, previewHealth, operations, gpuStartup };
}
