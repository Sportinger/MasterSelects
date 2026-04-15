import { json, methodNotAllowed } from '../../lib/db';
import { grantPlanCredits } from '../../lib/credits';
import {
  getBillingPlan,
  isBillingPlanId,
  planIdFromSubscriptionStatus,
  type BillingPlanId,
  upsertEntitlementsForPlan,
} from '../../lib/entitlements';
import {
  getBillingPlanIdFromStripeSubscription,
  getBillingPlanIdFromStripePriceId,
  getStripeConfig,
  getStripeCustomerIdFromObject,
  getStripeObjectMetadata,
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  getStripeSubscription,
  hasStripeScheduledCancellation,
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
  const periodStart = getStripeSubscriptionPeriodStart(subscription);
  const periodEnd = getStripeSubscriptionPeriodEnd(subscription);
  const cancelScheduled = hasStripeScheduledCancellation(subscription);

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
        periodStart ? new Date(periodStart * 1000).toISOString() : null,
        periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancelScheduled ? 1 : 0,
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

  const parentSubscriptionId = getString(invoice.parent?.subscription_details?.subscription);
  if (parentSubscriptionId) {
    return parentSubscriptionId;
  }

  return null;
}

interface SubscriptionPeriodWindow {
  end: number;
  start: number;
}

type StripeInvoiceLineLike = NonNullable<NonNullable<StripeInvoiceLike['lines']>['data']>[number];

interface InvoiceProrationPlanChange {
  fromPlanId: BillingPlanId;
  periodEnd: number;
  periodStart: number;
  subscriptionId: string;
  toPlanId: BillingPlanId;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function hasInvoiceProrationLines(invoice: StripeInvoiceLike): boolean {
  return Boolean(
    invoice.lines?.data?.some((line) => line?.parent?.subscription_item_details?.proration === true),
  );
}

function getInvoiceLinePlanId(env: AppContext['env'], line: StripeInvoiceLineLike): BillingPlanId | null {
  const metadata = isRecord(line?.metadata) ? line.metadata : {};
  const explicitPlanId = getExplicitPlanId(metadata);
  if (explicitPlanId) {
    return explicitPlanId;
  }

  return getBillingPlanIdFromStripePriceId(env, getString(line?.pricing?.price_details?.price));
}

export function extractInvoiceProrationPlanChange(
  env: AppContext['env'],
  invoice: StripeInvoiceLike,
): InvoiceProrationPlanChange | null {
  const prorationLines = invoice.lines?.data?.filter((line) => line?.parent?.subscription_item_details?.proration === true) ?? [];
  if (prorationLines.length === 0) {
    return null;
  }

  let fromLine: (typeof prorationLines)[number] | null = null;
  let toLine: (typeof prorationLines)[number] | null = null;

  for (const line of prorationLines) {
    const amount = getNumber(line?.amount) ?? 0;
    const planId = getInvoiceLinePlanId(env, line);
    if (!planId) {
      continue;
    }

    if (amount < 0 && (!fromLine || Math.abs(amount) > Math.abs(getNumber(fromLine.amount) ?? 0))) {
      fromLine = line;
    }

    if (amount > 0 && (!toLine || amount > (getNumber(toLine.amount) ?? 0))) {
      toLine = line;
    }
  }

  const fromPlanId = fromLine ? getInvoiceLinePlanId(env, fromLine) : null;
  const toPlanId = toLine ? getInvoiceLinePlanId(env, toLine) : null;
  const periodStart = getNumber(toLine?.period?.start);
  const periodEnd = getNumber(toLine?.period?.end);
  const subscriptionId =
    getString(toLine?.parent?.subscription_item_details?.subscription)
    ?? getString(fromLine?.parent?.subscription_item_details?.subscription)
    ?? getInvoiceSubscriptionId(invoice);

  if (!fromPlanId || !toPlanId || !periodStart || !periodEnd || !subscriptionId) {
    return null;
  }

  return {
    fromPlanId,
    periodEnd,
    periodStart,
    subscriptionId,
    toPlanId,
  };
}

async function getSubscriptionPeriodWindow(
  env: AppContext['env'],
  db: AppContext['env']['DB'],
  subscriptionId: string,
  requestId: string | null,
): Promise<SubscriptionPeriodWindow | null> {
  try {
    const local = await db
      .prepare(
        `
          SELECT current_period_start, current_period_end
          FROM subscriptions
          WHERE stripe_subscription_id = ?
          LIMIT 1
        `,
      )
      .bind(subscriptionId)
      .first<{ current_period_end: string | null; current_period_start: string | null }>();

    const localStart = parseIsoTimestamp(local?.current_period_start ?? null);
    const localEnd = parseIsoTimestamp(local?.current_period_end ?? null);
    if (localStart && localEnd && localEnd > localStart) {
      return { end: localEnd, start: localStart };
    }
  } catch {
    // Fall through to Stripe lookup.
  }

  const stripeConfig = getStripeConfig(env);
  if (!stripeConfig) {
    return null;
  }

  try {
    const subscription = await getStripeSubscription(stripeConfig, subscriptionId, requestId);
    const stripeStart = getStripeSubscriptionPeriodStart(subscription);
    const stripeEnd = getStripeSubscriptionPeriodEnd(subscription);
    if (stripeStart && stripeEnd && stripeEnd > stripeStart) {
      return { end: stripeEnd, start: stripeStart };
    }
  } catch {
    return null;
  }

  return null;
}

export function calculateProratedUpgradeCredits(
  fromPlanId: BillingPlanId,
  toPlanId: BillingPlanId,
  remainingPeriodStart: number,
  remainingPeriodEnd: number,
  subscriptionPeriodStart: number,
  subscriptionPeriodEnd: number,
): number {
  const baseDelta = getBillingPlan(toPlanId).monthlyCredits - getBillingPlan(fromPlanId).monthlyCredits;
  if (baseDelta <= 0) {
    return 0;
  }

  const remainingSeconds = remainingPeriodEnd - remainingPeriodStart;
  const totalSeconds = subscriptionPeriodEnd - subscriptionPeriodStart;
  if (remainingSeconds <= 0 || totalSeconds <= 0) {
    return 0;
  }

  const fraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  return Math.max(0, Math.min(baseDelta, Math.round(baseDelta * fraction)));
}

async function resolveProratedUpgradeCreditGrant(
  env: AppContext['env'],
  db: AppContext['env']['DB'],
  invoice: StripeInvoiceLike,
  requestId: string | null,
): Promise<null | {
  amount: number;
  fromPlanId: BillingPlanId;
  periodEnd: number;
  periodStart: number;
  subscriptionPeriodEnd: number;
  subscriptionPeriodStart: number;
  toPlanId: BillingPlanId;
}> {
  if (getString(invoice.billing_reason) !== 'subscription_update' || !hasInvoiceProrationLines(invoice)) {
    return null;
  }

  const change = extractInvoiceProrationPlanChange(env, invoice);
  if (!change) {
    throw new Error('proration_plan_change_unresolved');
  }

  const subscriptionWindow = await getSubscriptionPeriodWindow(env, db, change.subscriptionId, requestId);
  if (!subscriptionWindow) {
    throw new Error('subscription_period_window_unresolved');
  }

  return {
    amount: calculateProratedUpgradeCredits(
      change.fromPlanId,
      change.toPlanId,
      change.periodStart,
      change.periodEnd,
      subscriptionWindow.start,
      subscriptionWindow.end,
    ),
    fromPlanId: change.fromPlanId,
    periodEnd: change.periodEnd,
    periodStart: change.periodStart,
    subscriptionPeriodEnd: subscriptionWindow.end,
    subscriptionPeriodStart: subscriptionWindow.start,
    toPlanId: change.toPlanId,
  };
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

export function shouldGrantInvoiceCredits(invoice: StripeInvoiceLike): boolean {
  const billingReason = getString(invoice.billing_reason);
  if (billingReason === 'subscription_create' || billingReason === 'subscription_cycle') {
    return true;
  }

  const hasProrationLine = Boolean(
    invoice.lines?.data?.some((line) => line?.parent?.subscription_item_details?.proration === true),
  );
  if (hasProrationLine) {
    return false;
  }

  return billingReason == null;
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

async function lookupPlanIdFromSubscription(
  db: AppContext['env']['DB'],
  subscriptionId: string | null,
): Promise<BillingPlanId | null> {
  if (!subscriptionId) {
    return null;
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

    return row?.plan_id && isBillingPlanId(row.plan_id) ? row.plan_id : null;
  } catch {
    return null;
  }
}

function getExplicitPlanId(metadata: Record<string, unknown>): BillingPlanId | null {
  const planId = getMetadataString(metadata, 'plan_id');
  return planId && isBillingPlanId(planId) ? planId : null;
}

export async function resolveInvoicePlanId(
  env: AppContext['env'],
  db: AppContext['env']['DB'],
  invoice: StripeInvoiceLike,
  requestId: string | null,
): Promise<BillingPlanId | null> {
  const explicitPlanId = getExplicitPlanId(getStripeObjectMetadata(invoice));
  if (explicitPlanId) {
    return explicitPlanId;
  }

  const parentSubscriptionMetadata = isRecord(invoice.parent?.subscription_details?.metadata)
    ? invoice.parent.subscription_details.metadata
    : {};
  const parentPlanId = getExplicitPlanId(parentSubscriptionMetadata);
  if (parentPlanId) {
    return parentPlanId;
  }

  if (invoice.subscription && typeof invoice.subscription !== 'string') {
    const embeddedPlanId =
      getBillingPlanIdFromStripeSubscription(env, invoice.subscription)
      ?? getExplicitPlanId(getStripeObjectMetadata(invoice.subscription));
    if (embeddedPlanId) {
      return embeddedPlanId;
    }
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice);
  const localPlanId = await lookupPlanIdFromSubscription(db, subscriptionId);
  if (localPlanId) {
    return localPlanId;
  }

  const stripeConfig = getStripeConfig(env);
  if (!stripeConfig || !subscriptionId) {
    return null;
  }

  try {
    const subscription = await getStripeSubscription(stripeConfig, subscriptionId, requestId);
    return (
      getBillingPlanIdFromStripeSubscription(env, subscription)
      ?? getExplicitPlanId(getStripeObjectMetadata(subscription))
    );
  } catch {
    return null;
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
    let prorationGrant: Awaited<ReturnType<typeof resolveProratedUpgradeCreditGrant>> = null;
    try {
      prorationGrant = await resolveProratedUpgradeCreditGrant(
        context.env,
        context.env.DB,
        invoice,
        context.data.requestId ?? event.id,
      );
    } catch {
      return json(
        {
          error: 'proration_credit_resolution_failed',
          eventId: event.id,
          eventType: event.type,
          message: 'Unable to resolve prorated upgrade credits for paid invoice. Webhook should be retried.',
        },
        { status: 503 },
      );
    }

    if (prorationGrant?.amount && prorationGrant.amount > 0) {
      await grantPlanCredits(
        context.env.DB,
        userId,
        prorationGrant.amount,
        'stripe:invoice_paid_proration',
        getString(invoice.id) ?? event.id,
        {
          credit_delta_base: getBillingPlan(prorationGrant.toPlanId).monthlyCredits - getBillingPlan(prorationGrant.fromPlanId).monthlyCredits,
          from_plan_id: prorationGrant.fromPlanId,
          grant_type: 'upgrade_proration',
          period_end: prorationGrant.periodEnd,
          period_start: prorationGrant.periodStart,
          stripe_customer_id: getStripeCustomerIdFromObject(invoice),
          stripe_invoice_id: getString(invoice.id),
          subscription_period_end: prorationGrant.subscriptionPeriodEnd,
          subscription_period_start: prorationGrant.subscriptionPeriodStart,
          to_plan_id: prorationGrant.toPlanId,
        },
      );
    }

    if (!shouldGrantInvoiceCredits(invoice)) {
      await writeWebhookRecord(context.env.DB, event, payloadHash);

      return json({
        eventId: event.id,
        eventType: event.type,
        grantedCredits: Boolean(prorationGrant?.amount && prorationGrant.amount > 0),
        ok: true,
      });
    }

    const planId = await resolveInvoicePlanId(
      context.env,
      context.env.DB,
      invoice,
      context.data.requestId ?? event.id,
    );

    if (!planId) {
      return json(
        {
          error: 'plan_resolution_failed',
          eventId: event.id,
          eventType: event.type,
          message: 'Unable to resolve billing plan for paid invoice. Webhook should be retried.',
        },
        { status: 503 },
      );
    }

    await grantInvoiceCredits(context.env.DB, userId, invoice, planId);
  }

  await writeWebhookRecord(context.env.DB, event, payloadHash);

  return json({
    eventId: event.id,
    eventType: event.type,
    ok: true,
  });
};
