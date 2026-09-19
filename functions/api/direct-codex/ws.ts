import { getAiUser, json } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { isAllowedRelayOrigin } from '../../lib/rtmp/guards';

const DEFAULT_KERNEL_ORIGIN = 'https://fassandra.de';

function directCodexUpstream(env: AppContext['env']): URL | null {
  const rawOrigin = env.KERNEL_ORIGIN?.trim() || DEFAULT_KERNEL_ORIGIN;
  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password) return null;
    return new URL('/kernel/direct-codex/ws', origin);
  } catch {
    return null;
  }
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const { request } = context;
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'websocket_upgrade_required' }, { status: 426 });
  }
  if (!isAllowedRelayOrigin(request.headers.get('Origin'), context.env)) {
    return json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  const principal = getAiUser(context);
  if (!principal) {
    return json({ error: 'authentication_required' }, { status: 401 });
  }

  const token = context.env.KERNEL_AUTH_TOKEN?.trim();
  const upstream = directCodexUpstream(context.env);
  if (!token || !upstream) {
    return json({ error: 'direct_codex_unavailable' }, { status: 503 });
  }

  try {
    return await fetch(upstream, {
      headers: {
        Authorization: `Bearer ${token}`,
        Upgrade: 'websocket',
        'X-MasterSelects-Principal': principal.id,
      },
      method: 'GET',
    });
  } catch {
    return json({ error: 'direct_codex_unreachable' }, { status: 502 });
  }
};
