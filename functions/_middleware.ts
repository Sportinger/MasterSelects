import { loadUserFromSession } from './lib/auth';
import { buildRequestId } from './lib/db';
import type { AppContext, AppRouteHandler } from './lib/env';

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|wasm|webp|avif|mp4|webm)$/i;

function withHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const { pathname } = new URL(request.url);

  headers.set('X-MasterSelects-Edge', 'pages-functions');

  if (pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function shouldTrackVisit(request: Request): boolean {
  const url = new URL(request.url);
  if (request.method !== 'GET') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (ASSET_EXTENSIONS.test(url.pathname)) return false;
  // Skip known bots
  const ua = request.headers.get('user-agent') ?? '';
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return false;
  return true;
}

interface VisitEntry {
  ts: number;
  path: string;
  country?: string;
  city?: string;
  ua?: string;
  referer?: string;
}

async function trackVisit(context: AppContext): Promise<void> {
  try {
    const request = context.request;
    const url = new URL(request.url);
    const cfData = (request as unknown as { cf?: Record<string, string> }).cf;

    const entry: VisitEntry = {
      ts: Date.now(),
      path: url.pathname,
      country: cfData?.country,
      city: cfData?.city,
      ua: (request.headers.get('user-agent') ?? '').slice(0, 200),
      referer: request.headers.get('referer') ?? undefined,
    };

    // Store as individual KV key with 1h TTL for easy listing
    const key = `visit:${entry.ts}:${crypto.randomUUID().slice(0, 8)}`;
    await context.env.KV.put(key, JSON.stringify(entry), { expirationTtl: 3600 });
  } catch {
    // Never let tracking break the request
  }
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  context.data.requestId = buildRequestId(context.request);
  context.data.user = null;

  try {
    context.data.user = await loadUserFromSession(context.request, context.env);
  } catch {
    context.data.user = null;
  }

  if (context.request.method === 'OPTIONS' && new URL(context.request.url).pathname.startsWith('/api/')) {
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
        'Cache-Control': 'no-store',
      },
      status: 204,
    });
  }

  // Track page visits in background (non-blocking)
  if (shouldTrackVisit(context.request)) {
    context.waitUntil(trackVisit(context));
  }

  const response = await context.next();
  return withHeaders(response, context.request);
};
