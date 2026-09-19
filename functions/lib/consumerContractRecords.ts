import { TERMS_VERSION, WITHDRAWAL_VERSION } from './consumerContract';
import { sendContractConfirmationEmail } from './consumerContractEmail';
import { getBillingPlan } from './entitlements';
import type { AppD1Database, Env } from './env';

export type LegalLocale = 'de' | 'en';

export interface ValidatedLegalConsent {
  locale: LegalLocale;
  termsVersion: string;
  withdrawalVersion: string;
}

export type LegalConsentCheck =
  | { consent: ValidatedLegalConsent; ok: true }
  | { error: 'legal_consent_required' | 'legal_consent_outdated'; message: string; ok: false };

interface ConsentRow {
  accepted_at: string;
  confirmation_email_sent_at: string | null;
  id: string;
  plan_id: string;
  user_id: string;
}

export function normalizeLegalLocale(value: unknown): LegalLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * The checkout only proceeds when the customer ticked all three statements
 * (terms accepted, withdrawal policy read, immediate performance requested)
 * against the versions that are currently published. Older versions mean the
 * page was open across a text change and must be reloaded.
 */
export function validateLegalConsent(value: unknown): LegalConsentCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: 'legal_consent_required',
      message: 'Accept the Terms, confirm the Withdrawal Policy, and request immediate performance to continue.',
      ok: false,
    };
  }
  const input = value as Record<string, unknown>;
  const flags = [input.termsAccepted, input.withdrawalPolicyRead, input.immediatePerformanceRequested];
  if (!flags.every((flag) => flag === true)) {
    return {
      error: 'legal_consent_required',
      message: 'Accept the Terms, confirm the Withdrawal Policy, and request immediate performance to continue.',
      ok: false,
    };
  }
  if (input.termsVersion !== TERMS_VERSION || input.withdrawalVersion !== WITHDRAWAL_VERSION) {
    return {
      error: 'legal_consent_outdated',
      message: 'The Terms or Withdrawal Policy changed. Reload the page and confirm the current versions.',
      ok: false,
    };
  }
  return {
    consent: {
      locale: normalizeLegalLocale(input.locale),
      termsVersion: TERMS_VERSION,
      withdrawalVersion: WITHDRAWAL_VERSION,
    },
    ok: true,
  };
}

export async function recordLegalConsent(
  db: AppD1Database,
  input: { consent: ValidatedLegalConsent; planId: string; stripeSessionId: string | null; userId: string },
): Promise<{ acceptedAt: string; id: string }> {
  const id = `consent-${crypto.randomUUID()}`;
  const acceptedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO billing_legal_consents (
         id, user_id, plan_id, terms_version, withdrawal_version,
         terms_accepted, withdrawal_policy_read, immediate_performance_requested,
         accepted_at, stripe_session_id
       ) VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.planId,
      input.consent.termsVersion,
      input.consent.withdrawalVersion,
      acceptedAt,
      input.stripeSessionId,
    )
    .run();
  return { acceptedAt, id };
}

export type ContractConfirmationOutcome = 'already_sent' | 'no_consent' | 'no_email' | 'sent';

/**
 * Sends the durable contract confirmation (terms + withdrawal policy) once a
 * Stripe Checkout session completes. Idempotent per consent row.
 */
export async function sendPendingContractConfirmation(
  env: Env,
  input: { customerEmail: string | null; stripeSessionId: string | null },
): Promise<ContractConfirmationOutcome> {
  if (!input.stripeSessionId) return 'no_consent';
  const row = await env.DB
    .prepare(
      `SELECT id, user_id, plan_id, accepted_at, confirmation_email_sent_at
       FROM billing_legal_consents WHERE stripe_session_id = ? LIMIT 1`,
    )
    .bind(input.stripeSessionId)
    .first<ConsentRow>();
  if (!row) return 'no_consent';
  if (row.confirmation_email_sent_at) return 'already_sent';

  const email = input.customerEmail?.trim()
    || (await env.DB.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(row.user_id).first<{ email: string }>())?.email
    || null;
  if (!email) return 'no_email';

  await sendContractConfirmationEmail(env, {
    acceptedAt: row.accepted_at,
    email,
    planLabel: getBillingPlan(row.plan_id).label,
    reference: input.stripeSessionId,
  });
  await env.DB
    .prepare('UPDATE billing_legal_consents SET confirmation_email_sent_at = ? WHERE id = ? AND confirmation_email_sent_at IS NULL')
    .bind(new Date().toISOString(), row.id)
    .run();
  return 'sent';
}
