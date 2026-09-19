import type { Env } from './env';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 6_000;

interface CloudflareEnvelope<T> {
  errors?: Array<{ message?: string }>;
  result?: T;
  success?: boolean;
}

interface PagesProject {
  build_config?: { web_analytics_tag?: string };
  domains?: string[];
  name?: string;
  production_branch?: string;
  production_script_name?: string;
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

interface RumAnalyticsGroup {
  count?: number;
  dimensions?: {
    countryName?: string;
    date?: string;
    deviceType?: string;
    refererHost?: string;
    requestPath?: string;
    userAgentBrowser?: string;
  };
  sum?: { visits?: number };
}

interface PagesFunctionsAnalyticsGroup {
  dimensions?: {
    date?: string;
    status?: string;
  };
  sum?: {
    errors?: number;
    requests?: number;
    responseBodySize?: number;
  };
}

interface AnalyticsResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface ZoneAnalyticsResponse {
  viewer?: {
    zones?: Array<{
      daily?: AnalyticsGroup[];
      statuses?: AnalyticsGroup[];
      topPaths?: AnalyticsGroup[];
    }>;
  };
}

interface WebAnalyticsResponse {
  viewer?: {
    accounts?: Array<{
      browsers?: RumAnalyticsGroup[];
      countries?: RumAnalyticsGroup[];
      daily?: RumAnalyticsGroup[];
      devices?: RumAnalyticsGroup[];
      referrers?: RumAnalyticsGroup[];
      topPaths?: RumAnalyticsGroup[];
    }>;
  };
}

interface PagesFunctionsAnalyticsResponse {
  viewer?: {
    accounts?: Array<{
      daily?: PagesFunctionsAnalyticsGroup[];
      statuses?: PagesFunctionsAnalyticsGroup[];
    }>;
  };
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
  pagesFunctions: {
    available: boolean;
    daily: Array<{ date: string; errors: number; requests: number; responseBytes: number }>;
    errors7d: number;
    requests7d: number;
    responseBytes7d: number;
    statuses: Array<{ count: number; status: string }>;
  };
  project: {
    domains: string[];
    name: string;
    productionBranch: string | null;
  } | null;
  traffic: {
    available: boolean;
    browsers: Array<{ browser: string; count: number }>;
    bytes7d: number;
    countries: Array<{ count: number; country: string }>;
    daily: Array<{ bytes: number; date: string; requests: number; visits: number }>;
    devices: Array<{ count: number; device: string }>;
    referrers: Array<{ count: number; referrer: string }>;
    requests7d: number;
    source: 'none' | 'web-analytics' | 'zone';
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

async function cloudflareGraphql<T>(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
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
    const payload = await response.json() as AnalyticsResponse<T>;
    if (!response.ok || payload.errors?.length || payload.data === undefined) {
      throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join('; ')
        || `Cloudflare analytics replied with ${response.status}.`);
    }
    return payload.data;
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
  const cutoff = Date.now() - 60 * 60 * 1_000;
  let cursor: string | undefined;

  do {
    const page = await env.KV.list({ cursor, limit: 1000, prefix: 'visit2:' });
    let reachedCutoff = false;
    for (const key of page.keys) {
      if (key.metadata && typeof key.metadata === 'object') {
        const entry = key.metadata as VisitMetadata;
        if (typeof entry.ts !== 'number') continue;
        if (entry.ts < cutoff) {
          reachedCutoff = true;
          continue;
        }
        metadata.push(entry);
      }
    }
    cursor = page.list_complete || reachedCutoff ? undefined : page.cursor;
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
  const response = await cloudflareGraphql<ZoneAnalyticsResponse>(env, query, {
    end: end.toISOString(),
    start: start.toISOString(),
    zoneTag: zoneId,
  });
  const zone = response.viewer?.zones?.[0];
  const daily = (zone?.daily ?? []).map((group) => ({
    bytes: Number(group.sum?.edgeResponseBytes ?? 0),
    date: group.dimensions?.datetimeDay ?? '',
    requests: Number(group.count ?? 0),
    visits: Number(group.sum?.visits ?? 0),
  }));

  return {
    available: true,
    browsers: [],
    bytes7d: daily.reduce((sum, entry) => sum + entry.bytes, 0),
    countries: [],
    daily,
    devices: [],
    referrers: [],
    requests7d: daily.reduce((sum, entry) => sum + entry.requests, 0),
    source: 'zone',
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

function analyticsDateRange(): { end: string; start: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1_000);
  return {
    end: end.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
  };
}

function rankedDimension(
  groups: RumAnalyticsGroup[] | undefined,
  field: keyof NonNullable<RumAnalyticsGroup['dimensions']>,
  fallback: string,
): Array<{ count: number; value: string }> {
  return (groups ?? []).map((group) => ({
    count: Number(group.count ?? 0),
    value: group.dimensions?.[field]?.trim() || fallback,
  }));
}

async function loadWebAnalytics(
  env: Env,
  accountId: string,
  siteTag: string,
): Promise<CloudflareAdminSnapshot['traffic']> {
  const query = `query AdminWebAnalytics($accountTag: string, $siteTag: string, $start: Date, $end: Date) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        daily: rumPageloadEventsAdaptiveGroups(
          limit: 7
          orderBy: [date_ASC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count sum { visits } dimensions { date } }
        topPaths: rumPageloadEventsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count dimensions { requestPath } }
        countries: rumPageloadEventsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count dimensions { countryName } }
        devices: rumPageloadEventsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count dimensions { deviceType } }
        browsers: rumPageloadEventsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count dimensions { userAgentBrowser } }
        referrers: rumPageloadEventsAdaptiveGroups(
          limit: 8
          orderBy: [count_DESC]
          filter: { siteTag: $siteTag, date_geq: $start, date_leq: $end }
        ) { count dimensions { refererHost } }
      }
    }
  }`;
  const response = await cloudflareGraphql<WebAnalyticsResponse>(env, query, {
    accountTag: accountId,
    siteTag,
    ...analyticsDateRange(),
  });
  const account = response.viewer?.accounts?.[0];
  const daily = (account?.daily ?? []).map((group) => ({
    bytes: 0,
    date: group.dimensions?.date ?? '',
    requests: Number(group.count ?? 0),
    visits: Number(group.sum?.visits ?? 0),
  }));
  const browsers = rankedDimension(account?.browsers, 'userAgentBrowser', 'Unknown');
  const countries = rankedDimension(account?.countries, 'countryName', 'Unknown');
  const devices = rankedDimension(account?.devices, 'deviceType', 'Unknown');
  const referrers = rankedDimension(account?.referrers, 'refererHost', 'Direct');
  const topPaths = rankedDimension(account?.topPaths, 'requestPath', '/');

  return {
    available: true,
    browsers: browsers.map((entry) => ({ browser: entry.value, count: entry.count })),
    bytes7d: 0,
    countries: countries.map((entry) => ({ count: entry.count, country: entry.value })),
    daily,
    devices: devices.map((entry) => ({ count: entry.count, device: entry.value })),
    referrers: referrers.map((entry) => ({ count: entry.count, referrer: entry.value })),
    requests7d: daily.reduce((sum, entry) => sum + entry.requests, 0),
    source: 'web-analytics',
    statusCodes: [],
    topPaths: topPaths.map((entry) => ({ bytes: 0, path: entry.value, requests: entry.count })),
    visits7d: daily.reduce((sum, entry) => sum + entry.visits, 0),
  };
}

async function loadPagesFunctionsAnalytics(
  env: Env,
  accountId: string,
  scriptName: string,
): Promise<CloudflareAdminSnapshot['pagesFunctions']> {
  const query = `query AdminPagesFunctions($accountTag: string, $scriptName: string, $start: Date, $end: Date) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        daily: pagesFunctionsInvocationsAdaptiveGroups(
          limit: 7
          orderBy: [date_ASC]
          filter: { scriptName: $scriptName, date_geq: $start, date_leq: $end }
        ) { sum { errors requests responseBodySize } dimensions { date } }
        statuses: pagesFunctionsInvocationsAdaptiveGroups(
          limit: 8
          orderBy: [sum_requests_DESC]
          filter: { scriptName: $scriptName, date_geq: $start, date_leq: $end }
        ) { sum { errors requests } dimensions { status } }
      }
    }
  }`;
  const response = await cloudflareGraphql<PagesFunctionsAnalyticsResponse>(env, query, {
    accountTag: accountId,
    scriptName,
    ...analyticsDateRange(),
  });
  const account = response.viewer?.accounts?.[0];
  const daily = (account?.daily ?? []).map((group) => ({
    date: group.dimensions?.date ?? '',
    errors: Number(group.sum?.errors ?? 0),
    requests: Number(group.sum?.requests ?? 0),
    responseBytes: Number(group.sum?.responseBodySize ?? 0),
  }));

  return {
    available: true,
    daily,
    errors7d: daily.reduce((sum, entry) => sum + entry.errors, 0),
    requests7d: daily.reduce((sum, entry) => sum + entry.requests, 0),
    responseBytes7d: daily.reduce((sum, entry) => sum + entry.responseBytes, 0),
    statuses: (account?.statuses ?? []).map((group) => ({
      count: Number(group.sum?.requests ?? 0),
      status: group.dimensions?.status ?? 'unknown',
    })),
  };
}

const EMPTY_TRAFFIC: CloudflareAdminSnapshot['traffic'] = {
  available: false,
  browsers: [],
  bytes7d: 0,
  countries: [],
  daily: [],
  devices: [],
  referrers: [],
  requests7d: 0,
  source: 'none',
  statusCodes: [],
  topPaths: [],
  visits7d: 0,
};

const EMPTY_PAGES_FUNCTIONS: CloudflareAdminSnapshot['pagesFunctions'] = {
  available: false,
  daily: [],
  errors7d: 0,
  requests7d: 0,
  responseBytes7d: 0,
  statuses: [],
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
      pagesFunctions: EMPTY_PAGES_FUNCTIONS,
      project: null,
      traffic: EMPTY_TRAFFIC,
      visitsLastHour,
    };
  }

  try {
    const [project, deployments, d1] = await Promise.all([
      cloudflareRequest<PagesProject>(env, `/accounts/${accountId}/pages/projects/${projectName}`),
      cloudflareRequest<PagesDeployment[]>(
        env,
        `/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=8`,
      ),
      databaseId
        ? cloudflareRequest<D1DatabaseDetails>(env, `/accounts/${accountId}/d1/database/${databaseId}`)
        : Promise.resolve(null),
    ]);
    const webAnalyticsTag = project.build_config?.web_analytics_tag?.trim();
    const productionScriptName = project.production_script_name?.trim();
    const loadWebAnalyticsFallback = () => webAnalyticsTag
      ? loadWebAnalytics(env, accountId, webAnalyticsTag).catch(() => EMPTY_TRAFFIC)
      : Promise.resolve(EMPTY_TRAFFIC);
    const [traffic, pagesFunctions] = await Promise.all([
      zoneId
        ? loadZoneAnalytics(env, zoneId).catch(() => loadWebAnalyticsFallback())
        : loadWebAnalyticsFallback(),
      productionScriptName
        ? loadPagesFunctionsAnalytics(env, accountId, productionScriptName)
          .catch(() => EMPTY_PAGES_FUNCTIONS)
        : Promise.resolve(EMPTY_PAGES_FUNCTIONS),
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
      pagesFunctions,
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
      pagesFunctions: EMPTY_PAGES_FUNCTIONS,
      project: null,
      traffic: EMPTY_TRAFFIC,
      visitsLastHour,
    };
  }
}
