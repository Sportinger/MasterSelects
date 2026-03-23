import { ensureUserRecord, issueSessionCookie } from '../../lib/auth';
import { json, methodNotAllowed } from '../../lib/db';
import { isBillingPlanId, upsertEntitlementsForPlan, type BillingPlanId } from '../../lib/entitlements';
import type { AppContext, AppRouteHandler } from '../../lib/env';

/**
 * POST /api/auth/dev-login
 *
 * Development-only endpoint that instantly creates a dev user and issues a
 * session cookie — no email, no OAuth, no external providers needed.
 *
 * Body (all optional):
 *   { email?: string, plan?: "free"|"starter"|"pro"|"studio" }
 *
 * Security: returns 404 unless ENVIRONMENT=development.
 */

const DEV_EMAIL = 'dev@masterselects.local';

interface DevLoginBody {
  email?: string;
  plan?: string;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  // ── Gate: development only ────────────────────────────────────────
  if ((context.env.ENVIRONMENT ?? '').toLowerCase() !== 'development') {
    return new Response(null, { status: 404 });
  }

  // ── Gate: localhost origin only ───────────────────────────────────
  const origin = context.request.headers.get('Origin') ?? context.request.headers.get('Referer') ?? '';
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(origin);
  if (!isLocalhost) {
    return new Response(null, { status: 404 });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  let body: DevLoginBody = {};

  try {
    body = (await context.request.json()) as DevLoginBody;
  } catch {
    // empty body is fine — defaults apply
  }

  const email = (body.email?.trim().toLowerCase()) || DEV_EMAIL;
  const plan: BillingPlanId = isBillingPlanId(body.plan) ? body.plan : 'studio';

  // Create or reuse the dev user in D1
  const appVersion = context.request.headers.get('X-App-Version') ?? null;
  const user = await ensureUserRecord(context.env, {
    appVersion,
    displayName: 'Dev User',
    email,
    provider: 'magic_link',
    providerUserId: email,
  });

  // Set entitlements for the chosen plan
  await upsertEntitlementsForPlan(context.env.DB, user.id, plan, 'dev-login');

  // Issue session cookie
  const headers = new Headers();
  const session = await issueSessionCookie(context.env, headers, context.request, {
    email: user.email,
    plan,
    provider: 'magic_link',
    providerUserId: email,
    userId: user.id,
  });

  return json(
    {
      nextStep: 'session_issued',
      ok: true,
      plan,
      session: {
        authenticated: true,
        expiresAt: session.expiresAt,
        provider: 'dev',
      },
      user,
    },
    { headers, status: 200 },
  );
};
