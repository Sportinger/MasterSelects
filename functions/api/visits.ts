import { timingSafeEqualStrings } from '../lib/constantTime';
import { json, methodNotAllowed } from '../lib/db';
import type { AppContext, AppRouteHandler } from '../lib/env';

interface VisitEntry {
  browser?: string;
  ts: number;
  path: string;
  country?: string;
  device?: string;
  os?: string;
  referrerHost?: string;
  // Legacy fields remain readable until the old one-hour entries expire.
  city?: string;
  ua?: string;
  referer?: string;
  visitorId?: string;
}

interface ListedVisitKey {
  metadata?: unknown;
  name: string;
}

function parseVisitTimestamp(name: string): number | null {
  const parts = name.split(':');

  if (parts[0] === 'visit2' && parts.length >= 4) {
    const ts = parseInt(parts[2], 10);
    return Number.isFinite(ts) ? ts : null;
  }

  if (parts[0] === 'visit' && parts.length >= 3) {
    const ts = parseInt(parts[1], 10);
    return Number.isFinite(ts) ? ts : null;
  }

  return null;
}

async function loadVisitEntry(context: AppContext, key: ListedVisitKey): Promise<VisitEntry | null> {
  if (key.metadata && typeof key.metadata === 'object') {
    const metadata = key.metadata as Partial<VisitEntry>;
    if (typeof metadata.ts === 'number' && typeof metadata.path === 'string') {
      return {
        browser: metadata.browser,
        city: metadata.city,
        country: metadata.country,
        device: metadata.device,
        os: metadata.os,
        path: metadata.path,
        referer: metadata.referer,
        referrerHost: metadata.referrerHost,
        ts: metadata.ts,
        ua: metadata.ua,
        visitorId: metadata.visitorId,
      };
    }
  }

  return context.env.KV.get<VisitEntry>(key.name, { type: 'json' });
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  // Auth: VISITOR_NOTIFY_SECRET as `Authorization: Bearer` or `X-Visitor-Secret`
  // header only. Query strings land in edge and proxy logs, so the secret is
  // no longer accepted there.
  const url = new URL(context.request.url);
  const bearer = /^Bearer\s+(\S+)$/i.exec(context.request.headers.get('Authorization') ?? '')?.[1] ?? null;
  const supplied = bearer ?? context.request.headers.get('X-Visitor-Secret')?.trim() ?? null;
  const expected = context.env.VISITOR_NOTIFY_SECRET?.trim();

  if (!expected || !supplied || !timingSafeEqualStrings(supplied, expected)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional: only return visits after this timestamp
  const sinceParam = url.searchParams.get('since');
  const parsedSince = sinceParam ? parseInt(sinceParam, 10) : 0;
  const parsedLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const since = Number.isFinite(parsedSince) ? Math.max(parsedSince, 0) : 0;
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

  try {
    const batchLimit = Math.max(limit * 2, 50);
    const [listedNewestFirst, listedLegacy] = await Promise.all([
      context.env.KV.list({ prefix: 'visit2:', limit: batchLimit }),
      context.env.KV.list({ prefix: 'visit:', limit: batchLimit }),
    ]);

    const keys = [...listedNewestFirst.keys, ...listedLegacy.keys]
      .map((key) => ({
        key,
        ts: parseVisitTimestamp(key.name),
      }))
      .filter((entry): entry is { key: ListedVisitKey; ts: number } => Number.isFinite(entry.ts))
      .filter((entry) => !since || entry.ts > since)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);

    const results = await Promise.all(keys.map(({ key }) => loadVisitEntry(context, key)));
    const visits = results.filter((entry): entry is VisitEntry => Boolean(entry));

    return json({
      count: visits.length,
      visits,
    });
  } catch (error) {
    console.error('[visits] listing failed', context.data.requestId, error instanceof Error ? error.message : error);
    return json(
      { error: 'internal_error', requestId: context.data.requestId ?? null },
      { status: 500 },
    );
  }
};
