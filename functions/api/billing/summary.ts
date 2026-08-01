import { getCurrentUser, json, methodNotAllowed } from '../../lib/db';
import { getCreditMeterReference, getCreditSummary } from '../../lib/credits';
import { getBillingPlan, getEntitlementSnapshot, listEntitlements, normalizeBillingPlanId, type BillingPlanId } from '../../lib/entitlements';
import { getUsageSummary } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface BillingSubscriptionRow {
  cancel_at_period_end: number;
  current_period_end: string | null;
  current_period_start: string | null;
  id: string;
  plan_id: string;
  status: string;
  stripe_subscription_id: string;
  updated_at: string;
  user_id: string;
}

interface BillingSummaryResponse {
  creditBalance: number;
  creditMeterReference: number;
  entitlements: Record<string, string>;
  hostedAIEnabled: boolean;
  plan: {
    id: BillingPlanId;
    label: string;
    monthlyCredits: number;
  };
  recentCredits: Array<{
    amount: number;
    balance_after: number;
    created_at: string;
    description: string | null;
    entry_type: string;
    id: string;
    source: string;
  }>;
  stripeCustomerId: string | null;
  subscription: null | {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
    id: string;
    planId: BillingPlanId;
    status: string;
    stripeSubscriptionId: string;
    updatedAt: string;
  };
  usage: {
    byFeature: Array<{
      completedCount: number;
      creditCost: number;
      feature: string;
      failedCount: number;
      pendingCount: number;
    }>;
    completedCount: number;
    creditCost: number;
    failedCount: number;
    pendingCount: number;
    since: string;
  };
  user: {
    avatarUrl: string | null;
    displayName: string;
    email: string;
    id: string;
  } | null;
}

async function safeFirst<T>(promise: Promise<T | null>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

async function getStripeCustomerId(db: AppContext['env']['DB'], userId: string): Promise<string | null> {
  return safeFirst(
    db
      .prepare(
        `
          SELECT stripe_customer_id
          FROM stripe_customers
          WHERE user_id = ?
          LIMIT 1
      `,
      )
      .bind(userId)
      .first<{ stripe_customer_id: string }>(),
  ).then((row) => row?.stripe_customer_id ?? null);
}

async function getUserProfile(context: AppContext): Promise<BillingSummaryResponse['user']> {
  const currentUser = getCurrentUser(context);
  if (!currentUser) {
    return null;
  }

  const row = await safeFirst(
    context.env.DB
      .prepare(
        `
          SELECT id, email, display_name, avatar_url
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        )
        .bind(currentUser.id)
        .first<{
          avatar_url: string | null;
          display_name: string | null;
          email: string;
          id: string;
        }>(),
  );

  return {
    avatarUrl: row?.avatar_url ?? null,
    displayName: row?.display_name?.trim() || currentUser.email,
    email: row?.email ?? currentUser.email,
    id: row?.id ?? currentUser.id,
  };
}

async function getLatestSubscription(db: AppContext['env']['DB'], userId: string): Promise<BillingSubscriptionRow | null> {
  return safeFirst(
    db
      .prepare(
        `
          SELECT id, user_id, stripe_subscription_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, updated_at
          FROM subscriptions
          WHERE user_id = ?
          ORDER BY
            CASE status
              WHEN 'active' THEN 0
              WHEN 'trialing' THEN 1
              WHEN 'past_due' THEN 2
              WHEN 'incomplete' THEN 3
              WHEN 'canceled' THEN 4
              ELSE 5
            END,
            updated_at DESC
          LIMIT 1
        `,
      )
      .bind(userId)
      .first<BillingSubscriptionRow>(),
  );
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  const currentUser = getCurrentUser(context);
  if (!currentUser) {
    const emptySummary: BillingSummaryResponse = {
      creditBalance: 0,
      creditMeterReference: 0,
      entitlements: {},
      hostedAIEnabled: false,
      plan: {
        id: 'free',
        label: getBillingPlan('free').label,
        monthlyCredits: 0,
      },
      recentCredits: [],
      stripeCustomerId: null,
      subscription: null,
      usage: {
        byFeature: [],
        completedCount: 0,
        creditCost: 0,
        failedCount: 0,
        pendingCount: 0,
        since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      user: null,
    };

    return json(emptySummary);
  }

  const [user, stripeCustomerId, subscription, entitlementRows, creditSummary, usageSummary] = await Promise.all([
    getUserProfile(context),
    getStripeCustomerId(context.env.DB, currentUser.id),
    getLatestSubscription(context.env.DB, currentUser.id),
    listEntitlements(context.env.DB, currentUser.id),
    getCreditSummary(context.env.DB, currentUser.id, 10),
    getUsageSummary(context.env.DB, currentUser.id, Number(new URL(context.request.url).searchParams.get('windowDays') ?? 30)),
  ]);

  const planId = normalizeBillingPlanId(subscription?.plan_id, 'free');
  const snapshot = getEntitlementSnapshot(planId, entitlementRows);
  const subscriptionPlan = getBillingPlan(planId);
  const creditMeterReference = await getCreditMeterReference(context.env.DB, currentUser.id, {
    balance: creditSummary.balance,
    epochStart: subscription?.current_period_start,
    monthlyCredits: subscriptionPlan.monthlyCredits,
  });

  const response: BillingSummaryResponse = {
    creditBalance: creditSummary.balance,
    creditMeterReference,
    entitlements: snapshot.values,
    hostedAIEnabled: snapshot.hostedAIEnabled,
    plan: {
      id: subscriptionPlan.id,
      label: subscriptionPlan.label,
      monthlyCredits: subscriptionPlan.monthlyCredits,
    },
    recentCredits: creditSummary.recentEntries.map((entry) => ({
      amount: entry.amount,
      balance_after: entry.balance_after,
      created_at: entry.created_at,
      description: entry.description,
      entry_type: entry.entry_type,
      id: entry.id,
      source: entry.source,
    })),
    stripeCustomerId,
    subscription: subscription
      ? {
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
          currentPeriodEnd: subscription.current_period_end,
          currentPeriodStart: subscription.current_period_start,
          id: subscription.id,
          planId,
          status: subscription.status,
          stripeSubscriptionId: subscription.stripe_subscription_id,
          updatedAt: subscription.updated_at,
        }
      : null,
    usage: usageSummary,
    user,
  };

  return json(response);
};
