import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { tryHandleHostedAgent } from '../../lib/hostedAgent/route';

const DEFAULT_KERNEL_ORIGIN = 'https://fassandra.de';
// Story compiles include provider planning rounds plus the director run.
const FORWARD_TIMEOUT_MS = 240_000;

interface AllowedRoute {
  methods: string[];
  pattern: RegExp;
  requiresUser: boolean;
}

const ALLOWED_ROUTES: AllowedRoute[] = [
  { methods: ['GET'], pattern: /^health$/, requiresUser: false },
  { methods: ['POST'], pattern: /^compile$/, requiresUser: true },
  { methods: ['POST'], pattern: /^runs\/[A-Za-z0-9._:-]+\/complete$/, requiresUser: true },
];

function resolvePath(context: AppContext): string {
  const raw = (context.params as Record<string, unknown>).path;
  const decodeSegment = (value: unknown): string => {
    const text = String(value);
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  if (Array.isArray(raw)) {
    return raw.map(decodeSegment).join('/');
  }
  return typeof raw === 'string' ? decodeSegment(raw) : '';
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const path = resolvePath(context);
  const hostedAgentResponse = await tryHandleHostedAgent(context, path);
  if (hostedAgentResponse) {
    return hostedAgentResponse;
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
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = {
    method: context.request.method,
    headers,
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
  };
  if (context.request.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = await context.request.text();
  }

  try {
    const upstream = await fetch(`${origin}/kernel/${path}`, init);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({ error: 'Kernel service is unreachable.' }, { status: 502 });
  }
};
