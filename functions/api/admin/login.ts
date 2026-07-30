import {
  buildAdminSessionCookie,
  clearAdminLoginFailures,
  createAdminSession,
  getAdminLoginRetryAfter,
  hasAdminTrustedOrigin,
  isAdminConfigured,
  recordAdminLoginFailure,
  verifyAdminPassword,
} from '../../lib/adminAuth';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface AdminLoginBody {
  password?: unknown;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!hasAdminTrustedOrigin(context.request)) {
    return json({ error: 'invalid_origin', message: 'This login request was rejected.' }, { status: 403 });
  }
  if (!isAdminConfigured(context.env)) {
    return json({
      error: 'admin_not_configured',
      message: 'The admin portal is not configured yet.',
    }, { status: 503 });
  }

  const contentLength = Number(context.request.headers.get('content-length') ?? 0);
  if (contentLength > 4_096) {
    return json({ error: 'invalid_request', message: 'The login request is too large.' }, { status: 413 });
  }

  const retryAfter = await getAdminLoginRetryAfter(context.request, context.env);
  if (retryAfter > 0) {
    return json({
      error: 'rate_limited',
      message: 'Too many attempts. Try again later.',
      retryAfter,
    }, { headers: { 'Retry-After': String(retryAfter) }, status: 429 });
  }

  const body = await parseJson<AdminLoginBody>(context.request);
  const accepted = body && await verifyAdminPassword(context.env, body.password);
  if (!accepted) {
    const lockSeconds = await recordAdminLoginFailure(context.request, context.env);
    return json({
      error: 'invalid_credentials',
      message: lockSeconds > 0
        ? 'Too many attempts. Access is temporarily locked.'
        : 'The password is incorrect.',
      ...(lockSeconds > 0 ? { retryAfter: lockSeconds } : {}),
    }, {
      ...(lockSeconds > 0 ? { headers: { 'Retry-After': String(lockSeconds) } } : {}),
      status: lockSeconds > 0 ? 429 : 401,
    });
  }

  await clearAdminLoginFailures(context.request, context.env);
  const { cookieValue, session } = await createAdminSession(context.env);
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', buildAdminSessionCookie(context.request, cookieValue));
  return json({
    authenticated: true,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  }, { headers });
};
