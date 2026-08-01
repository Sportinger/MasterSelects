# Credit-Claims.md — audit 2026-08-02

## Verified (spot checks that held)

- The `credits:create-claim` package script points to `scripts/create-credit-claim.mjs`; it requires `CLOUDFLARE_API_TOKEN` except for `--dry-run`, uses the Cloudflare D1 API, defaults expiry to 30 days, supports the documented link options, and prints `/credits/claim?code=...`. Evidence: `package.json`, `scripts/create-credit-claim.mjs`.
- Website offers are armed with `--arm-website-offer`, grant 3,000 credits for one hour, retain the armed campaign after an expiry, and disarm after successful redemption. Evidence: `scripts/create-credit-claim.mjs`, `functions/lib/websiteFreeCreditOffer.ts`, `functions/lib/creditClaims.ts`.
- The banner component exists but has no importer or JSX mount outside its own file, so there is no normal in-app website-offer entry point. Evidence: `src/components/common/FreeOfferNotice.tsx`; `rg "FreeOfferNotice" src --glob '*.tsx'`.
- The public claim lookup, authenticated redemption, origin check, recipient-email check, token/redeem-code hash contexts, browser-cookie verification, and `grant` / `manual:credit_claim` / `credit-claim:<id>` ledger values match the document. Evidence: `functions/api/credits/claim.ts`, `functions/lib/creditClaims.ts`, `functions/lib/websiteFreeCreditOffer.ts`.
- Claim and website-offer tables and migrations `0007`, `0009`, `0010`, and `0011` exist at the documented paths. Evidence: `migrations/0007_credit_claims.sql`, `migrations/0009_free_credit_offers.sql`, `migrations/0010_free_credit_offer_active_claim.sql`, `migrations/0011_credit_claim_redeem_codes.sql`.

## Outdated or wrong (claim → reality, with file evidence)

- “Cloudflare-backed reward links” created only through the operator command → the secured admin dashboard now creates locked/unlocked links, lists them, copies available links, and rotates eligible legacy links. Evidence: `src/admin/AdminPage.tsx`, `functions/api/admin/claims.ts`, `functions/api/admin/claims/[id]/rotate.ts`, `functions/lib/adminCreditClaims.ts`.
- “A newly created claim ledger entry updates the toolbar meter … replaying an already claimed code only reconciles the balance” → the standalone `CreditClaimPage` displays the returned balance after a successful normal claim; its replay receives an error response. The positive-credit update is only in `AccountDialog` for six-digit website-gift redemption. Evidence: `src/creditClaims/CreditClaimPage.tsx`, `src/components/common/AccountDialog.tsx`, `functions/api/credits/claim.ts`.
- “Website offers use a separate six-digit code stored only as [a hash]” → D1 stores the hash, but the raw code is included in the signed browser cookie and displayed by the notice. Evidence: `functions/lib/creditClaims.ts`, `functions/lib/websiteFreeCreditOffer.ts`, `src/components/common/FreeOfferNotice.tsx`.
- “The code is accepted only by an authenticated Account `POST`” → the Account dialog is the current UI, but the backend endpoint is the shared authenticated `POST /api/credits/claim` with `redeemCode: true`. Evidence: `src/components/common/AccountDialog.tsx`, `functions/api/credits/claim.ts`.
- The migration list ends at `0011` and the `credit_claims` table description lacks admin token material → `0012_admin_credit_claim_tokens.sql` adds `token_ciphertext`, `token_iv`, and an admin status index. Evidence: `migrations/0012_admin_credit_claim_tokens.sql`, `functions/lib/adminCreditClaims.ts`.

## Noteworthy / unusual

- The claim page also routes `/claim`, although generated links use `/credits/claim`. Evidence: `src/routing/entryExperience.ts`, `scripts/create-credit-claim.mjs`.
- The website-offer banner implementation remains in the tree, including a 10-second delayed display, code copy action, and preview mode, but it is currently unreachable because it is not mounted. Evidence: `src/components/common/FreeOfferNotice.tsx`.
- Admin-created tokens are encrypted with AES-GCM using `ADMIN_SESSION_SECRET`, while script-created links retain only the token hash; therefore only available legacy/script links are marked rotatable in the dashboard. Evidence: `functions/lib/adminCreditClaims.ts`, `migrations/0012_admin_credit_claim_tokens.sql`.
- The notification configuration needs `CREDIT_CLAIM_NOTIFY_EMAIL` plus the existing Resend credentials and sender (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`), whereas the prior document showed only the recipient secret command. Evidence: `functions/lib/authProviders.ts`, `functions/lib/env.ts`.
