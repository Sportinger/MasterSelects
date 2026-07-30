import {
  clearAdminSessionCookie,
  isAdminConfigured,
  loadAdminSession,
} from '../../lib/adminAuth';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);

  const configured = isAdminConfigured(context.env);
  const session = configured
    ? await loadAdminSession(context.request, context.env).catch(() => null)
    : null;

  if (!session) {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    clearAdminSessionCookie(headers, context.request);
    return json({
      authenticated: false,
      configured,
    }, { headers, status: 401 });
  }

  return json({
    authenticated: true,
    configured: true,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  }, { headers: { 'Cache-Control': 'no-store' } });
};
