import { ensureUserRecord, isLocalDevelopmentRequest, issueSessionCookie } from '../../lib/auth';
import { json, methodNotAllowed } from '../../lib/db';
import { isBillingPlanId, upsertEntitlementsForPlan, type BillingPlanId } from '../../lib/entitlements';
import type { AppContext, AppRouteHandler } from '../../lib/env';

/**
 * POST /api/auth/dev-login
 *
 * Development-only endpoint that instantly creates a dev user and issues a
 * session cookie for local development.
 */

const DEV_EMAIL = 'dev@masterselects.local';

interface DevLoginBody {
  email?: string;
  plan?: string;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (!isLocalDevelopmentRequest(context.request, context.env)) {
    return new Response(null, { status: 404 });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  let body: DevLoginBody = {};

  try {
    body = (await context.request.json()) as DevLoginBody;
  } catch {
    // Empty body is fine.
  }

  const email = body.email?.trim().toLowerCase() || DEV_EMAIL;
  const plan: BillingPlanId = isBillingPlanId(body.plan) ? body.plan : 'studio';

  const appVersion = context.request.headers.get('X-App-Version') ?? null;
  const user = await ensureUserRecord(context.env, {
    appVersion,
    displayName: 'Dev User',
    email,
    provider: 'magic_link',
    providerUserId: email,
  });

  await upsertEntitlementsForPlan(context.env.DB, user.id, plan, 'dev-login');

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
