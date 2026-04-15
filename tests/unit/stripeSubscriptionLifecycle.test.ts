import { describe, expect, it } from 'vitest';
import {
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  hasStripeScheduledCancellation,
  type StripeSubscriptionLike,
} from '../../functions/lib/stripe';

describe('stripe subscription lifecycle helpers', () => {
  it('falls back to subscription item periods when top-level period timestamps are absent', () => {
    const subscription: StripeSubscriptionLike = {
      items: {
        data: [
          {
            current_period_end: 1778839833,
            current_period_start: 1776247833,
          },
        ],
      },
      status: 'active',
    };

    expect(getStripeSubscriptionPeriodStart(subscription)).toBe(1776247833);
    expect(getStripeSubscriptionPeriodEnd(subscription)).toBe(1778839833);
  });

  it('treats cancel_at as a scheduled cancellation and uses it as a final fallback end date', () => {
    const subscription: StripeSubscriptionLike = {
      cancel_at: 1778839833,
      cancel_at_period_end: false,
      items: {
        data: [],
      },
      status: 'active',
    };

    expect(hasStripeScheduledCancellation(subscription)).toBe(true);
    expect(getStripeSubscriptionPeriodEnd(subscription)).toBe(1778839833);
  });
});
