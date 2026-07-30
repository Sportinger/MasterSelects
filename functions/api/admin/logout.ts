import {
  clearAdminSessionCookie,
  hasAdminTrustedOrigin,
  hasValidAdminCsrf,
  requireAdminSession,
} from '../../lib/adminAuth';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  const session = await requireAdminSession(context);
  if (!hasAdminTrustedOrigin(context.request) || !session || !hasValidAdminCsrf(context.request, session)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  clearAdminSessionCookie(headers, context.request);
  return json({ ok: true }, { headers });
};
