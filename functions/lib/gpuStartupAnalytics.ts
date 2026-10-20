import type { AppD1Database } from './env';

// The real WebGPU startup success rate. Error reports only see the failures;
// `gpu_init_outcome` is sent once per page for successes and failures alike.
// One row per analytics session (its latest outcome) so a reload loop or a
// worker plus main host does not count twice.
const LATEST = `WITH outcomes AS (
  SELECT session_id, properties_json,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY received_at DESC, id DESC) AS ordinal
  FROM product_analytics_events
  WHERE event_name = 'gpu_init_outcome' AND julianday(received_at) >= julianday('now', '-30 days')
), latest AS (
  SELECT
    COALESCE(json_extract(properties_json, '$.outcome'), 'unknown') AS outcome,
    COALESCE(json_extract(properties_json, '$.failure'), 'none') AS failure,
    COALESCE(json_extract(properties_json, '$.platform'), 'unknown') AS platform,
    COALESCE(json_extract(properties_json, '$.device_class'), 'unknown') AS deviceClass,
    COALESCE(json_extract(properties_json, '$.browser'), 'unknown') AS browser,
    COALESCE(json_extract(properties_json, '$.browser_major'), 0) AS browserMajor,
    COALESCE(json_extract(properties_json, '$.os_major'), 0) AS osMajor,
    COALESCE(json_extract(properties_json, '$.gpu_vendor'), 'unknown') AS gpuVendor,
    COALESCE(json_extract(properties_json, '$.in_app_browser'), 0) AS inAppBrowser,
    json_extract(properties_json, '$.init_ms') AS initMs
  FROM outcomes WHERE ordinal = 1
)`;

const DIMENSIONS = {
  platform: ['platform', 'deviceClass'],
  browser: ['platform', 'browser', 'browserMajor', 'inAppBrowser'],
  os: ['platform', 'osMajor'],
  gpuVendor: ['platform', 'gpuVendor'],
  failure: ['failure', 'platform', 'browser'],
} as const;

type Dimension = keyof typeof DIMENSIONS;
const GROUP_LIMIT = 30;

export interface GpuStartupGroup {
  [key: string]: string | number | null;
  sessions: number;
  failed: number;
  failureRate: number;
}

export interface GpuStartupAnalytics {
  available: boolean;
  windowDays: 30;
  sessions: number;
  ready: number;
  failed: number;
  failureRate: number;
  medianInitMs: number | null;
  groups: Record<Dimension, GpuStartupGroup[]>;
}

const emptyGroups = (): Record<Dimension, GpuStartupGroup[]> =>
  ({ platform: [], browser: [], os: [], gpuVendor: [], failure: [] });

function rate(failed: number, sessions: number): number {
  return sessions > 0 ? Math.round((failed / sessions) * 1000) / 1000 : 0;
}

async function loadGroups(db: AppD1Database, dimension: Dimension): Promise<GpuStartupGroup[]> {
  const columns = DIMENSIONS[dimension].join(', ');
  const where = dimension === 'failure' ? "WHERE outcome = 'failed'" : '';
  const rows = await db.prepare(`${LATEST} SELECT ${columns}, COUNT(*) AS sessions,
      COALESCE(SUM(outcome = 'failed'), 0) AS failed
    FROM latest ${where} GROUP BY ${columns}
    ORDER BY failed DESC, sessions DESC, ${columns} LIMIT ${GROUP_LIMIT}`)
    .all<Omit<GpuStartupGroup, 'failureRate'>>();
  return (rows.results ?? []).map(row => ({ ...row, failureRate: rate(row.failed, row.sessions) }));
}

export async function loadGpuStartupAnalytics(db: AppD1Database): Promise<GpuStartupAnalytics> {
  try {
    const summary = await db.prepare(`${LATEST} SELECT COUNT(*) AS sessions,
        COALESCE(SUM(outcome = 'ready'), 0) AS ready, COALESCE(SUM(outcome = 'failed'), 0) AS failed
      FROM latest`).first<{ sessions: number; ready: number; failed: number }>();
    const timings = await db.prepare(`${LATEST} SELECT initMs FROM latest
      WHERE outcome = 'ready' AND initMs IS NOT NULL ORDER BY initMs`).all<{ initMs: number }>();
    const initTimes = (timings.results ?? []).map(row => row.initMs);
    const groups = emptyGroups();
    for (const dimension of Object.keys(DIMENSIONS) as Dimension[]) groups[dimension] = await loadGroups(db, dimension);
    const sessions = summary?.sessions ?? 0;
    const failed = summary?.failed ?? 0;
    return {
      available: true, windowDays: 30, sessions, ready: summary?.ready ?? 0, failed,
      failureRate: rate(failed, sessions),
      medianInitMs: initTimes.length ? initTimes[Math.floor(initTimes.length / 2)] : null,
      groups,
    };
  } catch {
    return { available: false, windowDays: 30, sessions: 0, ready: 0, failed: 0, failureRate: 0,
      medianInitMs: null, groups: emptyGroups() };
  }
}
