import type { Env } from './env';
import { getBillingPlan, type BillingPlanId } from './entitlements';

export interface StripeConfig {
  apiBase: string;
  secretKey: string;
  webhookSecret: string | null;
}

export interface StripeCheckoutSessionInput {
  cancelUrl: string;
  clientReferenceId?: string | null;
  customerEmail?: string | null;
  customerId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, string | undefined>;
  mode?: 'subscription' | 'payment';
  priceId: string;
  quantity?: number;
  subscriptionMetadata?: Record<string, string | undefined>;
  successUrl: string;
}

export interface StripePortalSessionInput {
  customerId: string;
  idempotencyKey?: string | null;
  returnUrl: string;
}

export interface StripeWebhookEvent<TData = Record<string, unknown>> {
  api_version?: string;
  created?: number;
  data: {
    object: TData;
  };
  id: string;
  livemode?: boolean;
  pending_webhooks?: number;
  request?: {
    id?: string | null;
    idempotency_key?: string | null;
  };
  type: string;
}

export interface StripeCustomerLike {
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface StripeSubscriptionLike {
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  current_period_start?: number;
  customer?: string | StripeCustomerLike;
  id?: string;
  items?: {
    data?: Array<{
      plan?: string | StripePriceLike | null;
      price?: string | StripePriceLike | null;
    }> | null;
  } | null;
  metadata?: Record<string, unknown>;
  status?: string;
}

export interface StripeCheckoutSessionLike {
  client_reference_id?: string | null;
  customer?: string | StripeCustomerLike | null;
  customer_email?: string | null;
  id?: string;
  metadata?: Record<string, unknown>;
  subscription?: string | StripeSubscriptionLike | null;
}

export interface StripeInvoiceLike {
  amount_paid?: number;
  customer?: string | StripeCustomerLike | null;
  id?: string;
  metadata?: Record<string, unknown>;
  subscription?: string | StripeSubscriptionLike | string | null;
}

export interface StripePriceLike {
  id?: string;
}

function trimToNull(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvValue(env: Env, key: string): string | null {
  return trimToNull((env as Env & Record<string, string | undefined>)[key] ?? null);
}

export function getStripeConfig(env: Env): StripeConfig | null {
  const secretKey = trimToNull(env.STRIPE_SECRET_KEY);
  if (!secretKey) {
    return null;
  }

  return {
    apiBase: 'https://api.stripe.com/v1',
    secretKey,
    webhookSecret: trimToNull(env.STRIPE_WEBHOOK_SECRET),
  };
}

export function getStripePriceId(env: Env, planId: BillingPlanId | string): string | null {
  if (typeof planId === 'string' && planId.startsWith('price_')) {
    return planId;
  }

  const normalized = getBillingPlan(planId).id;
  const envKeys: Record<BillingPlanId, string[]> = {
    free: [],
    starter: ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_ID_STARTER'],
    pro: ['STRIPE_PRICE_PRO', 'STRIPE_PRICE_ID_PRO', 'STRIPE_PRICE_ID'],
    studio: ['STRIPE_PRICE_STUDIO', 'STRIPE_PRICE_ID_STUDIO'],
  };

  for (const key of envKeys[normalized]) {
    const value = readEnvValue(env, key);
    if (value) {
      return value;
    }
  }

  return null;
}

async function stripeApiRequest<T>(
  config: StripeConfig,
  method: string,
  path: string,
  body?: URLSearchParams,
  idempotencyKey?: string | null,
): Promise<T> {
  const response = await fetch(`${config.apiBase}${path}`, {
    headers: {
      Authorization: `Basic ${btoa(`${config.secretKey}:`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    method,
    body: body?.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`stripe_api_error:${response.status}:${text.slice(0, 500)}`);
  }

  return text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
}

function appendObjectParams(params: URLSearchParams, prefix: string, value: Record<string, string | undefined> | undefined): void {
  if (!value) {
    return;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue == null) {
      continue;
    }

    params.set(`${prefix}[${key}]`, entryValue);
  }
}

export async function createStripeCheckoutSession(
  config: StripeConfig,
  input: StripeCheckoutSessionInput,
): Promise<{ id: string; url: string | null }> {
  const params = new URLSearchParams();
  const mode = input.mode ?? 'subscription';
  params.set('mode', mode);
  params.set('line_items[0][price]', input.priceId);
  params.set('line_items[0][quantity]', String(input.quantity ?? 1));
  params.set('success_url', input.successUrl);
  params.set('cancel_url', input.cancelUrl);

  if (input.clientReferenceId) {
    params.set('client_reference_id', input.clientReferenceId);
  }

  if (input.customerId) {
    params.set('customer', input.customerId);
  } else if (input.customerEmail) {
    params.set('customer_email', input.customerEmail);
  }

  appendObjectParams(params, 'metadata', input.metadata);
  if (mode === 'subscription') {
    appendObjectParams(params, 'subscription_data[metadata]', input.subscriptionMetadata);
  }

  return stripeApiRequest<{ id: string; url: string | null }>(
    config,
    'POST',
    '/checkout/sessions',
    params,
    input.idempotencyKey ?? null,
  );
}

export async function createStripePortalSession(
  config: StripeConfig,
  input: StripePortalSessionInput,
): Promise<{ id: string; url: string }> {
  const params = new URLSearchParams();
  params.set('customer', input.customerId);
  params.set('return_url', input.returnUrl);

  return stripeApiRequest<{ id: string; url: string }>(
    config,
    'POST',
    '/billing_portal/sessions',
    params,
    input.idempotencyKey ?? null,
  );
}

function normalizeStripePriceId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractStripePriceId(price: string | StripePriceLike | null | undefined): string | null {
  if (typeof price === 'string') {
    return normalizeStripePriceId(price);
  }

  return normalizeStripePriceId(price?.id);
}

export function getStripePriceIdFromSubscription(subscription: StripeSubscriptionLike | null | undefined): string | null {
  if (!subscription?.items?.data?.length) {
    return null;
  }

  for (const item of subscription.items.data) {
    const priceId = extractStripePriceId(item?.price) ?? extractStripePriceId(item?.plan);
    if (priceId) {
      return priceId;
    }
  }

  return null;
}

export function getBillingPlanIdFromStripePriceId(env: Env, priceId: string | null | undefined): BillingPlanId | null {
  const normalizedPriceId = normalizeStripePriceId(priceId);
  if (!normalizedPriceId) {
    return null;
  }

  const paidPlans: BillingPlanId[] = ['starter', 'pro', 'studio'];
  for (const planId of paidPlans) {
    if (getStripePriceId(env, planId) === normalizedPriceId) {
      return planId;
    }
  }

  return null;
}

export function getBillingPlanIdFromStripeSubscription(
  env: Env,
  subscription: StripeSubscriptionLike | null | undefined,
): BillingPlanId | null {
  const status = subscription?.status;
  if (status && status !== 'active' && status !== 'trialing') {
    return null;
  }

  return getBillingPlanIdFromStripePriceId(env, getStripePriceIdFromSubscription(subscription));
}

function hexFromBuffer(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return hexFromBuffer(signature);
}

function parseStripeSignatureHeader(header: string): { signatures: string[]; timestamp: number } | null {
  const values = header
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const timestampValue = values.find((part) => part.startsWith('t='));
  if (!timestampValue) {
    return null;
  }

  const timestamp = Number(timestampValue.slice(2));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  const signatures = values
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (signatures.length === 0) {
    return null;
  }

  return { signatures, timestamp };
}

export async function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string | null,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${payload}`;
  const expectedSignature = await hmacSha256(signedPayload, secret);
  return parsed.signatures.some((candidate) => candidate === expectedSignature);
}

export function getStripeCustomerIdFromObject(
  value: StripeCheckoutSessionLike | StripeSubscriptionLike | StripeInvoiceLike | StripeCustomerLike | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const customer = (value as StripeCheckoutSessionLike).customer;
  if (typeof customer === 'string') {
    return customer;
  }

  if (typeof customer !== 'string' && customer) {
    const customerObject = customer as StripeCustomerLike;
    if (typeof customerObject.id === 'string') {
      return customerObject.id;
    }
  }

  if (!('customer' in value)) {
    const customerObject = value as StripeCustomerLike;
    if (typeof customerObject.id === 'string' && customerObject.id.length > 0) {
      return customerObject.id;
    }
  }

  return null;
}

export function getStripeObjectMetadata(
  value: StripeCheckoutSessionLike | StripeSubscriptionLike | StripeInvoiceLike | StripeCustomerLike | null | undefined,
): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const metadata = (value as { metadata?: Record<string, unknown> }).metadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
}
