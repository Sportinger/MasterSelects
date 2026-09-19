---
title: "Consumer Contract"
---

MasterSelects sells monthly subscriptions to consumers, mostly in Germany, so
the checkout and the account pages implement the German/EU consumer-contract
duties: pre-contract consent, a durable contract confirmation, an online
withdrawal function, and the statutory cancellation button.

## Texts and versions

`src/legal/consumerContractTexts.ts` is the single source for the Terms (AGB),
the Withdrawal Policy (Widerrufsbelehrung, with the model withdrawal form), the
cancellation-button page, the business identity, and the page paths. The Pages
Functions re-export it through `functions/lib/consumerContract.ts`, so the
browser pages, the checkout consent, and the confirmation email always carry
the same words. German is the binding version; the English text is a
convenience translation and says so.

`TERMS_VERSION` and `WITHDRAWAL_VERSION` are date stamps. Bump both when a
text changes: consent records store the accepted versions, and the checkout
rejects consents given for an older version (`legal_consent_outdated`), which
forces a reload of the pricing dialog.

## Pages

| Path (DE / EN) | Content |
|---|---|
| `/agb` / `/terms` | Terms and Conditions |
| `/widerruf` / `/withdrawal` | Withdrawal Policy plus the online withdrawal form |
| `/kuendigen` / `/cancel` | Cancellation button page (§312k BGB) with the cancellation form |

All three render inside `LegalDialog` (`src/components/common/LegalDialog.tsx`,
tabs Imprint, Privacy, Terms, Withdrawal, Cancel, Contact). Routing lives in
`src/routing/entryExperience.ts` (`resolveLegalEntryExperience`,
`isEnglishLegalPath`); the Pages middleware serves these paths instead of the
404 fallback because `isSupportedPagePath` includes them. The Info menu links
to Terms, Withdrawal, and "Cancel contracts here". The pricing dialog shows a
persistent "Verträge hier kündigen" / "Cancel contracts here" link next to the
checkout button, which is where §312k expects it.

## Checkout consent

`CheckoutLegalConsent` (`src/components/common/CheckoutLegalConsent.tsx`)
appears in the pricing dialog whenever a signed-in user selects a paid plan
that is not the current plan. Three unticked checkboxes, in the browser's
language (German or English):

1. Terms read and accepted (link to `/agb`).
2. Withdrawal Policy taken note of (link to `/widerruf`).
3. Express request that the service starts before the 14-day withdrawal
   period ends, with the acknowledgment that a proportionate amount is due on
   withdrawal (§356 Abs. 4 BGB).

The checkout button stays disabled until all three are set. `startCheckout`
sends the flags, the versions, and the locale as `legalConsent`.

`functions/api/billing/checkout.ts` requires the consent for every request
that creates a paid contract (first checkout or a plan change through the
Stripe portal) and answers `422 legal_consent_required` or
`legal_consent_outdated` otherwise. Cancelling to Free or opening the portal
for the current plan needs no consent. Accepted consents are written to
`billing_legal_consents` with the Stripe Checkout or portal session ID
(`functions/lib/consumerContractRecords.ts`).

## Contract confirmation

On `checkout.session.completed` the Stripe webhook
(`functions/api/stripe/webhook.ts`) looks up the consent row by session ID and
sends one contract confirmation email through Resend with the plan, the
session reference, the acceptance time, and the full German texts plus the
English translation (`sendPendingContractConfirmation`). The row is stamped
`confirmation_email_sent_at`, so retries never send twice. A failed email is
logged and does not fail the webhook; the row keeps the email pending.

## Withdrawal and cancellation forms

Both forms post to public endpoints that work without a login, because §312k
demands that for cancellation and because a withdrawing customer may no longer
be able to sign in:

- `POST /api/legal/withdraw` (`functions/api/legal/withdraw.ts`)
- `POST /api/legal/cancel` (`functions/api/legal/cancel.ts`)

Both delegate to `functions/lib/consumerRequests.ts`, which enforces a
same-origin `Origin` header, a honeypot field, a per-IP limit of three
requests per ten minutes (KV), 24-hour de-duplication per email and kind, and
a configured Resend setup (503 otherwise). Each accepted notice is stored in
`withdrawal_requests` (`kind` `withdrawal` or `cancellation`, matched user and
Stripe subscription by email, requested effective date, locale) before any
email is sent. The customer receives a receipt with content, date, and time of
receipt in Berlin time and UTC; `admin@masterselects.com` receives the request
with the matched subscription ID and the required action (refund within 14
days, or cancel at period end / immediately). Processing itself stays manual
in Stripe by design: an unauthenticated form must not be able to cancel
someone else's subscription.

## Data and retention

- `billing_legal_consents` (migration `0024`): user, plan, versions, the three
  flags, acceptance time, Stripe session, confirmation time.
- `withdrawal_requests` (migrations `0024` and `0028_consumer_requests.sql`):
  both request kinds with status `received`, matched user and subscription,
  requested effective date, locale, receipt-mail time.
- The privacy policy lists these records under "Vertragsnachweise" / "Contract
  records"; they are kept for the statutory evidence and limitation periods.

## Verification

`tests/unit/consumerContract.test.ts` (consent validation, consent record,
idempotent confirmation email), `tests/unit/consumerRequests.test.ts` (both
routes: receipts, origin, honeypot, rate limit, duplicates, mail failure),
`tests/unit/billingCheckoutManagedFlow.test.ts` (422 without or with outdated
consent, no consent for cancel-to-free, consent stored with the portal session),
`tests/unit/PricingDialog.test.tsx` (button gating, consent payload,
cancellation link), `tests/unit/entryExperience.test.ts` (routes).

Manual check after a deployment: open `/kuendigen`, submit the form with a
test address, and confirm the receipt mail and the admin mail arrive; then run
a Stripe test checkout and confirm the contract confirmation mail follows the
`checkout.session.completed` webhook.
