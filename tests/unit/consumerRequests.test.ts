import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as onCancel } from '../../functions/api/legal/cancel';
import { onRequest as onWithdraw } from '../../functions/api/legal/withdraw';
import type { AppContext, AppD1Database, Env } from '../../functions/lib/env';

interface Fixture {
  context: AppContext;
  inserts: unknown[][];
  kv: Map<string, string>;
}

interface FixtureOptions {
  body?: Record<string, unknown>;
  configured?: boolean;
  existingRequest?: { id: string; received_at: string } | null;
  headers?: Record<string, string>;
  ip?: string;
  kv?: Map<string, string>;
  subscription?: { plan_id: string; stripe_subscription_id: string; user_id: string } | null;
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    confirmation: true,
    contractReference: 'in_123',
    email: 'Customer@Example.com',
    locale: 'de',
    name: 'Erika Mustermann',
    ...overrides,
  };
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const inserts: unknown[][] = [];
  const kv = options.kv ?? new Map<string, string>();
  const db: AppD1Database = {
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    prepare: vi.fn((query: string) => {
      const statement = {
        all: vi.fn(async () => ({ results: [] })),
        bind: vi.fn((...values: unknown[]) => {
          if (query.includes('INSERT INTO withdrawal_requests')) inserts.push(values);
          return statement;
        }),
        first: vi.fn(async () => {
          if (query.includes('FROM withdrawal_requests')) return options.existingRequest ?? null;
          if (query.includes('FROM subscriptions s')) return options.subscription ?? null;
          return null;
        }),
        raw: vi.fn(async () => []),
        run: vi.fn(async () => ({})),
      };
      return statement;
    }),
  };
  const env = {
    AUTH_EMAIL_FROM: options.configured === false ? undefined : 'MasterSelects <noreply@masterselects.com>',
    DB: db,
    KV: {
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      list: vi.fn(async () => ({ cursor: undefined, keys: [], list_complete: true })),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
    },
    MEDIA: {} as Env['MEDIA'],
    RESEND_API_KEY: options.configured === false ? undefined : 're_test',
    SESSION_SECRET: 'secret',
  } as unknown as Env;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: 'https://www.masterselects.com',
    'cf-connecting-ip': options.ip ?? '203.0.113.7',
    ...options.headers,
  };
  for (const [key, value] of Object.entries(headers)) if (value === '') delete headers[key];
  return {
    context: {
      data: {},
      env,
      next: vi.fn(async () => new Response()),
      params: {},
      request: new Request('https://www.masterselects.com/api/legal/withdraw', {
        body: JSON.stringify(options.body ?? validBody()),
        headers,
        method: 'POST',
      }),
      waitUntil: vi.fn(),
    },
    inserts,
    kv,
  };
}

function stubResend(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mailBodies(fetchMock: ReturnType<typeof vi.fn>): Array<{ subject: string; text: string; to: string[] }> {
  return fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

describe('consumer request routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a withdrawal, mails the customer receipt and the admin copy', async () => {
    const fetchMock = stubResend();
    const fixture = makeFixture({ subscription: { plan_id: 'pro', stripe_subscription_id: 'sub_42', user_id: 'user_42' } });

    const response = await onWithdraw(fixture.context);
    const payload = await response.json() as { kind: string; ok: boolean; receiptId: string };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.kind).toBe('withdrawal');
    expect(payload.receiptId).toMatch(/^wd-/);
    expect(fixture.inserts[0]).toContain('customer@example.com');
    expect(fixture.inserts[0]).toContain('sub_42');
    const mails = mailBodies(fetchMock);
    expect(mails).toHaveLength(2);
    expect(mails[0].to).toEqual(['customer@example.com']);
    expect(mails[0].text).toContain('Widerruf');
    expect(mails[1].to).toEqual(['admin@masterselects.com']);
    expect(mails[1].text).toContain('sub_42');
  });

  it('confirms a cancellation with the requested effective date', async () => {
    const fetchMock = stubResend();
    const fixture = makeFixture({ body: validBody({ effectiveAt: 'immediately' }) });

    const response = await onCancel(fixture.context);
    const payload = await response.json() as { kind: string; receiptId: string };

    expect(response.status).toBe(200);
    expect(payload.kind).toBe('cancellation');
    expect(payload.receiptId).toMatch(/^cx-/);
    expect(fixture.inserts[0]).toContain('immediately');
    const mails = mailBodies(fetchMock);
    expect(mails[0].text).toContain('Kündigung');
    expect(mails[0].text).toContain('frühestmöglichen');
  });

  it('rejects requests without a same-origin header', async () => {
    const fetchMock = stubResend();
    const fixture = makeFixture({ headers: { Origin: '' } });

    const response = await onWithdraw(fixture.context);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.inserts).toEqual([]);
  });

  it('rejects incomplete forms and honeypot submissions', async () => {
    stubResend();
    expect((await onWithdraw(makeFixture({ body: validBody({ confirmation: false }) }).context)).status).toBe(400);
    expect((await onWithdraw(makeFixture({ body: validBody({ email: 'not-an-email' }) }).context)).status).toBe(400);
    expect((await onWithdraw(makeFixture({ body: validBody({ website: 'http://spam.example' }) }).context)).status).toBe(400);
  });

  it('returns 503 and stores nothing when email delivery is not configured', async () => {
    const fetchMock = stubResend();
    const fixture = makeFixture({ configured: false });

    const response = await onWithdraw(fixture.context);

    expect(response.status).toBe(503);
    expect(fixture.inserts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits repeated submissions from one connection', async () => {
    stubResend();
    const kv = new Map<string, string>();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await onWithdraw(makeFixture({ kv }).context)).status).toBe(200);
    }
    expect((await onWithdraw(makeFixture({ kv }).context)).status).toBe(429);
  });

  it('returns the existing receipt for a duplicate within 24 hours without new mails', async () => {
    const fetchMock = stubResend();
    const fixture = makeFixture({ existingRequest: { id: 'wd-existing', received_at: '2026-09-02T09:00:00.000Z' } });

    const response = await onWithdraw(fixture.context);
    const payload = await response.json() as { duplicate: boolean; receiptId: string };

    expect(response.status).toBe(200);
    expect(payload.duplicate).toBe(true);
    expect(payload.receiptId).toBe('wd-existing');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.inserts).toEqual([]);
  });

  it('keeps the recorded notice and reports 503 when the receipt mail fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    const fixture = makeFixture();

    const response = await onWithdraw(fixture.context);
    const payload = await response.json() as { error: string; receiptId: string };

    expect(response.status).toBe(503);
    expect(payload.error).toBe('consumer_request_receipt_failed');
    expect(payload.receiptId).toMatch(/^wd-/);
    expect(fixture.inserts).toHaveLength(1);
  });
});
