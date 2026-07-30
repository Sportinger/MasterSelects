import type { Env } from './env';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 6_000;

interface CloudflareEnvelope<T> {
  errors?: Array<{ message?: string }>;
  result?: T;
  success?: boolean;
}

interface PagesProject {
  domains?: string[];
  name?: string;
  production_branch?: string;
  subdomain?: string;
}

interface PagesDeployment {
  aliases?: string[];
  created_on?: string;
  deployment_trigger?: {
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  environment?: string;
  id?: string;
  latest_stage?: {
    ended_on?: string;
    name?: string;
    status?: string;
  };
  modified_on?: string;
  url?: string;
}

interface D1DatabaseDetails {
  file_size?: number;
  name?: string;
  num_tables?: number;
  read_replication?: { mode?: string };
  running_in_region?: string;
  version?: string;
}

interface AnalyticsGroup {
  count?: number;
  dimensions?: {
    clientRequestPath?: string;
    datetimeDay?: string;
    edgeResponseStatus?: number;
  };
  sum?: {
    edgeResponseBytes?: number;
    visits?: number;
  };
}

interface AnalyticsResponse {
  data?: {
    viewer?: {
      zones?: Array<{
        daily?: AnalyticsGroup[];
        statuses?: AnalyticsGroup[];
        topPaths?: AnalyticsGroup[];
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

interface VisitMetadata {
  country?: string;
  path?: string;
  ts?: number;
  visitorId?: string;
}

export interface CloudflareAdminSnapshot {
  configured: boolean;
  d1: {
    fileSize: number | null;
    name: string;
    numTables: number | null;
    readReplication: string | null;
    region: string | null;
    version: string | null;
  } | null;
  deployments: Array<{
    branch: string | null;
    commitHash: string | null;
    commitMessage: string | null;
    createdAt: string | null;
    environment: string | null;
    id: string;
    status: string;
    url: string | null;
  }>;
  error: string | null;
  project: {
    domains: string[];
    name: string;
    productionBranch: string | null;
  } | null;
  traffic: {
    available: boolean;
    bytes7d: number;
    daily: Array<{ bytes: number; date: string; requests: number; visits: number }>;
    requests7d: number;
    statusCodes: Array<{ count: number; status: number }>;
    topPaths: Array<{ bytes: number; path: string; requests: number }>;
    visits7d: number;
  };
  visitsLastHour: {
    countries: Array<{ count: number; country: string }>;
    paths: Array<{ count: number; path: string }>;
    requests: number;
    uniqueVisitors: number;
  };
}

async function cloudflareRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error('Cloudflare read token is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json() as CloudflareEnvelope<T>;
    if (!response.ok || payload.success === false || payload.result === undefined) {
      throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join('; ')
        || `Cloudflare replied with ${response.status}.`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function cloudflareGraphql(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
): Promise<AnalyticsResponse> {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error('Cloudflare read token is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${CLOUDFLARE_API_BASE}/graphql`, {
      body: JSON.stringify({ query, variables }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const payload = await response.json() as AnalyticsResponse;
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join('; ')
        || `Cloudflare analytics replied with ${response.status}.`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function countBy(
  values: string[],
  fallback: string,
  limit = 6,
): Array<{ count: number; [key: string]: number | string }> {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim() || fallback;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ count, value }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

async function loadRecentVisits(env: Env): Promise<CloudflareAdminSnapshot['visitsLastHour']> {
  const metadata: VisitMetadata[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.KV.list({ cursor, limit: 1000, prefix: 'visit2:' });
    for (const key of page.keys) {
      if (key.metadata && typeof key.metadata === 'object') {
        metadata.push(key.metadata as VisitMetadata);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && metadata.length < 5_000);

  const uniqueVisitors = new Set(metadata.map((entry) => entry.visitorId).filter(Boolean)).size;
  return {
    countries: countBy(metadata.map((entry) => entry.country ?? ''), 'Unknown')
      .map((entry) => ({ count: entry.count, country: String(entry.value) })),
    paths: countBy(metadata.map((entry) => entry.path ?? ''), '/')
      .map((entry) => ({ count: entry.count, path: String(entry.value) })),
    requests: metadata.length,
    uniqueVisitors,
  };
}

async function loadZoneAnalytics(
  env: Env,
  zoneId: string,
): Promise<CloudflareAdminSnapshot['traffic']> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const query = `query AdminTraffic($zoneTag: string, $start: Time, $end: Time) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        daily: httpRequestsAdaptiveGroups(
          limit: 8
          orderBy: [datetimeDay_ASC]
          filter: { datetime_geq: $start, datetime_leq: $end, requestSource: "eyeball" }
        ) {
          count
          sum { edgeResponseBytes visits }
          dimensions { datetimeDay }
        }
        topPaths: httpRequestsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_leq: $end, requestSource: "eyeball" }
        ) {
          count
          sum { edgeResponseBytes }
          dimensions { clientRequestPath }
        }
        statuses: httpRequestsAdaptiveGroups(
          limit: 12
          orderBy: [count_DESC]
          filter: { datetime_geq: $start, datetime_leq: $end, requestSource: "eyeball" }
        ) {
          count
          dimensions { edgeResponseStatus }
        }
      }
    }
  }`;
  const response = await cloudflareGraphql(env, query, {
    end: end.toISOString(),
    start: start.toISOString(),
    zoneTag: zoneId,
  });
  const zone = response.data?.viewer?.zones?.[0];
  const daily = (zone?.daily ?? []).map((group) => ({
    bytes: Number(group.sum?.edgeResponseBytes ?? 0),
    date: group.dimensions?.datetimeDay ?? '',
    requests: Number(group.count ?? 0),
    visits: Number(group.sum?.visits ?? 0),
  }));

  return {
    available: true,
    bytes7d: daily.reduce((sum, entry) => sum + entry.bytes, 0),
    daily,
    requests7d: daily.reduce((sum, entry) => sum + entry.requests, 0),
    statusCodes: (zone?.statuses ?? []).map((group) => ({
      count: Number(group.count ?? 0),
      status: Number(group.dimensions?.edgeResponseStatus ?? 0),
    })),
    topPaths: (zone?.topPaths ?? []).map((group) => ({
      bytes: Number(group.sum?.edgeResponseBytes ?? 0),
      path: group.dimensions?.clientRequestPath ?? '/',
      requests: Number(group.count ?? 0),
    })),
    visits7d: daily.reduce((sum, entry) => sum + entry.visits, 0),
  };
}

const EMPTY_TRAFFIC: CloudflareAdminSnapshot['traffic'] = {
  available: false,
  bytes7d: 0,
  daily: [],
  requests7d: 0,
  statusCodes: [],
  topPaths: [],
  visits7d: 0,
};

export async function getCloudflareAdminSnapshot(env: Env): Promise<CloudflareAdminSnapshot> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const projectName = env.CLOUDFLARE_PAGES_PROJECT?.trim() || 'masterselects';
  const databaseId = env.CLOUDFLARE_D1_DATABASE_ID?.trim();
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  const configured = Boolean(env.CLOUDFLARE_API_TOKEN?.trim() && accountId);
  const visitsLastHour = await loadRecentVisits(env).catch(() => ({
    countries: [],
    paths: [],
    requests: 0,
    uniqueVisitors: 0,
  }));

  if (!configured || !accountId) {
    return {
      configured: false,
      d1: null,
      deployments: [],
      error: 'Cloudflare live data is not configured.',
      project: null,
      traffic: EMPTY_TRAFFIC,
      visitsLastHour,
    };
  }

  try {
    const [project, deployments, d1, traffic] = await Promise.all([
      cloudflareRequest<PagesProject>(env, `/accounts/${accountId}/pages/projects/${projectName}`),
      cloudflareRequest<PagesDeployment[]>(
        env,
        `/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=8`,
      ),
      databaseId
        ? cloudflareRequest<D1DatabaseDetails>(env, `/accounts/${accountId}/d1/database/${databaseId}`)
        : Promise.resolve(null),
      zoneId
        ? loadZoneAnalytics(env, zoneId).catch(() => EMPTY_TRAFFIC)
        : Promise.resolve(EMPTY_TRAFFIC),
    ]);

    return {
      configured: true,
      d1: d1 ? {
        fileSize: typeof d1.file_size === 'number' ? d1.file_size : null,
        name: d1.name ?? 'masterselects',
        numTables: typeof d1.num_tables === 'number' ? d1.num_tables : null,
        readReplication: d1.read_replication?.mode ?? null,
        region: d1.running_in_region ?? null,
        version: d1.version ?? null,
      } : null,
      deployments: deployments.map((deployment) => ({
        branch: deployment.deployment_trigger?.metadata?.branch ?? null,
        commitHash: deployment.deployment_trigger?.metadata?.commit_hash?.slice(0, 8) ?? null,
        commitMessage: deployment.deployment_trigger?.metadata?.commit_message ?? null,
        createdAt: deployment.created_on ?? deployment.modified_on ?? null,
        environment: deployment.environment ?? null,
        id: deployment.id ?? crypto.randomUUID(),
        status: deployment.latest_stage?.status ?? 'unknown',
        url: deployment.url ?? deployment.aliases?.[0] ?? null,
      })),
      error: null,
      project: {
        domains: project.domains ?? (project.subdomain ? [project.subdomain] : []),
        name: project.name ?? projectName,
        productionBranch: project.production_branch ?? null,
      },
      traffic,
      visitsLastHour,
    };
  } catch (error) {
    return {
      configured: true,
      d1: null,
      deployments: [],
      error: error instanceof Error ? error.message : 'Cloudflare live data could not be loaded.',
      project: null,
      traffic: EMPTY_TRAFFIC,
      visitsLastHour,
    };
  }
}
