import { getCurrentUser, hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import { getBillingPlan, type BillingPlanId, normalizeBillingPlanId } from '../../lib/entitlements';
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  getStripeConfig,
  getStripePriceId,
  getStripeSubscription,
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
  stripe_subscription_id: string | null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
          SELECT plan_id, status, stripe_subscription_id
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

function isManagedPlanChange(currentPlanId: string | null | undefined, targetPlanId: BillingPlanId): boolean {
  if (targetPlanId === 'free') {
    return false;
  }

  return getBillingPlan(currentPlanId).id !== getBillingPlan(targetPlanId).id;
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
  const origin = new URL(context.request.url).origin;
  const successUrl = safeUrl(body.successUrl, origin, `${origin}/?billing=success&plan=${encodeURIComponent(planId)}`);
  const cancelUrl = safeUrl(body.cancelUrl, origin, `${origin}/?billing=cancel`);
  const [customerId, latestSubscription] = await Promise.all([
    getStripeCustomerId(context.env.DB, user.id),
    getLatestSubscription(context.env.DB, user.id),
  ]);
  const currentPlanId = normalizeBillingPlanId(latestSubscription?.plan_id, 'free');
  const activeManagedSubscription = Boolean(customerId && hasManagedSubscription(latestSubscription?.status));
  const priceId = planId === 'free' ? null : getStripePriceId(context.env, planId);

  if (!activeManagedSubscription && !priceId) {
    return json(
      {
        error: 'stripe_price_missing',
        message: `No Stripe price configured for plan "${planId}".`,
        planId,
      },
      { status: 501 },
    );
  }

  try {
    if (activeManagedSubscription && customerId) {
      const stripeSubscriptionId = getString(latestSubscription?.stripe_subscription_id);
      if (stripeSubscriptionId && planId === 'free') {
        const portal = await createStripePortalSession(stripeConfig, {
          customerId,
          flow: {
            afterCompletionReturnUrl: successUrl,
            subscriptionId: stripeSubscriptionId,
            type: 'subscription_cancel',
          },
          idempotencyKey: context.data.requestId ?? null,
          returnUrl: cancelUrl,
        });

        return json({
          checkoutUrl: portal.url,
          destination: 'portal',
          id: portal.id,
          planId,
          priceId,
        });
      }

      if (stripeSubscriptionId && isManagedPlanChange(currentPlanId, planId) && priceId) {
        const stripeSubscription = await getStripeSubscription(
          stripeConfig,
          stripeSubscriptionId,
          context.data.requestId ?? null,
        );
        const primaryItem = stripeSubscription.items?.data?.[0];
        const subscriptionItemId = getString(primaryItem?.id);
        if (subscriptionItemId) {
          const portal = await createStripePortalSession(stripeConfig, {
            customerId,
            flow: {
              afterCompletionReturnUrl: successUrl,
              itemId: subscriptionItemId,
              priceId,
              quantity: primaryItem?.quantity ?? null,
              subscriptionId: stripeSubscriptionId,
              type: 'subscription_update_confirm',
            },
            idempotencyKey: context.data.requestId ?? null,
            returnUrl: cancelUrl,
          });

          return json({
            checkoutUrl: portal.url,
            destination: 'portal',
            id: portal.id,
            planId,
            priceId,
          });
        }
      }

      const portal = await createStripePortalSession(stripeConfig, {
        customerId,
        idempotencyKey: context.data.requestId ?? null,
        returnUrl: origin,
      });

      return json({
        checkoutUrl: portal.url,
        destination: 'portal',
        id: portal.id,
        planId,
        priceId,
      });
    }

    if (!priceId) {
      return json(
        {
          error: 'stripe_price_missing',
          message: 'Selected plan is not available for checkout.',
        },
        { status: 500 },
      );
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
