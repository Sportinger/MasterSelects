import { ensureUserRecord, isLocalDevelopmentRequest, issueSessionCookie } from '../../lib/auth';
import { grantPlanCredits } from '../../lib/credits';
import { json, methodNotAllowed } from '../../lib/db';
import {
  getBillingPlan,
  isBillingPlanId,
  upsertEntitlementsForPlan,
  type BillingPlanId,
} from '../../lib/entitlements';
import type { AppContext, AppD1Database, AppRouteHandler } from '../../lib/env';

/**
 * POST /api/auth/dev-login
 *
 * Development-only endpoint that instantly creates a dev user and issues a
 * session cookie for local development.
 */

const DEV_EMAIL = 'dev@masterselects.local';
const DEV_SUBSCRIPTION_PREFIX = 'dev-login:subscription:';
const DEV_CREDIT_GRANT_SOURCE = 'dev:plan_monthly_grant';

interface DevLoginBody {
  email?: string;
  plan?: string;
}

function getMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function upsertDevSubscription(db: AppD1Database, userId: string, plan: BillingPlanId): Promise<void> {
  const now = new Date();
  const currentPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const currentPeriodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const updatedAt = now.toISOString();
  const stripeSubscriptionId = `${DEV_SUBSCRIPTION_PREFIX}${userId}`;

  await db
    .prepare(
      `
        INSERT INTO subscriptions (
          id,
          user_id,
          stripe_subscription_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?)
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          user_id = excluded.user_id,
          plan_id = excluded.plan_id,
          status = 'active',
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = 0,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      stripeSubscriptionId,
      plan,
      currentPeriodStart,
      currentPeriodEnd,
      updatedAt,
    )
    .run();
}

async function grantDevPlanCredits(db: AppD1Database, userId: string, plan: BillingPlanId): Promise<void> {
  const billingPlan = getBillingPlan(plan);
  const monthlyCredits = billingPlan.monthlyCredits;

  if (monthlyCredits <= 0) {
    return;
  }

  const monthKey = getMonthKey();

  await grantPlanCredits(
    db,
    userId,
    monthlyCredits,
    DEV_CREDIT_GRANT_SOURCE,
    `${plan}:${monthKey}`,
    {
      grant_month: monthKey,
      grant_type: 'dev-login',
      plan_id: plan,
    },
  );
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

  await upsertDevSubscription(context.env.DB, user.id, plan);
  await upsertEntitlementsForPlan(context.env.DB, user.id, plan, 'dev-login');
  await grantDevPlanCredits(context.env.DB, user.id, plan);

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
