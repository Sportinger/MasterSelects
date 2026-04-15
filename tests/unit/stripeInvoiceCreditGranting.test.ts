import { describe, expect, it } from 'vitest';
import { shouldGrantInvoiceCredits } from '../../functions/api/stripe/webhook';
import type { StripeInvoiceLike } from '../../functions/lib/stripe';

describe('stripe invoice credit granting', () => {
  it('grants credits for the initial subscription invoice', () => {
    const invoice: StripeInvoiceLike = {
      billing_reason: 'subscription_create',
      id: 'in_create',
    };

    expect(shouldGrantInvoiceCredits(invoice)).toBe(true);
  });

  it('grants credits for subscription renewal invoices', () => {
    const invoice: StripeInvoiceLike = {
      billing_reason: 'subscription_cycle',
      id: 'in_cycle',
    };

    expect(shouldGrantInvoiceCredits(invoice)).toBe(true);
  });

  it('does not grant credits for prorated subscription updates', () => {
    const invoice: StripeInvoiceLike = {
      billing_reason: 'subscription_update',
      id: 'in_update',
      lines: {
        data: [
          {
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
