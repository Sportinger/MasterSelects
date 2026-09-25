import { clearCookie, issueSessionCookie } from '../../lib/auth';
import { hasSameOriginHeader, json, methodNotAllowed } from '../../lib/db';
import type { AppRouteHandler } from '../../lib/env';
import { buildRateLimitKey, consumeRateLimit, getClientIp, rateLimitedResponse } from '../../lib/rateLimit';
import { GUEST_ACCESS_COOKIE_NAME } from '../../lib/guestAccess';
import { verifyReviewerCredential } from '../../lib/reviewerAccess';
import { reviewerSignInPage } from '../../lib/reviewerSignInPage';

export const onRequest: AppRouteHandler = async context => {
  if (context.request.method === 'GET') return reviewerSignInPage();
  if (context.request.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
  if (!hasSameOriginHeader(context.request)) return json({ error: 'forbidden_origin' }, { status: 403 });
  const ip = getClientIp(context.request);
  if (!ip) return json({ error: 'unavailable' }, { status: 503 });
  const limit = await consumeRateLimit(context.env.KV,
    await buildRateLimitKey('reviewer-login', ip, context.env.SESSION_SECRET),
    { limit: 5, windowSeconds: 900 }, { onError: 'deny' });
  if (!limit.allowed) return rateLimitedResponse(limit);
  // Read with a byte limit before parsing, including requests without Content-Length.
  const reader = context.request.body?.getReader();
  if (!reader) return json({ error: 'invalid_credentials' }, { status: 401 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      return json({ error: 'request_too_large' }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const account = await verifyReviewerCredential(context.env.DB,
    form.get('account') ?? '', form.get('credential') ?? '');
  if (!account) return json({ error: 'invalid_credentials' }, { status: 401 });
  const headers = new Headers({ Location: '/editor', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  await issueSessionCookie(context.env, headers, context.request, {
    email: account.email, userId: account.id, provider: 'reviewer',
    providerUserId: account.credential_hash, plan: 'free', redirectTo: '/editor',
  });
  clearCookie(headers, GUEST_ACCESS_COOKIE_NAME, context.request);
  return new Response(null, { status: 303, headers });
};
