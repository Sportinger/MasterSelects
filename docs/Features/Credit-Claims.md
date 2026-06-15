[Back to Feature Docs](./README.md)

# Credit Claims

Current state: Cloudflare-backed reward links for manually granted credits.

---

## Goal

Let an operator with Cloudflare access create a one-time reward link. The user opens the link on a MasterSelects credit-claim page, verifies the recipient email through the existing hosted auth flow, and claims the credits into the normal credit ledger.

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

---

## User Flow

1. User opens `/credits/claim?code=...`.
2. The page reads claim metadata from `GET /api/credits/claim`.
3. User enters an email and clicks the action button.
4. If not signed in, the page sends the existing magic-link login and redirects back to the same claim URL.
5. After sign-in, `POST /api/credits/claim` redeems the reward only when the session email matches the submitted email and any claim lock.

---

## Security Model

- The public URL contains only a high-entropy random code.
- D1 stores `SHA-256("masterselects:credit-claim:v1:" + code)`, not the raw code.
- The amount, description, recipient lock, and expiry are server-side D1 fields; URL parameters cannot change them.
- Redemption requires the existing MasterSelects session cookie and matching email.
- `POST /api/credits/claim` rejects cross-origin requests through the shared origin check.
- Each claim has `claimed_at`, `claimed_by_user_id`, and `claimed_email` fields, so the claim row is reserved before writing the credit ledger entry.
- The credit balance still comes from `credit_ledger`; claims append normal `grant` entries with source `manual:credit_claim`.

---

## Data

Migration `0007_credit_claims.sql` adds:

| Table | Purpose |
|---|---|
| `credit_claims` | One row per generated reward link, with token hash and claim status |

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
- `functions/lib/creditClaims.ts`
- `src/creditClaims/CreditClaimPage.tsx`
- `migrations/0007_credit_claims.sql`
