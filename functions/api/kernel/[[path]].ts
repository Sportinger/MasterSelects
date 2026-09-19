import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { tryHandleNormalPath } from '../../lib/hostedAgent/route';

const DEFAULT_KERNEL_ORIGIN = 'https://fassandra.de';
const FORWARD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
/** Largest request body relayed to the kernel (source bundles included). */
const MAX_FORWARD_BODY_BYTES = 40 * 1024 * 1024;

interface AllowedRoute {
  methods: string[];
  pattern: RegExp;
  requiresUser: boolean;
}

const ALLOWED_ROUTES: AllowedRoute[] = [
  { methods: ['GET'], pattern: /^health$/, requiresUser: false },
  { methods: ['POST'], pattern: /^preproduction\/seedance$/, requiresUser: true },
  { methods: ['GET', 'POST'], pattern: /^preproduction\/seedance\/source-frames$/, requiresUser: true },
  { methods: ['POST'], pattern: /^preproduction\/seedance\/runs$/, requiresUser: true },
  { methods: ['GET'], pattern: /^preproduction\/seedance\/runs\/[^/]+$/, requiresUser: true },
  { methods: ['GET'], pattern: /^preproduction\/seedance\/runs\/[^/]+\/events$/, requiresUser: true },
  { methods: ['POST'], pattern: /^preproduction\/seedance\/runs\/[^/]+\/(?:selection|cancel|resume)$/, requiresUser: true },
];

/**
 * Decodes the catch-all segments. Returns `null` for anything that could
 * change meaning once joined into the upstream URL: traversal segments,
 * double-encoded characters, decoded separators, and undecodable input.
 */
function resolvePath(context: AppContext): string | null {
  const raw = (context.params as Record<string, unknown>).path;
  const rawSegments = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split('/')
      : [];
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (!segment || segment === '.' || segment === '..' || /[%/\\]/.test(segment)) {
      return null;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

async function readForwardBody(request: Request): Promise<ArrayBuffer | null> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORWARD_BODY_BYTES) {
    return null;
  }
  const body = await request.arrayBuffer();
  return body.byteLength > MAX_FORWARD_BODY_BYTES ? null : body;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const path = resolvePath(context);
  if (path === null) {
    return json({ error: 'Invalid kernel route.' }, { status: 400 });
  }
  const normalPathResponse = await tryHandleNormalPath(context, path);
  if (normalPathResponse) {
    return normalPathResponse;
  }
  const route = ALLOWED_ROUTES.find((candidate) => candidate.pattern.test(path));
  if (!route) {
    return json({ error: 'Unknown kernel route.' }, { status: 404 });
  }
  if (!route.methods.includes(context.request.method)) {
    return methodNotAllowed(route.methods);
  }
  if (route.requiresUser && !context.data.user) {
    return json({ error: 'Sign in to use the kernel service.' }, { status: 401 });
  }

  const token = context.env.KERNEL_AUTH_TOKEN?.trim();
  if (!token) {
    return json({ error: 'Kernel service is not configured.' }, { status: 503 });
  }

  const origin = context.env.KERNEL_ORIGIN?.trim().replace(/\/+$/, '') || DEFAULT_KERNEL_ORIGIN;
  const headers: Record<string, string> = {
    Accept: context.request.headers.get('Accept') || 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (route.requiresUser && context.data.user) {
    headers['X-MasterSelects-Principal'] = context.data.user.id;
  }
  let forwardBody: ArrayBuffer | null = null;
  if (context.request.method !== 'GET') {
    forwardBody = await readForwardBody(context.request);
    if (!forwardBody) {
      return json({ error: 'Kernel request body is too large.' }, { status: 413 });
    }
    headers['Content-Type'] = 'application/json';
  }
  const forwardController = new AbortController();
  const abortForward = () => forwardController.abort();
  if (context.request.signal.aborted) {
    abortForward();
  } else {
    context.request.signal.addEventListener('abort', abortForward, { once: true });
  }
  const timeoutId = setTimeout(abortForward, FORWARD_TIMEOUT_MS);
  const init: RequestInit = {
    method: context.request.method,
    headers,
    signal: forwardController.signal,
    ...(forwardBody ? { body: forwardBody } : {}),
  };

  try {
    const requestUrl = new URL(context.request.url);
    const upstream = await fetch(`${origin}/kernel/${path}${requestUrl.search}`, init);
    const responseHeaders = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': upstream.headers.get('Cache-Control') || 'no-store',
    });
    for (const name of ['X-Accel-Buffering', 'X-Seedance-Next-Sequence', 'X-Seedance-Phase']) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return json({ error: 'Kernel service is unreachable.' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
    context.request.signal.removeEventListener('abort', abortForward);
  }
};
