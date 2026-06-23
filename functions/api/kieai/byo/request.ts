import { hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../../lib/db';
import type { AppRouteHandler } from '../../../lib/env';

const KIEAI_BASE_URL = 'https://api.kie.ai';
const ALLOWED_ENDPOINTS = new Set([
  '/api/v1/chat/credit',
  '/api/v1/flux/kontext/generate',
  '/api/v1/flux/kontext/record-info',
  '/api/v1/generate/record-info',
  '/api/v1/generate/sounds',
  '/api/v1/jobs/createTask',
  '/api/v1/jobs/recordInfo',
  '/api/v1/runway/generate',
  '/api/v1/runway/record-detail',
  '/api/v1/veo/generate',
  '/api/v1/veo/record-info',
]);

interface KieAiByoRequestBody {
  body?: unknown;
  endpoint?: unknown;
  method?: unknown;
}

function getByoKieAiKey(request: Request): string | null {
  const value = request.headers.get('x-kieai-api-key')?.trim();
  return value || null;
}

function resolveAllowedKieAiUrl(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return null;
  }

  try {
    const target = new URL(endpoint, KIEAI_BASE_URL);
    const base = new URL(KIEAI_BASE_URL);

    if (target.origin !== base.origin || !ALLOWED_ENDPOINTS.has(target.pathname)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

export const onRequest: AppRouteHandler = async (context): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { Allow: 'POST, OPTIONS' },
      status: 204,
    });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST', 'OPTIONS']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json({ error: 'invalid_origin' }, { status: 403 });
  }

  const apiKey = getByoKieAiKey(context.request);
  if (!apiKey) {
    return json({ error: 'missing_kieai_key' }, { status: 401 });
  }

  const payload = await parseJson<KieAiByoRequestBody>(context.request);
  const target = resolveAllowedKieAiUrl(payload?.endpoint);
  const method = payload?.method === 'POST' ? 'POST' : payload?.method === 'GET' ? 'GET' : null;

  if (!payload || !target || !method) {
    return json({ error: 'invalid_kieai_proxy_request' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      body: method === 'POST' && payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method,
    });

    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
      },
      status: upstream.status,
    });
  } catch (error) {
    return json(
      {
        error: 'kieai_proxy_failed',
        message: error instanceof Error ? error.message : 'Failed to reach Kie.ai',
      },
      { status: 502 },
    );
  }
};
