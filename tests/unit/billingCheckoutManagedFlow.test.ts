import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/billing/checkout';
import { TERMS_VERSION, WITHDRAWAL_VERSION } from '../../functions/lib/consumerContract';
import type { AppContext, Env } from '../../functions/lib/env';

const consentInserts: unknown[][] = [];

function makeDb(currentPlanId = 'pro'): Env['DB'] {
  return {
    batch: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn((query: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn(async () => {
          if (query.includes('FROM stripe_customers')) {
            return { stripe_customer_id: 'cus_123' };
          }

          if (query.includes('FROM subscriptions')) {
            return {
              plan_id: currentPlanId,
              status: 'active',
              stripe_subscription_id: 'sub_123',
            };
          }

          return null;
        }),
        run: vi.fn(async () => {
          if (query.includes('INSERT INTO billing_legal_consents')) consentInserts.push(values);
          return {};
        }),
      })),
    })),
  } as unknown as Env['DB'];
}

const VALID_LEGAL_CONSENT = {
  immediatePerformanceRequested: true,
  locale: 'de',
  termsAccepted: true,
  termsVersion: TERMS_VERSION,
  withdrawalPolicyRead: true,
  withdrawalVersion: WITHDRAWAL_VERSION,
};

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

function makeContext(planId: string, env: Env, legalConsent: unknown = VALID_LEGAL_CONSENT): AppContext {
  return {
    data: {
      requestId: 'req_test',
      user: {
        email: 'user@example.com',
        id: 'user_123',
      },
    },
    env,
    next: vi.fn(),
    params: {},
    request: new Request('https://www.masterselects.com/api/billing/checkout', {
      body: JSON.stringify({
        cancelUrl: 'https://www.masterselects.com/?billing=cancel',
        legalConsent,
        planId,
        successUrl: `https://www.masterselects.com/?billing=success&plan=${encodeURIComponent(planId)}`,
      }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.masterselects.com',
      },
      method: 'POST',
    }),
    waitUntil: vi.fn(),
  };
}

describe('billing checkout managed subscription flows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    consentInserts.length = 0;
  });

  it('refuses a paid plan change without the consumer consent statements', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(makeContext('pro', makeEnv(makeDb('starter')), null));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'legal_consent_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses consent given for an outdated terms version', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const response = await onRequest(makeContext('pro', makeEnv(makeDb('starter')), {
      ...VALID_LEGAL_CONSENT,
      termsVersion: '2000-01-01',
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'legal_consent_outdated' });
  });

  it('does not require consent to cancel to free', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'bps_free', url: 'https://billing.stripe.test/free' }), { status: 200 })));

    const response = await onRequest(makeContext('free', makeEnv(makeDb()), null));
    expect(response.status).toBe(200);
    expect(consentInserts).toEqual([]);
  });

  it('opens the Stripe cancel flow when downgrading to free', async () => {
    const fetchMock = vi.fn(async () => (
      new Response(
        JSON.stringify({
          id: 'bps_free',
          url: 'https://billing.stripe.test/free',
        }),
        { status: 200 },
      )
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(makeContext('free', makeEnv(makeDb())));
    const payload = await response.json() as {
      destination: string;
      planId: string;
      priceId: string | null;
    };

    expect(payload.destination).toBe('portal');
    expect(payload.planId).toBe('free');
    expect(payload.priceId).toBeNull();

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const params = new URLSearchParams(String(requestInit.body ?? ''));
    expect(params.get('flow_data[type]')).toBe('subscription_cancel');
    expect(params.get('flow_data[subscription_cancel][subscription]')).toBe('sub_123');
    expect(params.get('flow_data[after_completion][redirect][return_url]')).toBe(
      'https://www.masterselects.com/?billing=success&plan=free',
    );
  });

  it('opens the Stripe subscription update confirm flow for paid downgrades', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscriptions/sub_123')) {
        return new Response(
          JSON.stringify({
            id: 'sub_123',
            items: {
              data: [
                {
                  id: 'si_123',
                  price: { id: 'price_pro' },
                  quantity: 1,
                },
              ],
            },
            status: 'active',
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          id: 'bps_downgrade',
          url: 'https://billing.stripe.test/starter',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(makeContext('starter', makeEnv(makeDb())));
    const payload = await response.json() as {
      destination: string;
      planId: string;
      priceId: string | null;
    };

    expect(payload.destination).toBe('portal');
    expect(payload.planId).toBe('starter');
    expect(consentInserts).toHaveLength(1);
    expect(consentInserts[0]).toContain('bps_downgrade');
    expect(consentInserts[0]).toContain(TERMS_VERSION);
    expect(payload.priceId).toBe('price_starter');

    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const params = new URLSearchParams(String(requestInit.body ?? ''));
    expect(params.get('flow_data[type]')).toBe('subscription_update_confirm');
    expect(params.get('flow_data[subscription_update_confirm][subscription]')).toBe('sub_123');
    expect(params.get('flow_data[subscription_update_confirm][items][0][id]')).toBe('si_123');
    expect(params.get('flow_data[subscription_update_confirm][items][0][price]')).toBe('price_starter');
  });

  it('opens the Stripe subscription update confirm flow for paid upgrades', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/subscriptions/sub_123')) {
        return new Response(
          JSON.stringify({
            id: 'sub_123',
            items: {
              data: [
                {
                  id: 'si_123',
                  price: { id: 'price_starter' },
                  quantity: 1,
                },
              ],
            },
            status: 'active',
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          id: 'bps_upgrade',
          url: 'https://billing.stripe.test/pro',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(makeContext('pro', makeEnv(makeDb('starter'))));
    const payload = await response.json() as {
      destination: string;
      planId: string;
      priceId: string | null;
    };

    expect(payload.destination).toBe('portal');
    expect(payload.planId).toBe('pro');
    expect(payload.priceId).toBe('price_pro');

    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const params = new URLSearchParams(String(requestInit.body ?? ''));
    expect(params.get('flow_data[type]')).toBe('subscription_update_confirm');
    expect(params.get('flow_data[subscription_update_confirm][subscription]')).toBe('sub_123');
    expect(params.get('flow_data[subscription_update_confirm][items][0][id]')).toBe('si_123');
    expect(params.get('flow_data[subscription_update_confirm][items][0][price]')).toBe('price_pro');
  });
});
