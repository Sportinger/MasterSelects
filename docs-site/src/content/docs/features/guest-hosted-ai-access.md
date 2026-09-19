---
title: "Guest Hosted AI Access"
---

MasterSelects can expose hosted AI to a browser without requiring an account first. A guest receives a server-side guest identity, a necessary signed session cookie, and a one-time balance of 400 welcome credits. The same verified guest identity is accepted by hosted HTTP routes and the Codex Direct WebSocket relay.

Before Codex Direct opens its WebSocket, the browser refreshes `/api/me`. This creates or restores the signed guest cookie first, so a new guest can use Direct immediately without signing in.

## Account UI

The account dialog treats a guest as unauthenticated even though the guest can use hosted AI. It shows **Sign in**, which opens the shared authentication dialog. Only an authenticated account session shows **Sign out**.

## Credit issuance and abuse guard

The welcome grant remains idempotent in the credit ledger. Reusing the same guest cookie or signing back into the same account never grants another 400 credits.

Anonymous access adds a server-side guard for deleted cookies and private browsing:

- Cloudflare's connecting IP and the browser user-agent are HMACed with the server session secret. Neither raw value is stored in the guest-credit claim table.
- A client fingerprint can claim the anonymous welcome grant once.
- An IP-only HMAC limits one public network to three anonymous welcome grants. This allows a small household while bounding repeated browser identities.
- The signed guest cookie remains the primary identity and expires after 30 days.
- When Cloudflare's connecting-IP header is unavailable, as in direct unit or local requests, the guard is skipped; production Pages requests supply the header.

The protection is deliberately an abuse threshold, not proof of a person. A determined user can change networks or devices, while a strict one-IP/one-credit policy would incorrectly block shared networks. Provider/email identities remain the primary boundary for signed-in accounts.

## Persistence

- `guest_accounts` stores the guest-to-user mapping.
- `guest_welcome_credit_claims` stores only HMAC fingerprints, the owning guest user ID, and claim time.
- Credit balance and spend remain authoritative in `credit_ledger`.

Apply `migrations/0021_guest_ai_access.sql` and `migrations/0022_guest_welcome_credit_abuse_guard.sql` before deploying Pages Functions that use guest access.

## Verification

- `tests/unit/guestAiAccess.test.ts` covers durable identity, cookie deletion, HMAC-only persistence, and the per-network cap.
- `tests/unit/AccountDialogHost.test.tsx` covers guest sign-in and authenticated sign-out behavior.
- `tests/unit/directCodexRoute.test.ts` covers guest principal relay and rejection when neither an account nor a guest identity was verified.
