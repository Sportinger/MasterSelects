[Back to Feature Docs](./README.md)

# Credit Claims

Current state: Cloudflare-backed reward links plus one globally reserved website gift.

---

## Goal

Support two independent reward paths: operator-created claim links for selected recipients, and an optional website offer that gives exactly one visitor at a time a one-hour chance to claim 3,000 credits.

---

## Admin Flow

Create a locked claim:

```bash
npm run credits:create-claim -- --amount 3000 --email schickdenkram@gmail.com --description "Reward for 3 reported issues"
```

The script requires `CLOUDFLARE_API_TOKEN` unless `--dry-run` is used. It talks directly to the Cloudflare D1 API and prints a public `/credits/claim?code=...` URL.

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

Arm the automatic offer for the next eligible visitor:

```bash
npm run credits:create-claim -- --arm-website-offer
```

This does not create or send a link. Once folder/project selection, splash, and any first-run tutorial are gone, each visitor waits ten seconds before asking D1 for the offer. A conditional D1 update selects exactly one browser; all other visitors receive no offer while that reservation is active. The winner sees the dismissible `FREE FOR YOU` window, a six-digit code, 3,000 credits, and a live one-hour countdown.

If the hour expires without redemption, the campaign stays armed and the next eligible visitor can win. Successful redemption disarms the campaign, so no new offer appears until the command above is run again. The manual claim-link command and its recipients are completely independent of this website slot.

Configure the existing Resend sender plus an operator recipient before using this mode:

```bash
npx wrangler pages secret put CREDIT_CLAIM_NOTIFY_EMAIL --project-name masterselects
```

Every successful free-offer claim sends that recipient an email with the claimant, amount, claim ID, and time. A delivery failure is logged but never rolls back already-granted credits.

---

## User Flow

1. User opens `/credits/claim?code=...`.
2. The page reads claim metadata from `GET /api/credits/claim`.
3. A normal claim is redeemed on that page after magic-link sign-in.
4. Independently, the normal app waits until first-run folder selection, splash, and tutorial screens are finished, then waits another ten seconds before requesting the automatic offer.
5. Only the browser that wins the global D1 reservation receives the six-digit code and one-hour countdown.
6. The window opens sign-in when needed or the prefilled Account redeem field when already authenticated.
7. Successful Account redemption grants 3,000 credits and disarms the website campaign until an operator re-arms it.

---

## Security Model

- Public `GET /api/credits/claim` accepts only the high-entropy link code.
- D1 stores `SHA-256("masterselects:credit-claim:v1:" + linkCode)`, not the raw link code.
- Website offers use a separate six-digit code stored only as `SHA-256("masterselects:credit-redeem-code:v1:" + redeemCode)`. The code is accepted only by an authenticated Account `POST`, never through the public lookup route.
- A signed, HttpOnly, SameSite browser cookie binds the automatic offer to the browser that won it and expires with the offer. A copied or guessed six-digit code cannot be redeemed from another browser.
- The amount, description, recipient lock, and expiry are server-side D1 fields; URL parameters cannot change them.
- Redemption requires the existing MasterSelects session cookie and matching email.
- `POST /api/credits/claim` rejects cross-origin requests through the shared origin check.
- Each claim has `claimed_at`, `claimed_by_user_id`, and `claimed_email` fields, so the claim row is reserved before writing the credit ledger entry.
- The credit balance still comes from `credit_ledger`; claims append normal `grant` entries with source `manual:credit_claim`.

---

## Data

Migrations `0007_credit_claims.sql`, `0009_free_credit_offers.sql`, `0010_free_credit_offer_active_claim.sql`, and `0011_credit_claim_redeem_codes.sql` add:

| Table | Purpose |
|---|---|
| `credit_claims` | One row per generated reward link, with token hash, optional gift-code hash, and claim status |
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
- `src/creditClaims/CreditClaimPage.tsx`
- `src/components/common/AccountDialog.tsx`
- `migrations/0007_credit_claims.sql`
