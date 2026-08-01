[Back to Feature Docs](./README.md)

# Credit Claims

Cloudflare-backed reward links can be created from the admin dashboard or the
operator script. The globally reserved website-gift backend is available, but
its in-app promotional banner is not mounted.

---

## Goal

Support two independent reward paths: operator-created claim links for selected
recipients, and an optional website offer that gives one browser at a time a
one-hour chance to claim 3,000 credits.

---

## Admin Flow

Create a locked claim from the command line:

```bash
npm run credits:create-claim -- --amount 3000 --email schickdenkram@gmail.com --description "Reward for 3 reported issues"
```

The script requires `CLOUDFLARE_API_TOKEN` unless `--dry-run` is used. It talks directly to the Cloudflare D1 API and prints a public `/credits/claim?code=...` URL.

The secured `/admin` dashboard also creates locked or unlocked links, lists
their status, copies available links, and can rotate an available legacy link
whose token was not retained by the dashboard.

Useful options:

| Option | Purpose |
|---|---|
| `--email <address>` | Locks the claim to one verified account email |
| `--unlocked` | Allows the first verified account to redeem the link |
| `--expires-days <days>` | Sets expiry; default is `30`, `0` disables expiry |
| `--title <text>` | Claim page title |
| `--description <text>` | Claim page body copy |
| `--url-base <url>` | Overrides the printed public URL base |

### Automatic website gift

> **Disabled in the app:** the automatic `FREE FOR YOU` banner component is not mounted,
> so visitors are not prompted to check or claim this offer.

Arm the automatic offer for the next eligible visitor:

```bash
npm run credits:create-claim -- --arm-website-offer
```

This does not create or send a link. A conditional D1 update selects exactly
one browser; all other visitors receive no offer while that reservation is
active.

If the hour expires without redemption, the campaign stays armed and the next eligible visitor can win. Successful redemption disarms the campaign, so no new offer appears until the command above is run again. The manual claim-link command and its recipients are completely independent of this website slot.

Configure the existing Resend sender plus an operator recipient before using this mode:

```bash
npx wrangler pages secret put CREDIT_CLAIM_NOTIFY_EMAIL --project-name masterselects
```

Every successful free-offer claim sends that recipient an email with the claimant, amount, claim ID, and time. This also requires the existing `RESEND_API_KEY` and `AUTH_EMAIL_FROM` configuration. A delivery failure is logged but never rolls back already-granted credits.

---

## User Flow

1. User opens `/credits/claim?code=...` (the `/claim` alias is also routed to the claim page).
2. The page reads claim metadata from `GET /api/credits/claim`.
3. A normal claim is redeemed on that page after magic-link sign-in.
4. On success, the claim page shows the granted amount and returned current balance. Replaying an already claimed code is rejected.

The automatic website-offer flow currently has no in-app entry point because
its promotional banner is disabled.

---

## Security Model

- Public `GET /api/credits/claim` accepts only the high-entropy link code.
- D1 stores `SHA-256("masterselects:credit-claim:v1:" + linkCode)`, not the raw link code.
- D1 stores website offers' six-digit code only as `SHA-256("masterselects:credit-redeem-code:v1:" + redeemCode)`; the raw code is carried in the signed browser cookie and shown to the recipient. The code is accepted only by an authenticated `POST /api/credits/claim` with `redeemCode: true`, never through the public lookup route.
- A signed, HttpOnly, SameSite browser cookie binds the automatic offer to the browser that won it and expires with the offer. A copied or guessed six-digit code cannot be redeemed from another browser.
- The amount, description, recipient lock, and expiry are server-side D1 fields; URL parameters cannot change them.
- Redemption requires the existing MasterSelects session cookie and matching email.
- `POST /api/credits/claim` rejects cross-origin requests through the shared origin check.
- Each claim has `claimed_at`, `claimed_by_user_id`, and `claimed_email` fields. Redemption reserves the row and writes the credit ledger entry in the same D1 batch.
- The credit balance still comes from `credit_ledger`; claims append normal `grant` entries with source `manual:credit_claim`.

---

## Data

Migrations `0007_credit_claims.sql`, `0009_free_credit_offers.sql`, `0010_free_credit_offer_active_claim.sql`, `0011_credit_claim_redeem_codes.sql`, and `0012_admin_credit_claim_tokens.sql` add:

| Table | Purpose |
|---|---|
| `credit_claims` | One row per generated reward link or website offer, with token hash, optional gift-code hash, claim fields, and encrypted admin-created token material |
| `credit_claim_campaigns` | Independent armed/disarmed and active-claim state for the automatic website offer |

Ledger entries use:

| Field | Value |
|---|---|
| `entry_type` | `grant` |
| `source` | `manual:credit_claim` |
| `source_id` | `credit-claim:<claim_id>` |

---

## Source

- `scripts/create-credit-claim.mjs`
- `functions/api/credits/claim.ts`
- `functions/api/credits/free-offer.ts`
- `functions/lib/creditClaims.ts`
- `functions/lib/websiteFreeCreditOffer.ts`
- `functions/lib/adminCreditClaims.ts`
- `functions/api/admin/claims.ts`
- `functions/api/admin/claims/[id]/rotate.ts`
- `src/creditClaims/CreditClaimPage.tsx`
- `src/components/common/AccountDialog.tsx`
- `src/components/common/FreeOfferNotice.tsx`
- `src/admin/AdminPage.tsx`
- `migrations/0007_credit_claims.sql`
