import { loadSessionFromRequest } from '../../lib/auth';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  fetchTwitchChannelStats,
  isTwitchConfigured,
  type TwitchApiFailureResult,
} from '../../lib/twitchApi';

const RATE_LIMIT_TTL_SECONDS = 10;

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  const session = await loadSessionFromRequest(context.request, context.env).catch(() => null);
  if (!session || !context.data.user || context.data.user.id !== session.userId) {
    return noStoreJson({ error: 'authentication_required' }, { status: 401 });
  }

  if (!isTwitchConfigured(context.env)) {
    return noStoreJson({ configured: false });
  }

  const rateLimitKey = `twitch:stats:${session.userId}`;
  const limited = await context.env.KV.get(rateLimitKey).catch(() => null);
  if (limited !== null) {
    return noStoreJson({ error: 'rate_limited' }, { status: 429 });
  }
  await context.env.KV.put(rateLimitKey, '', { expirationTtl: RATE_LIMIT_TTL_SECONDS });

  const channel = new URL(context.request.url).searchParams.get('channel') ?? '';
  const result = await fetchTwitchChannelStats({
    clientId: context.env.TWITCH_CLIENT_ID!.trim(),
    clientSecret: context.env.TWITCH_CLIENT_SECRET!.trim(),
    kv: context.env.KV,
  }, channel);
  const status = isTwitchFailure(result) ? 502 : 200;
  return noStoreJson(result, { status });
};

function isTwitchFailure(result: unknown): result is TwitchApiFailureResult {
  return Boolean(result && typeof result === 'object' && 'error' in result && result.error === 'twitch_unavailable');
}

function noStoreJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return json(data, { ...init, headers });
}
