import { getCurrentUser, hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import { createStripePortalSession, getStripeConfig } from '../../lib/stripe';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface PortalRequestBody {
  returnUrl?: string;
}

/** Only allow redirect URLs that point back to our own origin. */
function safeReturnUrl(candidate: string | undefined, origin: string): string {
  const trimmed = candidate?.trim();
  if (!trimmed) return origin;
  try {
    const parsed = new URL(trimmed);
    return parsed.origin === origin ? trimmed : origin;
  } catch {
    return origin;
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

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'forbidden_origin',
        message: 'Billing portal requests must originate from the same site.',
      },
      { status: 403 },
    );
  }

  const user = getCurrentUser(context);
  if (!user) {
    return json(
      {
        error: 'auth_required',
        message: 'Billing portal requires a signed-in user.',
      },
      { status: 401 },
    );
  }

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

  const body = (await parseJson<PortalRequestBody>(context.request)) ?? {};
  const customerId = await getStripeCustomerId(context.env.DB, user.id);
  if (!customerId) {
    return json(
      {
        error: 'stripe_customer_missing',
        message: 'No Stripe customer is linked to this account yet.',
      },
      { status: 404 },
    );
  }

  const origin = new URL(context.request.url).origin;
  const returnUrl = safeReturnUrl(body.returnUrl, origin);

  try {
    const session = await createStripePortalSession(stripeConfig, {
      customerId,
      idempotencyKey: context.data.requestId ?? null,
      returnUrl,
    });

    return json({
      id: session.id,
      portalUrl: session.url,
    });
  } catch (error) {
    return json(
      {
        error: 'stripe_portal_failed',
        message: error instanceof Error ? error.message : 'Stripe billing portal creation failed.',
      },
      { status: 502 },
    );
  }
};
