import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import { type BillingPlanId, normalizeBillingPlanId } from '../../lib/entitlements';
import { createStripeCheckoutSession, getStripeConfig, getStripePriceId } from '../../lib/stripe';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface CheckoutRequestBody {
  cancelUrl?: string;
  customerEmail?: string;
  metadata?: Record<string, string | undefined>;
  planId?: string;
  priceId?: string;
  quantity?: number;
  successUrl?: string;
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

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
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
  const priceId = body.priceId?.trim() || getStripePriceId(context.env, planId);
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
  const successUrl = body.successUrl?.trim() || `${origin}/?billing=success&plan=${encodeURIComponent(planId)}`;
  const cancelUrl = body.cancelUrl?.trim() || `${origin}/?billing=cancel`;
  const customerId = await getStripeCustomerId(context.env.DB, user.id);
  const quantity = Number.isFinite(body.quantity) ? Math.max(1, Math.floor(body.quantity ?? 1)) : 1;

  try {
    const session = await createStripeCheckoutSession(stripeConfig, {
      cancelUrl,
      clientReferenceId: user.id,
      customerEmail: customerId ? null : body.customerEmail?.trim() || user.email,
      customerId,
      metadata: {
        plan_id: planId,
        user_id: user.id,
        ...(body.metadata ?? {}),
      },
      priceId,
      quantity,
      subscriptionMetadata: {
        plan_id: planId,
        user_id: user.id,
      },
      successUrl,
    });

    return json({
      checkoutUrl: session.url,
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
