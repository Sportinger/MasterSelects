import { json, methodNotAllowed } from '../../lib/db';
import { grantPlanCredits } from '../../lib/credits';
import {
  getBillingPlan,
  normalizeBillingPlanId,
  planIdFromSubscriptionStatus,
  type BillingPlanId,
  upsertEntitlementsForPlan,
} from '../../lib/entitlements';
import {
  getBillingPlanIdFromStripeSubscription,
  getStripeConfig,
  getStripeCustomerIdFromObject,
  getStripeObjectMetadata,
  type StripeCheckoutSessionLike,
  type StripeInvoiceLike,
  type StripeSubscriptionLike,
  type StripeWebhookEvent,
  verifyStripeWebhookSignature,
} from '../../lib/stripe';
import type { AppContext, AppRouteHandler } from '../../lib/env';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  return getString(metadata[key]);
}

async function hashPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function findUserIdForCustomer(db: AppContext['env']['DB'], customerId: string | null): Promise<string | null> {
  if (!customerId) {
    return null;
  }

  try {
    return (
      await db
        .prepare(
          `
            SELECT user_id
            FROM stripe_customers
            WHERE stripe_customer_id = ?
            LIMIT 1
          `,
        )
        .bind(customerId)
        .first<{ user_id: string }>()
    )?.user_id ?? null;
  } catch {
    return null;
  }
}

async function findUserIdByEmail(db: AppContext['env']['DB'], email: string | null): Promise<string | null> {
  if (!email) {
    return null;
  }

  try {
    return (
      await db
        .prepare(
          `
            SELECT id
            FROM users
            WHERE email = ?
            LIMIT 1
          `,
        )
        .bind(email)
        .first<{ id: string }>()
    )?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveUserId(
  db: AppContext['env']['DB'],
  eventObject: Record<string, unknown>,
  fallbackCustomerId: string | null,
): Promise<string | null> {
  const metadata = isRecord(eventObject.metadata) ? eventObject.metadata : {};
  const metadataUserId = getMetadataString(metadata, 'user_id') ?? getMetadataString(metadata, 'userId');
  if (metadataUserId) {
    return metadataUserId;
  }

  const clientReferenceId = getString(eventObject.client_reference_id);
  if (clientReferenceId) {
    return clientReferenceId;
  }

  const customerId = fallbackCustomerId ?? getString(eventObject.customer) ?? getString(eventObject.customer_id) ?? null;
  const customerUserId = await findUserIdForCustomer(db, customerId);
  if (customerUserId) {
    return customerUserId;
  }

  const email = getString(eventObject.customer_email) ?? getString(eventObject.email);
  return findUserIdByEmail(db, email);
}

async function linkStripeCustomer(
  db: AppContext['env']['DB'],
  userId: string,
  customerId: string | null,
): Promise<void> {
  if (!customerId) {
    return;
  }

  try {
    await db
      .prepare(
        `
          INSERT INTO stripe_customers (user_id, stripe_customer_id)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            stripe_customer_id = excluded.stripe_customer_id
        `,
      )
      .bind(userId, customerId)
      .run();
  } catch {
    // Keep webhook processing resilient if the customer row already exists elsewhere.
  }
}

async function upsertSubscription(
  env: AppContext['env'],
  userId: string,
  subscription: StripeSubscriptionLike,
): Promise<BillingPlanId> {
  const db = env.DB;
  const customerId = getStripeCustomerIdFromObject(subscription);
  const metadata = getStripeObjectMetadata(subscription);
  const metadataPlanId = getMetadataString(metadata, 'plan_id');
  const planId =
    getBillingPlanIdFromStripeSubscription(env, subscription)
    ?? planIdFromSubscriptionStatus(subscription.status, metadataPlanId);
  const now = new Date().toISOString();
  const stripeSubscriptionId = getString(subscription.id) ?? crypto.randomUUID();

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
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          user_id = excluded.user_id,
          plan_id = excluded.plan_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      stripeSubscriptionId,
      planId,
      subscription.status ?? 'incomplete',
      subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
      subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      subscription.cancel_at_period_end ? 1 : 0,
      now,
      now,
    )
    .run();

  await upsertEntitlementsForPlan(db, userId, planId, `stripe:subscription:${stripeSubscriptionId}`);
  await linkStripeCustomer(db, userId, customerId);

  return planId;
}

function getInvoiceSubscriptionId(invoice: StripeInvoiceLike): string | null {
  if (typeof invoice.subscription === 'string') {
    return invoice.subscription;
  }

  if (invoice.subscription && typeof invoice.subscription.id === 'string') {
    return invoice.subscription.id;
  }

  return null;
}

async function grantInvoiceCredits(
  db: AppContext['env']['DB'],
  userId: string,
  invoice: StripeInvoiceLike,
  planId: BillingPlanId,
): Promise<void> {
  const plan = getBillingPlan(planId);
  if (plan.monthlyCredits <= 0) {
    return;
  }

  const invoiceId = getString(invoice.id);
  if (!invoiceId) {
    return;
  }

  await grantPlanCredits(db, userId, plan.monthlyCredits, 'stripe:invoice_paid', invoiceId, {
    plan_id: planId,
    stripe_customer_id: getStripeCustomerIdFromObject(invoice),
    stripe_invoice_id: invoiceId,
  });
}

async function writeWebhookRecord(
  db: AppContext['env']['DB'],
  event: StripeWebhookEvent,
  payloadHash: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `
          INSERT INTO webhook_events (id, provider, event_id, event_type, payload_hash)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind(crypto.randomUUID(), 'stripe', event.id, event.type, payloadHash)
      .run();
  } catch {
    // Idempotency is already protected by the ledger and upsert helpers.
  }
}

async function lookupPlanIdFromSubscription(db: AppContext['env']['DB'], subscriptionId: string | null): Promise<BillingPlanId> {
  if (!subscriptionId) {
    return 'pro';
  }

  try {
    const row = await db
      .prepare(
        `
          SELECT plan_id
          FROM subscriptions
          WHERE stripe_subscription_id = ?
          LIMIT 1
        `,
      )
      .bind(subscriptionId)
      .first<{ plan_id: string }>();

    return normalizeBillingPlanId(row?.plan_id, 'pro');
  } catch {
    return 'pro';
  }
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  const stripeConfig = getStripeConfig(context.env);
  if (!stripeConfig?.webhookSecret) {
    return json(
      {
        error: 'stripe_unavailable',
        message: 'Stripe webhook secret is missing.',
      },
      { status: 503 },
    );
  }

  const payload = await context.request.text();
  const signature = context.request.headers.get('Stripe-Signature');
  const isValid = await verifyStripeWebhookSignature(payload, signature, stripeConfig.webhookSecret);
  if (!isValid) {
    return json(
      {
        error: 'invalid_signature',
        message: 'Stripe webhook signature verification failed.',
      },
      { status: 400 },
    );
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(payload) as StripeWebhookEvent;
  } catch {
    return json(
      {
        error: 'invalid_payload',
        message: 'Webhook payload is not valid JSON.',
      },
      { status: 400 },
    );
  }

  if (!event?.id || !event?.type || !event?.data || !isRecord(event.data.object)) {
    return json(
      {
        error: 'invalid_event',
        message: 'Stripe webhook event is missing required fields.',
      },
      { status: 400 },
    );
  }

  const payloadHash = await hashPayload(payload);
  const existing = await context.env.DB
    .prepare(
      `
        SELECT id
        FROM webhook_events
        WHERE provider = 'stripe' AND event_id = ?
        LIMIT 1
      `,
    )
    .bind(event.id)
    .first<{ id: string }>();

  if (existing) {
    return json({
      duplicate: true,
      eventId: event.id,
      eventType: event.type,
      ok: true,
    });
  }

  const eventObject = event.data.object;
  const customerId = getStripeCustomerIdFromObject(eventObject as StripeCheckoutSessionLike | StripeSubscriptionLike | StripeInvoiceLike);
  const userId = await resolveUserId(context.env.DB, eventObject, customerId);

  if (event.type === 'checkout.session.completed' && userId) {
    await linkStripeCustomer(context.env.DB, userId, customerId);
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscriptionUserId = userId ?? (await findUserIdForCustomer(context.env.DB, customerId));
    if (subscriptionUserId) {
      await upsertSubscription(context.env, subscriptionUserId, eventObject as StripeSubscriptionLike);
    }
  }

  if (event.type === 'invoice.paid' && userId) {
    const invoice = eventObject as StripeInvoiceLike;
    const metadata = getStripeObjectMetadata(invoice);
    const subscriptionId = getInvoiceSubscriptionId(invoice);
    const explicitPlanId = getMetadataString(metadata, 'plan_id');
    const planId = explicitPlanId ? normalizeBillingPlanId(explicitPlanId, 'pro') : await lookupPlanIdFromSubscription(context.env.DB, subscriptionId);

    await grantInvoiceCredits(context.env.DB, userId, invoice, planId);
  }

  await writeWebhookRecord(context.env.DB, event, payloadHash);

  return json({
    eventId: event.id,
    eventType: event.type,
    ok: true,
  });
};
