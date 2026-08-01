# Credit-Burn-Meter.md — audit 2026-08-02

## Verified (spot checks that held)

- The meter is rendered only for an authenticated toolbar session, is a 28 px button, opens Account on click, and displays the account balance plus a reserve bar: `src/components/common/Toolbar.tsx`, `src/components/common/CreditBurnMeter.tsx`, `src/components/common/CreditBurnMeter.css`.
- Debit motion uses one accepted update to change account truth, animate changed digits and the reserve edge, render seven drain particles, and update the session spend total: `src/services/credits/creditBalanceCoordinator.ts`, `src/components/common/CreditBurnMeter.tsx`, `src/components/common/CreditBurnMeter.css`, `src/stores/creditActivityStore.ts`.
- The 1.5-second terminal hold, positive grant/refund treatment, mutation deduplication, cumulative-max agent totals, 350 ms final reconciliation, and bounded visual-settlement queue are implemented: `src/components/common/CreditBurnMeter.tsx`, `src/services/credits/creditBalanceCoordinator.ts`, `src/stores/creditActivityStore.ts`.
- Reduced-motion and hidden-document paths consume settlement visuals immediately; the CSS disables decorative motion for reduced motion: `src/components/common/useCreditBurnAnimation.ts`, `src/components/common/CreditBurnMeter.css`.
- `creditMeterReference` is supplied by the billing/me responses and is computed from current balance, monthly credits, and current-epoch grant high water while excluding adjustment rows: `functions/api/billing/summary.ts`, `functions/api/me.ts`, `functions/lib/credits.ts`, `src/stores/accountStore.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- Literal UI examples such as `RUN タ'0`, `タ'N`, and `LAST タ'N` → the component renders `RUN`/`LAST` with a malformed non-ASCII suffix rather than those documented literals. The refreshed doc refers to the indicators without claiming an exact amount glyph: `src/components/common/CreditBurnMeter.tsx`.
- “Registered AI surface” → there is no target-registration API; the meter looks up `activeSettlement.targetId` with `document.getElementById()` and falls back when it is absent, invalid, off-screen, or too distant: `src/components/common/CreditBurnMeter.tsx`.
- “K2 persists and replays it” → this client repository proves cursor persistence callbacks and ordered replay handling, but the separate kernel server's persistence is out of scope. The doc now describes the client behavior only: `src/services/kernelClient/hostedAgent/k2Client.ts`.
- “Low and critical reserve states are expressed through both bar geometry and text” → the low/critical level is a CSS `data-credit-level` color state; the UI supplies numeric balance and a reference tooltip rather than explicit Low/Critical text: `src/components/common/CreditBurnMeter.tsx`, `src/components/common/CreditBurnMeter.css`.

## Noteworthy / unusual

- Activity instrumentation is much broader than hosted-agent turns: hosted chat, image/video generation, speech, music, sound, generic AI generation, and transcription all begin/end meter activities. The feature doc now names this shipped scope: `src/services/cloudAiService.ts`, `src/services/transcription/cloudProviders.ts`.
- The visible `RUN`, `LAST`, and particle amount strings contain mojibake/non-ASCII corruption in source. This appears to be a UI defect; it was not changed because this audit is documentation-only: `src/components/common/CreditBurnMeter.tsx`.
- Active state intentionally has an infinite 2.4-second sheen; the no-loop claim is accurate only while idle: `src/components/common/CreditBurnMeter.css`.
- The client retains at most 512 processed mutation IDs and 24 visual settlements, which bounds memory but permits very old duplicate identities to age out: `src/services/credits/creditBalanceCoordinator.ts`, `src/stores/creditActivityStore.ts`.
