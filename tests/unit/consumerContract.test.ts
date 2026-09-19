import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION, WITHDRAWAL_VERSION } from '../../functions/lib/consumerContract';
import {
  recordLegalConsent,
  sendPendingContractConfirmation,
  validateLegalConsent,
} from '../../functions/lib/consumerContractRecords';
import type { AppD1Database, Env } from '../../functions/lib/env';

function validConsent() {
  return {
    immediatePerformanceRequested: true,
    locale: 'de-DE',
    termsAccepted: true,
    termsVersion: TERMS_VERSION,
    withdrawalPolicyRead: true,
    withdrawalVersion: WITHDRAWAL_VERSION,
  };
}

interface DbOptions {
  consentRow?: {
    accepted_at: string;
    confirmation_email_sent_at: string | null;
    id: string;
    plan_id: string;
    user_id: string;
  } | null;
  userEmail?: string | null;
}

function makeDb(options: DbOptions, log: Array<{ query: string; values: unknown[] }>): AppD1Database {
  return {
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    prepare: vi.fn((query: string) => {
      const statement = {
        all: vi.fn(async () => ({ results: [] })),
        bind: vi.fn((...values: unknown[]) => {
          log.push({ query, values });
          return statement;
        }),
        first: vi.fn(async () => {
          if (query.includes('FROM billing_legal_consents')) return options.consentRow ?? null;
          if (query.includes('FROM users')) return options.userEmail ? { email: options.userEmail } : null;
          return null;
        }),
        raw: vi.fn(async () => []),
        run: vi.fn(async () => ({})),
      };
      return statement;
    }),
  };
}

function makeEnv(db: AppD1Database): Env {
  return {
    AUTH_EMAIL_FROM: 'MasterSelects <noreply@masterselects.com>',
    DB: db,
    KV: {} as Env['KV'],
    MEDIA: {} as Env['MEDIA'],
    RESEND_API_KEY: 're_test',
  } as Env;
}

describe('validateLegalConsent', () => {
  it('accepts all three statements against the current versions', () => {
    const result = validateLegalConsent(validConsent());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consent).toEqual({ locale: 'de', termsVersion: TERMS_VERSION, withdrawalVersion: WITHDRAWAL_VERSION });
    }
  });

  it.each([
    ['missing body', undefined],
    ['terms not accepted', { ...validConsent(), termsAccepted: false }],
    ['withdrawal policy not read', { ...validConsent(), withdrawalPolicyRead: false }],
    ['no immediate performance request', { ...validConsent(), immediatePerformanceRequested: 'yes' }],
  ])('rejects %s as legal_consent_required', (_label, input) => {
    const result = validateLegalConsent(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('legal_consent_required');
  });

  it('rejects consent to an outdated text version', () => {
    const result = validateLegalConsent({ ...validConsent(), withdrawalVersion: '2020-01-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('legal_consent_outdated');
  });
});

describe('recordLegalConsent', () => {
  it('stores the consent with the Stripe session and the accepted versions', async () => {
    const log: Array<{ query: string; values: unknown[] }> = [];
    const db = makeDb({}, log);
    const consent = validateLegalConsent(validConsent());
    if (!consent.ok) throw new Error('unexpected');

    const record = await recordLegalConsent(db, { consent: consent.consent, planId: 'pro', stripeSessionId: 'cs_test_1', userId: 'user_1' });

    expect(record.id).toMatch(/^consent-/);
    const insert = log.find((entry) => entry.query.includes('INSERT INTO billing_legal_consents'));
    expect(insert?.values).toEqual([record.id, 'user_1', 'pro', TERMS_VERSION, WITHDRAWAL_VERSION, record.acceptedAt, 'cs_test_1']);
  });
});

describe('sendPendingContractConfirmation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emails the contract texts once and stamps the consent row', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const log: Array<{ query: string; values: unknown[] }> = [];
    const env = makeEnv(makeDb({
      consentRow: { accepted_at: '2026-09-02T10:00:00.000Z', confirmation_email_sent_at: null, id: 'consent-1', plan_id: 'pro', user_id: 'user_1' },
      userEmail: 'buyer@example.com',
    }, log));

    const outcome = await sendPendingContractConfirmation(env, { customerEmail: null, stripeSessionId: 'cs_test_1' });

    expect(outcome).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.to).toEqual(['buyer@example.com']);
    expect(body.text).toContain('Allgemeine Geschäftsbedingungen');
    expect(body.text).toContain('Widerrufsbelehrung');
    expect(body.text).toContain('cs_test_1');
    expect(log.some((entry) => entry.query.includes('SET confirmation_email_sent_at') && entry.values.includes('consent-1'))).toBe(true);
  });

  it('is idempotent once the confirmation was sent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv(makeDb({
      consentRow: { accepted_at: '2026-09-02T10:00:00.000Z', confirmation_email_sent_at: '2026-09-02T10:01:00.000Z', id: 'consent-1', plan_id: 'pro', user_id: 'user_1' },
    }, []));

    expect(await sendPendingContractConfirmation(env, { customerEmail: 'buyer@example.com', stripeSessionId: 'cs_test_1' })).toBe('already_sent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for sessions without a recorded consent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv(makeDb({ consentRow: null }, []));

    expect(await sendPendingContractConfirmation(env, { customerEmail: 'buyer@example.com', stripeSessionId: 'cs_unknown' })).toBe('no_consent');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
