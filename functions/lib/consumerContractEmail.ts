import type { Env } from './env';
import {
  BUSINESS_ADDRESS,
  BUSINESS_EMAIL,
  BUSINESS_NAME,
  buildContractConfirmationText,
} from './consumerContract';

export type ConsumerRequestKind = 'cancellation' | 'withdrawal';

function requireValue(value: string | null | undefined, key: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${key} is not configured`);
  }
  return trimmed;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

async function sendEmail(
  env: Env,
  input: { html: string; subject: string; text: string; to: string[] },
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireValue(env.RESEND_API_KEY, 'RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      from: requireValue(env.AUTH_EMAIL_FROM, 'AUTH_EMAIL_FROM'),
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Resend request failed with status ${response.status}: ${payload.slice(0, 300)}`);
  }
}

function renderDocumentEmail(title: string, summary: string, document: string): string {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:760px;margin:auto">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      <p style="margin:0 0 20px">${escapeHtml(summary)}</p>
      <div style="white-space:pre-wrap;border:1px solid #e2e8f0;border-radius:12px;padding:20px;background:#f8fafc;font-size:13px">${escapeHtml(document)}</div>
    </div>
  `;
}

/** Berlin wall-clock plus the ISO instant, so receipts carry an unambiguous time. */
function formatReceiptTime(iso: string): string {
  const date = new Date(iso);
  const local = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Berlin',
    year: 'numeric',
  }).format(date);
  return `${local} Uhr (Europe/Berlin) / ${iso}`;
}

export async function sendContractConfirmationEmail(
  env: Env,
  input: { acceptedAt: string; email: string; planLabel: string; reference: string },
): Promise<void> {
  const text = buildContractConfirmationText(input);
  await sendEmail(env, {
    html: renderDocumentEmail(
      'MasterSelects – Vertragsbestätigung / Contract confirmation',
      `Tarif / Plan: ${input.planLabel} · Referenz / Reference: ${input.reference}`,
      text,
    ),
    subject: `MasterSelects contract confirmation – ${input.planLabel}`,
    text,
    to: [input.email],
  });
}

export interface ConsumerRequestReceiptInput {
  contractReference: string;
  email: string;
  kind: ConsumerRequestKind;
  matchedPlanId: string | null;
  matchedSubscriptionId: string | null;
  name: string;
  receiptId: string;
  receivedAt: string;
  requestedEffectiveAt: string | null;
}

/**
 * Customer receipt plus admin notification for a withdrawal or a cancellation.
 * The cancellation receipt carries content, date, and time of receipt as
 * §312k(3) BGB requires; the effective date follows the billing period unless
 * the customer asked for an earlier date.
 */
export async function sendConsumerRequestReceiptEmails(
  env: Env,
  input: ConsumerRequestReceiptInput,
): Promise<void> {
  const receivedLabel = formatReceiptTime(input.receivedAt);
  const isCancellation = input.kind === 'cancellation';
  const effectiveDe = input.requestedEffectiveAt === 'immediately'
    ? 'zum frühestmöglichen Zeitpunkt'
    : 'zum Ende des laufenden Abrechnungszeitraums';
  const effectiveEn = input.requestedEffectiveAt === 'immediately'
    ? 'at the earliest possible date'
    : 'at the end of the current billing period';

  const customerText = isCancellation
    ? `MasterSelects – Eingangsbestätigung Ihrer Kündigung / Cancellation receipt

Wir bestätigen den Eingang Ihrer Kündigung am ${receivedLabel}.
We confirm receipt of your cancellation on ${receivedLabel}.

Inhalt / Content: Kündigung des MasterSelects-Abonnements ${effectiveDe} / cancellation of the MasterSelects subscription ${effectiveEn}
Name: ${input.name}
Vertragsreferenz / Contract reference: ${input.contractReference}
Vorgangsnummer / Receipt: ${input.receiptId}

Die Kündigung wird spätestens zum Ende des laufenden Abrechnungszeitraums wirksam. Das konkrete Vertragsende bestätigen wir Ihnen nach Zuordnung des Vertrags gesondert. Bis dahin bleibt Ihr Zugang unverändert nutzbar.
The cancellation takes effect no later than the end of the current billing period. We will confirm the exact end date separately once the contract is matched. Your access remains unchanged until then.

Empfänger / Recipient:
${BUSINESS_NAME}
${BUSINESS_ADDRESS}
${BUSINESS_EMAIL}`
    : `MasterSelects – Bestätigung Ihres Widerrufs / Withdrawal receipt

Wir bestätigen den Eingang Ihres Widerrufs am ${receivedLabel}.
We confirm receipt of your withdrawal on ${receivedLabel}.

Name: ${input.name}
Vertragsreferenz / Contract reference: ${input.contractReference}
Vorgangsnummer / Receipt: ${input.receiptId}

Erhaltene Zahlungen erstatten wir spätestens binnen vierzehn Tagen ab heute über dasselbe Zahlungsmittel. Haben Sie den sofortigen Leistungsbeginn verlangt, kann ein anteiliger Betrag für die bis heute erbrachte Leistung einbehalten werden.
Payments received will be refunded no later than fourteen days from today using the same means of payment. If you requested immediate performance, a proportionate amount for the service provided until today may be retained.

Empfänger / Recipient:
${BUSINESS_NAME}
${BUSINESS_ADDRESS}
${BUSINESS_EMAIL}`;

  await sendEmail(env, {
    html: renderDocumentEmail(
      isCancellation ? 'Kündigung eingegangen / Cancellation received' : 'Widerruf eingegangen / Withdrawal received',
      `Vorgangsnummer / Receipt: ${input.receiptId}`,
      customerText,
    ),
    subject: isCancellation
      ? `MasterSelects cancellation receipt – ${input.receiptId}`
      : `MasterSelects withdrawal receipt – ${input.receiptId}`,
    text: customerText,
    to: [input.email],
  });

  const adminText = `A ${input.kind} request was received.

Receipt: ${input.receiptId}
Received: ${receivedLabel}
Name: ${input.name}
Email: ${input.email}
Contract reference: ${input.contractReference}
Requested effective: ${input.requestedEffectiveAt ?? 'period_end'}
Matched subscription: ${input.matchedSubscriptionId ?? 'none found for this email'}
Matched plan: ${input.matchedPlanId ?? '-'}

${isCancellation
    ? 'Action: set cancel_at_period_end (or cancel immediately if requested) in Stripe and reply with the exact end date.'
    : 'Action: refund within 14 days via the original payment method, prorated for service already provided, then reply to the customer.'}`;

  await sendEmail(env, {
    html: renderDocumentEmail(`MasterSelects ${input.kind} request`, input.email, adminText),
    subject: `MasterSelects ${input.kind} – ${input.receiptId}`,
    text: adminText,
    to: [BUSINESS_EMAIL],
  });
}
