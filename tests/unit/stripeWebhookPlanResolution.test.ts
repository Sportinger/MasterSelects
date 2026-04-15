import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveInvoicePlanId } from '../../functions/api/stripe/webhook';
import type { Env } from '../../functions/lib/env';
import type { StripeInvoiceLike } from '../../functions/lib/stripe';

function makeDb(firstResult: { plan_id: string } | null = null): Env['DB'] {
  const first = vi.fn(async () => firstResult);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    batch: vi.fn(),
    exec: vi.fn(),
    prepare,
  } as unknown as Env['DB'];
}

function makeEnv(db: Env['DB']): Env {
  return {
    DB: db,
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_STARTER: 'price_starter',
    STRIPE_PRICE_STUDIO: 'price_studio',
    STRIPE_SECRET_KEY: 'sk_test_123',
  };
}

describe('stripe webhook invoice plan resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves the plan from Stripe when invoice.paid arrives before the local subscription row', async () => {
    const db = makeDb(null);
    const env = makeEnv(db);
    const invoice: StripeInvoiceLike = {
      id: 'in_test',
      subscription: 'sub_test',
    };

    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(
        JSON.stringify({
          id: 'sub_test',
          items: {
            data: [{ price: { id: 'price_starter' } }],
          },
          status: 'active',
        }),
        { status: 200 },
      )
    )));

    await expect(resolveInvoicePlanId(env, db, invoice, 'req_1')).resolves.toBe('starter');
  });

  it('returns null instead of defaulting to pro when the plan cannot be resolved', async () => {
    const db = makeDb(null);
    const env = makeEnv(db);
    const invoice: StripeInvoiceLike = {
      id: 'in_test',
      subscription: 'sub_unknown',
    };

    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(
        JSON.stringify({
          id: 'sub_unknown',
          items: {
            data: [{ price: { id: 'price_unknown' } }],
          },
          status: 'active',
        }),
        { status: 200 },
      )
    )));

    await expect(resolveInvoicePlanId(env, db, invoice, 'req_2')).resolves.toBeNull();
  });

  it('resolves the plan from modern invoice.parent.subscription_details metadata', async () => {
    const db = makeDb(null);
    const env = makeEnv(db);
    const invoice: StripeInvoiceLike = {
      id: 'in_test_parent',
      parent: {
        subscription_details: {
          metadata: {
            plan_id: 'starter',
            user_id: 'user_123',
          },
          subscription: 'sub_parent',
        },
      },
    };

    await expect(resolveInvoicePlanId(env, db, invoice, 'req_3')).resolves.toBe('starter');
  });
});
