import { json, methodNotAllowed } from '../lib/db';
import type { AppContext, AppRouteHandler } from '../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  // Auth: require VISITOR_NOTIFY_SECRET as query param or header
  const url = new URL(context.request.url);
  const secret = url.searchParams.get('secret') ?? context.request.headers.get('x-visitor-secret');
  const expected = context.env.VISITOR_NOTIFY_SECRET;

  if (!expected || !secret || secret !== expected) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  // Optional: only return visits after this timestamp
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam ? parseInt(sinceParam, 10) : 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

  try {
    // List recent visit keys from KV
    const listed = await context.env.KV.list({ prefix: 'visit:', limit: 200 });
    const visits: unknown[] = [];

    // Fetch visit data in parallel (limited batch)
    const keys = listed.keys
      .map((k) => k.name)
      .filter((name) => {
        // Extract timestamp from key: visit:{ts}:{random}
        const parts = name.split(':');
        const ts = parseInt(parts[1], 10);
        return !since || ts > since;
      })
      .slice(0, limit);

    const results = await Promise.all(
      keys.map(async (key) => {
        const data = await context.env.KV.get(key, { type: 'json' });
        return data;
      }),
    );

    for (const entry of results) {
      if (entry) visits.push(entry);
    }

    // Sort newest first
    visits.sort((a: unknown, b: unknown) => {
      const aTs = (a as { ts: number }).ts;
      const bTs = (b as { ts: number }).ts;
      return bTs - aTs;
    });

    return json({
      count: visits.length,
      visits,
    });
  } catch (err) {
    return json(
      { error: 'internal_error', message: String(err) },
      { status: 500 },
    );
  }
};
