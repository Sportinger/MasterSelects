import { getCurrentUser, hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import { type BillingPlanId, normalizeBillingPlanId } from '../../lib/entitlements';
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  getStripeConfig,
  getStripePriceId,
} from '../../lib/stripe';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface CheckoutRequestBody {
  cancelUrl?: string;
  planId?: string;
  successUrl?: string;
}

interface SubscriptionRow {
  plan_id: string;
  status: string;
}

/** Only allow redirect URLs that point back to our own origin. */
function safeUrl(candidate: string | undefined, origin: string, fallback: string): string {
  const trimmed = candidate?.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    return parsed.origin === origin ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

async function getStripeCustomerId(db: AppContext['env']['DB'], userId: string): Promise<string | null> {
  try {
    return (
      await db
        .prepare(
          `
            SELECT stripe_customer_id
            FROM stripe_customers
            WHERE user_id = ?
            LIMIT 1
        `,
        )
        .bind(userId)
        .first<{ stripe_customer_id: string }>()
    )?.stripe_customer_id ?? null;
  } catch {
    return null;
  }
}

async function getLatestSubscription(db: AppContext['env']['DB'], userId: string): Promise<SubscriptionRow | null> {
  try {
    return await db
      .prepare(
        `
          SELECT plan_id, status
          FROM subscriptions
          WHERE user_id = ?
          ORDER BY
            CASE status
              WHEN 'active' THEN 0
              WHEN 'trialing' THEN 1
              WHEN 'past_due' THEN 2
              WHEN 'incomplete' THEN 3
              WHEN 'paused' THEN 4
              WHEN 'canceled' THEN 5
              ELSE 6
            END,
            updated_at DESC
          LIMIT 1
      `,
      )
      .bind(userId)
      .first<SubscriptionRow>();
  } catch {
    return null;
  }
}

function hasManagedSubscription(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due' || status === 'incomplete' || status === 'paused';
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'forbidden_origin',
        message: 'Checkout requests must originate from the same site.',
      },
      { status: 403 },
    );
  }

  const user = getCurrentUser(context);
  if (!user) {
    return json(
      {
        error: 'auth_required',
        message: 'Checkout requires a signed-in user.',
      },
      { status: 401 },
    );
  }

  const body = (await parseJson<CheckoutRequestBody>(context.request)) ?? {};
  const stripeConfig = getStripeConfig(context.env);
  if (!stripeConfig) {
    return json(
      {
        error: 'stripe_unavailable',
        message: 'Stripe secret key is missing.',
      },
      { status: 503 },
    );
  }

  const planId = normalizeBillingPlanId(body.planId, 'pro' as BillingPlanId);
  const priceId = getStripePriceId(context.env, planId);
  if (!priceId) {
    return json(
      {
        error: 'stripe_price_missing',
        message: `No Stripe price configured for plan "${planId}".`,
        planId,
      },
      { status: 501 },
    );
  }

  const origin = new URL(context.request.url).origin;
  const successUrl = safeUrl(body.successUrl, origin, `${origin}/?billing=success&plan=${encodeURIComponent(planId)}`);
  const cancelUrl = safeUrl(body.cancelUrl, origin, `${origin}/?billing=cancel`);
  const [customerId, latestSubscription] = await Promise.all([
    getStripeCustomerId(context.env.DB, user.id),
    getLatestSubscription(context.env.DB, user.id),
  ]);

  try {
    if (customerId && hasManagedSubscription(latestSubscription?.status)) {
      const portal = await createStripePortalSession(stripeConfig, {
        customerId,
        idempotencyKey: context.data.requestId ?? null,
        returnUrl: origin,
      });

      return json({
        checkoutUrl: portal.url,
        destination: 'portal',
        id: portal.id,
        planId: normalizeBillingPlanId(latestSubscription?.plan_id, planId),
        priceId,
      });
    }

    const session = await createStripeCheckoutSession(stripeConfig, {
      cancelUrl,
      clientReferenceId: user.id,
      customerEmail: customerId ? null : user.email,
      customerId,
      idempotencyKey: context.data.requestId ?? null,
      metadata: {
        plan_id: planId,
        user_id: user.id,
      },
      priceId,
      subscriptionMetadata: {
        plan_id: planId,
        user_id: user.id,
      },
      successUrl,
    });

    return json({
      checkoutUrl: session.url,
      destination: 'checkout',
      id: session.id,
      planId,
      priceId,
    });
  } catch (error) {
    return json(
      {
        error: 'stripe_checkout_failed',
        message: error instanceof Error ? error.message : 'Stripe checkout session creation failed.',
      },
      { status: 502 },
    );
  }
};
