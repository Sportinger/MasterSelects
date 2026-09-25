import { clearAuthCookies, loadUserFromSession } from './lib/auth';
import { buildRequestId } from './lib/db';
import { ensureGuestAccess } from './lib/guestAccess';
import type { AppContext, AppRouteHandler } from './lib/env';
import { isSupportedPagePath } from '../src/routing/entryExperience';
import { json } from './lib/db';
import { ReviewerAccessRevokedError } from './lib/reviewerAccess';

const VISIT_RETENTION_TTL_SECONDS = 180 * 24 * 60 * 60;

function withHeaders(response: Response, request: Request): Response {
  if (response.status === 101 || (response as { webSocket?: unknown }).webSocket) return response;

  const headers = new Headers(response.headers);
  const { pathname } = new URL(request.url);
  const isAdminApi = pathname.startsWith('/api/admin/');

  headers.set('X-MasterSelects-Edge', 'pages-functions');

  if (pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }

  // Baseline hardening for every response served through Functions. Framing
  // stays same-origin (not DENY) because the credit-claim page embeds the
  // editor itself in an iframe. The enforced CSP is limited to frame-ancestors;
  // the full policy ships as Report-Only from public/_headers.
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), payment=(), interest-cohort=()');
  if (isHtmlResponse(response) && !headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "frame-ancestors 'self'");
  }

  if (isAdminApi) {
    headers.set('Cache-Control', 'no-store, private, max-age=0');
    headers.set('Permissions-Policy', 'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().startsWith('text/html') === true;
}

function shouldTrackVisit(request: Request, response: Response): boolean {
  const url = new URL(request.url);
  if (request.method !== 'GET') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (response.status !== 200 || !isHtmlResponse(response)) return false;
  // Skip known bots
  const ua = request.headers.get('user-agent') ?? '';
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return false;
  return true;
}

function isUnknownPageFallback(request: Request, response: Response): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = new URL(request.url).pathname;
  if (isSupportedPagePath(pathname)) return false;
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return false;

  return response.status === 200
    && isHtmlResponse(response);
}

interface VisitEntry {
  browser: 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
  country?: string;
  device: 'desktop' | 'mobile' | 'tablet' | 'other';
  os: 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'other';
  path: string;
  referrerHost?: string;
  ts: number;
  visitorId?: string;
}

function buildVisitKey(ts: number): string {
  const newestFirst = String(9_999_999_999_999 - ts).padStart(13, '0');
  return `visit2:${newestFirst}:${ts}:${crypto.randomUUID().slice(0, 8)}`;
}

function classifyBrowser(userAgent: string): VisitEntry['browser'] {
  if (/Edg\//i.test(userAgent)) return 'edge';
  if (/Chrome\/|CriOS\//i.test(userAgent)) return 'chrome';
  if (/Firefox\/|FxiOS\//i.test(userAgent)) return 'firefox';
  if (/Safari\//i.test(userAgent)) return 'safari';
  return 'other';
}

function classifyDevice(userAgent: string): VisitEntry['device'] {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
  if (/Mobile|iPhone|Android/i.test(userAgent)) return 'mobile';
  if (/Windows|Macintosh|Mac OS X|Linux|X11/i.test(userAgent)) return 'desktop';
  return 'other';
}

function classifyOs(userAgent: string): VisitEntry['os'] {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return 'other';
}

function sanitizeCountry(country?: string): string | undefined {
  const normalized = country?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function sanitizeVisitPath(pathname: string): string {
  if (pathname === '/claim' || pathname.startsWith('/claim/')) return '/claim';
  if (pathname === '/credits/claim' || pathname.startsWith('/credits/claim/')) {
    return '/credits/claim';
  }
  return pathname;
}

function extractReferrerHost(request: Request): string | undefined {
  const rawReferrer = request.headers.get('referer')?.trim();
  if (!rawReferrer) return undefined;

  try {
    const referrer = new URL(rawReferrer);
    if (referrer.protocol !== 'http:' && referrer.protocol !== 'https:') return undefined;
    return referrer.hostname.toLowerCase().replace(/^www\./, '').slice(0, 120) || undefined;
  } catch {
    return undefined;
  }
}

async function buildVisitorId(
  request: Request,
  timestamp: number,
  secret?: string,
): Promise<string | undefined> {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip || !secret) {
    return undefined;
  }

  const encoder = new TextEncoder();
  const dayScope = new Date(timestamp).toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${dayScope}:${ip}`));
  const bytes = Array.from(new Uint8Array(signature));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function trackVisit(context: AppContext): Promise<void> {
  try {
    const request = context.request;
    const url = new URL(request.url);
    const cfData = (request as unknown as { cf?: Record<string, string> }).cf;
    const timestamp = Date.now();
    const userAgent = request.headers.get('user-agent') ?? '';
    const visitorSecret = context.env.VISITOR_NOTIFY_SECRET?.trim()
      || context.env.SESSION_SECRET?.trim();
    const visitorId = await buildVisitorId(request, timestamp, visitorSecret);

    const entry: VisitEntry = {
      browser: classifyBrowser(userAgent),
      country: sanitizeCountry(cfData?.country),
      device: classifyDevice(userAgent),
      os: classifyOs(userAgent),
      path: sanitizeVisitPath(url.pathname),
      referrerHost: extractReferrerHost(request),
      ts: timestamp,
      visitorId,
    };

    // Store newest-first keys so polling clients can read the latest visits efficiently.
    const key = buildVisitKey(entry.ts);
    await context.env.KV.put(key, '', {
      expirationTtl: VISIT_RETENTION_TTL_SECONDS,
      metadata: entry,
    });
  } catch {
    // Never let tracking break the request
  }
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  context.data.requestId = buildRequestId(context.request);
  context.data.guestUser = null;
  context.data.user = null;

  try {
    context.data.user = await loadUserFromSession(context.request, context.env);
  } catch (error) {
    if (error instanceof ReviewerAccessRevokedError) {
      const headers = new Headers();
      await clearAuthCookies(headers, context.request);
      return withHeaders(json({ error: 'reviewer_access_revoked' }, { status: 403, headers }), context.request);
    }
    context.data.user = null;
  }

  let guestSetCookie: string | null = null;
  const pathname = new URL(context.request.url).pathname;
  // The review identity may only reach routes pinned to a separately capped
  // Kie credential and a dedicated Kie-only kernel. Other paid adapters remain
  // inaccessible, including video, audio and preproduction routes.
  if (context.data.user?.reviewer && pathname.startsWith('/api/')) {
    const reviewReady = Boolean(context.env.KIEAI_REVIEW_API_KEY?.trim()
      && context.env.KERNEL_REVIEW_ORIGIN?.trim()
      && context.env.KERNEL_REVIEW_ORIGIN?.trim() !== context.env.KERNEL_ORIGIN?.trim());
    const publicAuthRoute = ['/api/auth/logout', '/api/auth/reviewer', '/api/auth/callback']
      .includes(pathname);
    const reviewRoute = ['/api/me', '/api/billing/summary', '/api/ai/chat'].includes(pathname)
      || pathname.startsWith('/api/kernel/normal/');
    if (!publicAuthRoute && !(reviewReady && reviewRoute)) {
      return withHeaders(json({
        error: 'reviewer_provider_budget_unavailable',
        message: 'This route is unavailable to the isolated review account.',
      }, { status: 503 }), context.request);
    }
  }
  const needsGuestAiAccess = pathname === '/api/me'
    || pathname === '/api/billing/summary'
    || pathname === '/api/direct-codex/ws'
    || pathname.startsWith('/api/ai/')
    || (
      pathname.startsWith('/api/kernel/normal/')
      && !pathname.startsWith('/api/kernel/normal/service/')
    );
  if (!context.data.user && needsGuestAiAccess) {
    try {
      // `null` means no guest identity may be minted for this request (no
      // attributable address, or the per-address budget is exhausted); the
      // route then answers as it does for any anonymous caller.
      const guest = await ensureGuestAccess(context.env, context.request);
      context.data.guestUser = guest?.user ?? null;
      guestSetCookie = guest?.setCookie ?? null;
    } catch {
      context.data.guestUser = null;
    }
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

  const response = await context.next();
  const responseWithGuestCookie = guestSetCookie
    ? new Response(response.body, {
        headers: (() => {
          const headers = new Headers(response.headers);
          headers.append('Set-Cookie', guestSetCookie);
          return headers;
        })(),
        status: response.status,
        statusText: response.statusText,
      })
    : response;

  if (isUnknownPageFallback(context.request, responseWithGuestCookie)) {
    return withHeaders(new Response(context.request.method === 'HEAD' ? null : 'Not Found', {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=UTF-8',
      },
      status: 404,
    }), context.request);
  }

  // Track valid page visits in background (non-blocking)
  if (shouldTrackVisit(context.request, responseWithGuestCookie)) {
    context.waitUntil(trackVisit(context));
  }

  return withHeaders(responseWithGuestCookie, context.request);
};
