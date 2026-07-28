import { json, methodNotAllowed } from '../../../lib/db';
import type { AppRouteHandler } from '../../../lib/env';

/**
 * Kie requires a reachable callback URL even though MasterSelects uses polling
 * as its authoritative task state. Keep this endpoint deliberately stateless:
 * acknowledging callbacks prevents provider-side CALLBACK_EXCEPTION failures,
 * while record-info polling still handles retries, ordering, and project state.
 */
export const onRequest: AppRouteHandler = async (context): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { Allow: 'POST, OPTIONS' },
      status: 204,
    });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  try {
    const payload = await context.request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ ok: false, error: 'Invalid callback payload' }, { status: 400 });
    }
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  return json({ ok: true });
};
