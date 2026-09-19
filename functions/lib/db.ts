import type { AppContext, AppUser } from './env';

interface JsonOptions extends ResponseInit {
  headers?: HeadersInit;
}

export function json(data: unknown, init: JsonOptions = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    { allowed, error: 'method_not_allowed' },
    {
      headers: { Allow: allowed.join(', ') },
      status: 405,
    },
  );
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function matchesRequestOrigin(origin: string, request: Request): boolean {
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Strict same-origin check: the Origin header must be present and match.
 * Browsers always send it on cross-document POST fetches; scripts and curl
 * usually do not. Use it for credential-issuing routes and public forms.
 */
export function hasSameOriginHeader(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && matchesRequestOrigin(origin as string, request);
}

/**
 * Same-origin check for state-changing browser requests.
 *
 * Browsers attach Origin to every POST/PUT/PATCH/DELETE they issue (fetch,
 * keepalive, sendBeacon, form posts), so a missing header on such a request
 * is either a non-browser client or a privacy-stripped request. It is only
 * accepted when the browser itself vouches for the site relationship through
 * Sec-Fetch-Site. Safe methods pass without Origin because browsers omit it
 * on same-origin GETs.
 */
export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) {
    return matchesRequestOrigin(origin, request);
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const secFetchSite = request.headers.get('Sec-Fetch-Site')?.trim().toLowerCase();
  return secFetchSite === 'same-origin' || secFetchSite === 'none';
}

export function notImplemented(feature: string): Response {
  return json(
    {
      error: 'not_implemented',
      feature,
      message: 'This route is part of the hosted AI and billing foundation and is not implemented yet.',
    },
    { status: 501 },
  );
}

export async function parseJson<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function buildRequestId(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID();
}

export function getCurrentUser(context: AppContext): AppUser | null {
  return context.data.user ?? null;
}

export function getAiUser(context: AppContext): AppUser | null {
  return context.data.user ?? context.data.guestUser ?? null;
}

export function isGuestAiUser(context: AppContext): boolean {
  return !context.data.user && Boolean(context.data.guestUser);
}
