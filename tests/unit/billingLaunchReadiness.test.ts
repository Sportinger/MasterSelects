import { describe, expect, it } from 'vitest';
import { isLocalDevelopmentRequest } from '../../functions/lib/auth';
import { hasTrustedOrigin } from '../../functions/lib/db';
import { planIdFromSubscriptionStatus } from '../../functions/lib/entitlements';
import {
  getBillingPlanIdFromStripePriceId,
  getBillingPlanIdFromStripeSubscription,
  type StripeSubscriptionLike,
} from '../../functions/lib/stripe';
import type { Env } from '../../functions/lib/env';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
    ...overrides,
  };
}

describe('billing launch hardening', () => {
  it('only treats loopback development requests as local development', () => {
    const devEnv = makeEnv({ ENVIRONMENT: 'development' });
    const prodEnv = makeEnv({ ENVIRONMENT: 'production' });

    expect(isLocalDevelopmentRequest(new Request('http://localhost:8788/api/auth/dev-login'), devEnv)).toBe(true);
    expect(isLocalDevelopmentRequest(new Request('http://127.0.0.1:8788/api/auth/dev-login'), devEnv)).toBe(true);
    expect(isLocalDevelopmentRequest(new Request('https://www.masterselects.com/api/auth/dev-login'), devEnv)).toBe(false);
    expect(isLocalDevelopmentRequest(new Request('http://localhost:8788/api/auth/dev-login'), prodEnv)).toBe(false);
  });

  it('accepts only same-origin POST origins for billing routes', () => {
    const trusted = new Request('https://www.masterselects.com/api/billing/checkout', {
      headers: {
        Origin: 'https://www.masterselects.com',
      },
      method: 'POST',
    });
    const foreign = new Request('https://www.masterselects.com/api/billing/checkout', {
      headers: {
        Origin: 'https://evil.example',
      },
      method: 'POST',
    });
    const noOrigin = new Request('https://www.masterselects.com/api/billing/checkout', {
      method: 'POST',
    });

    expect(hasTrustedOrigin(trusted)).toBe(true);
    expect(hasTrustedOrigin(foreign)).toBe(false);
    expect(hasTrustedOrigin(noOrigin)).toBe(true);
  });

  it('drops paid entitlements when subscription status is not active or trialing', () => {
    expect(planIdFromSubscriptionStatus('active', 'studio')).toBe('studio');
    expect(planIdFromSubscriptionStatus('trialing', 'starter')).toBe('starter');
    expect(planIdFromSubscriptionStatus('canceled', 'studio')).toBe('free');
    expect(planIdFromSubscriptionStatus('past_due', 'pro')).toBe('free');
  });

  it('maps Stripe price ids back to billing plans', () => {
    const env = makeEnv({
      STRIPE_PRICE_STARTER: 'price_starter_live',
      STRIPE_PRICE_PRO: 'price_pro_live',
      STRIPE_PRICE_STUDIO: 'price_studio_live',
    });

    expect(getBillingPlanIdFromStripePriceId(env, 'price_starter_live')).toBe('starter');
    expect(getBillingPlanIdFromStripePriceId(env, 'price_pro_live')).toBe('pro');
    expect(getBillingPlanIdFromStripePriceId(env, 'price_studio_live')).toBe('studio');
    expect(getBillingPlanIdFromStripePriceId(env, 'price_unknown')).toBeNull();
  });

  it('derives subscription plans from Stripe subscription item prices', () => {
    const env = makeEnv({
      STRIPE_PRICE_STARTER: 'price_starter_live',
      STRIPE_PRICE_PRO: 'price_pro_live',
      STRIPE_PRICE_STUDIO: 'price_studio_live',
    });

    const subscription: StripeSubscriptionLike = {
      items: {
        data: [
          {
            price: {
              id: 'price_studio_live',
            },
          },
        ],
      },
      status: 'active',
    };

    expect(getBillingPlanIdFromStripeSubscription(env, subscription)).toBe('studio');
    expect(
      getBillingPlanIdFromStripeSubscription(env, {
        ...subscription,
        status: 'past_due',
      }),
    ).toBeNull();
    expect(
      getBillingPlanIdFromStripeSubscription(env, {
        ...subscription,
        status: 'canceled',
      }),
    ).toBeNull();
  });
});
