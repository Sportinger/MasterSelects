import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/stripe/webhook';
import type { AppContext, AppD1Database, AppD1Statement, Env } from '../../functions/lib/env';

const encoder = new TextEncoder();
const WEBHOOK_SECRET = 'whsec_test_secret';

async function signPayload(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', encoder.encode(WEBHOOK_SECRET), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

interface Fixture {
  claimed: Set<string>;
  context: (payload: string, signature: string) => AppContext;
  statements: string[];
}

function createFixture(): Fixture {
  const claimed = new Set<string>();
  const statements: string[] = [];
  const db: AppD1Database = {
    batch: async () => [],
    exec: async () => ({}),
    prepare(rawSql: string): AppD1Statement {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      let bound: unknown[] = [];
      const statement: AppD1Statement = {
        all: async <T>() => ({ results: [] as T[] }),
        bind: (...values: unknown[]) => {
          bound = values;
          statements.push(sql);
          return statement;
        },
        first: async () => null,
        raw: async () => [],
        run: async () => {
          if (sql.startsWith('INSERT OR IGNORE INTO webhook_events')) {
            const eventId = String(bound[2]);
            if (claimed.has(eventId)) return { meta: { changes: 0 } };
            claimed.add(eventId);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM webhook_events')) {
            claimed.delete(String(bound[0]));
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  const env = {
    DB: db,
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as Env;

  return {
    claimed,
    context: (payload, signature) => ({
      data: { requestId: 'req-webhook' },
      env,
      next: vi.fn(async () => new Response()),
      params: {},
      request: new Request('https://www.masterselects.com/api/stripe/webhook', {
        body: payload,
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
        method: 'POST',
      }),
      waitUntil: vi.fn(),
    }),
    statements,
  };
}

describe('Stripe webhook dedupe', () => {
  it('claims the event before processing and acknowledges repeats without reprocessing', async () => {
    const fixture = createFixture();
    const payload = JSON.stringify({
      data: { object: { customer: 'cus_123', id: 'cus_123', object: 'customer' } },
      id: 'evt_1',
      type: 'customer.updated',
    });
    const signature = await signPayload(payload);

    const first = await onRequest(fixture.context(payload, signature));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ eventId: 'evt_1', ok: true });
    expect(fixture.claimed.has('evt_1')).toBe(true);
    const claimIndex = fixture.statements.findIndex((sql) => sql.startsWith('INSERT OR IGNORE INTO webhook_events'));
    const lookupIndex = fixture.statements.findIndex((sql) => sql.includes('FROM stripe_customers'));
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(lookupIndex).toBeGreaterThan(claimIndex);

    const processedBefore = fixture.statements.length;
    const second = await onRequest(fixture.context(payload, signature));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true, eventId: 'evt_1', ok: true });
    expect(fixture.statements.slice(processedBefore).filter((sql) => !sql.includes('webhook_events'))).toHaveLength(0);
  });

  it('releases the claim when processing must be retried', async () => {
    const fixture = createFixture();
    const payload = JSON.stringify({
      data: {
        object: {
          billing_reason: 'subscription_cycle',
          id: 'in_1',
          metadata: { user_id: 'user-1' },
          object: 'invoice',
        },
      },
      id: 'evt_retry',
      type: 'invoice.paid',
    });
    const signature = await signPayload(payload);

    const response = await onRequest(fixture.context(payload, signature));

    expect(response.status).toBe(503);
    expect(fixture.claimed.has('evt_retry')).toBe(false);
    expect(fixture.statements.some((sql) => sql.startsWith('DELETE FROM webhook_events'))).toBe(true);

    const redelivery = await onRequest(fixture.context(payload, signature));
    expect(redelivery.status).toBe(503);
    expect(await redelivery.json()).not.toMatchObject({ duplicate: true });
  });

  it('rejects a tampered signature', async () => {
    const fixture = createFixture();
    const payload = JSON.stringify({ data: { object: {} }, id: 'evt_bad', type: 'customer.updated' });
    const signature = await signPayload(payload);

    const response = await onRequest(fixture.context(payload, signature.replace(/v1=.{4}/, 'v1=0000')));

    expect(response.status).toBe(400);
    expect(fixture.claimed.size).toBe(0);
  });
});
