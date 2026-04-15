import { describe, expect, it } from 'vitest';
import {
  calculateProratedUpgradeCredits,
  extractInvoiceProrationPlanChange,
  shouldGrantInvoiceCredits,
} from '../../functions/api/stripe/webhook';
import type { Env } from '../../functions/lib/env';
import type { StripeInvoiceLike } from '../../functions/lib/stripe';

function makeEnv(): Env {
  return {
    DB: {} as Env['DB'],
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_STARTER: 'price_starter',
    STRIPE_PRICE_STUDIO: 'price_studio',
    STRIPE_SECRET_KEY: 'sk_test_123',
  };
}

describe('stripe proration credit grants', () => {
  it('extracts the old and new plans from proration invoice lines', () => {
    const invoice: StripeInvoiceLike = {
      billing_reason: 'subscription_update',
      id: 'in_proration',
      lines: {
        data: [
          {
            amount: -487,
            parent: {
              subscription_item_details: {
                proration: true,
                subscription: 'sub_123',
              },
            },
            period: {
              end: 1778839833,
              start: 1776261700,
            },
            pricing: {
              price_details: {
                price: 'price_starter',
              },
            },
          },
          {
            amount: 1482,
            parent: {
              subscription_item_details: {
                proration: true,
                subscription: 'sub_123',
              },
            },
            period: {
              end: 1778839833,
              start: 1776261700,
            },
            pricing: {
              price_details: {
                price: 'price_pro',
              },
            },
          },
        ],
      },
    };

    expect(extractInvoiceProrationPlanChange(makeEnv(), invoice)).toEqual({
      fromPlanId: 'starter',
      periodEnd: 1778839833,
      periodStart: 1776261700,
      subscriptionId: 'sub_123',
      toPlanId: 'pro',
    });
  });

  it('calculates a rounded proportional top-up from the remaining billing window', () => {
    const amount = calculateProratedUpgradeCredits(
      'starter',
      'pro',
      1776261700,
      1778839833,
      1776247833,
      1778839833,
    );

    expect(amount).toBe(8952);
  });

  it('skips full monthly grants for subscription update proration invoices', () => {
    const invoice: StripeInvoiceLike = {
      billing_reason: 'subscription_update',
      id: 'in_proration',
      lines: {
        data: [
          {
            amount: 1482,
            parent: {
              subscription_item_details: {
                proration: true,
              },
            },
          },
        ],
      },
    };

    expect(shouldGrantInvoiceCredits(invoice)).toBe(false);
  });
});
